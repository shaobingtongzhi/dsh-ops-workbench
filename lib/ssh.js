/**
 * SSH 传输层：只做一件事 —— 把一段 POSIX 脚本送到远端跑完，拿回 stdout/stderr。
 *
 * 为什么不是直接调 ssh.exe：这台机器没有 sshpass/plink，而用户手上的服务器
 * 只有「用户名 + 密码」。ssh.exe 没法在非交互场景喂密码，所以主路径用 ssh2
 * （纯 JS 实现，声明在 package.json 的 dependencies 里）。
 * 万一 ssh2 加载失败（比如 node_modules 被清掉），自动退回系统 ssh + 密钥登录，
 * 并在界面上说明原因，而不是直接报「连不上」。
 */
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const require = createRequire(import.meta.url)

let ssh2 = null
let ssh2Version = null
try {
  ssh2 = require('ssh2')
  ssh2Version = require('ssh2/package.json').version
} catch {
  ssh2 = null
}

/** 传输层能力，页面用它决定要不要提示「只能密钥登录」。 */
export function transportInfo() {
  return {
    ssh2: Boolean(ssh2?.Client),
    version: ssh2Version,
    cli: windowsSshPath() ?? 'ssh',
  }
}

/** Windows 自带的 OpenSSH 不一定在 PATH 里，优先用绝对路径。 */
function windowsSshPath() {
  if (process.platform !== 'win32') return null
  const p = 'C:/Windows/System32/OpenSSH/ssh.exe'
  return existsSync(p) ? p : null
}

/**
 * 在远端执行脚本。
 * @returns {Promise<{code:number|null, stdout:string, stderr:string, via:string}>}
 */
export async function execScript(host, script, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000
  if (ssh2?.Client) return execWithSsh2(host, script, timeoutMs)
  return execWithCli(host, script, timeoutMs)
}

function friendly(error) {
  const raw = String(error?.message ?? error)
  if (/authentication/i.test(raw)) return new Error('登录被拒绝：用户名或密码不对（也可能是服务器禁用了密码登录）')
  if (/timed out|timeout|ETIMEDOUT/i.test(raw)) return new Error('连接超时：检查 IP、端口、云安全组放行、以及能否 ping 通')
  if (/ECONNREFUSED/i.test(raw)) return new Error('端口拒绝连接：22 端口没开放，或 SSH 服务没在跑')
  if (/ENOTFOUND|EAI_AGAIN/i.test(raw)) return new Error('域名解析失败：主机名写错了')
  if (/handshake|kex|algorithm/i.test(raw)) return new Error(`SSH 握手失败（算法不兼容）：${raw}`)
  return new Error(raw)
}

function connectConfig(host) {
  const cfg = {
    host: host.host,
    port: Number(host.port) || 22,
    username: host.username,
    readyTimeout: 15_000,
    keepaliveInterval: 5_000,
    keepaliveCountMax: 2,
  }
  if (host.authType === 'key' && host.keyText) {
    cfg.privateKey = host.keyText
    if (host.passphrase) cfg.passphrase = host.passphrase
  } else if (host.authType === 'key' && host.keyPath) {
    cfg.privateKey = require('node:fs').readFileSync(host.keyPath)
    if (host.passphrase) cfg.passphrase = host.passphrase
  } else {
    cfg.password = host.password
    // 少数服务器只开了 keyboard-interactive，ssh2 需要显式应答。
    cfg.tryKeyboard = true
  }
  return cfg
}

function execWithSsh2(host, script, timeoutMs) {
  return new Promise((resolve, reject) => {
    const conn = new ssh2.Client()
    let settled = false
    let timer = null

    const done = (error, value) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      try { conn.end() } catch { /* 已经断了 */ }
      if (error) reject(friendly(error))
      else resolve(value)
    }

    timer = setTimeout(() => done(new Error(`超时：${Math.round(timeoutMs / 1000)}s 内没跑完，服务器可能负载过高或网络很慢`)), timeoutMs)

    conn.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => {
      finish(prompts.map(() => host.password ?? ''))
    })
    conn.on('error', (error) => done(error))
    conn.once('ready', () => {
      conn.exec('sh -s', (error, stream) => {
        if (error) return done(error)
        let stdout = ''
        let stderr = ''
        stream.on('data', (chunk) => { stdout += chunk.toString('utf8') })
        stream.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
        stream.on('close', (code) => done(null, { code, stdout, stderr, via: 'ssh2' }))
        stream.write(script)
        stream.end()
      })
    })
    conn.connect(connectConfig(host))
  })
}

function execWithCli(host, script, timeoutMs) {
  return new Promise((resolve, reject) => {
    const bin = windowsSshPath() ?? 'ssh'
    const args = [
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ConnectTimeout=12',
      '-p', String(Number(host.port) || 22),
    ]
    if (host.keyPath) args.push('-i', host.keyPath)
    args.push(`${host.username}@${host.host}`, 'sh -s')

    let child
    try {
      child = spawn(bin, args, { windowsHide: true })
    } catch (error) {
      return reject(new Error(`系统 ssh 也起不来：${error?.message ?? error}`))
    }
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* ignore */ }
      reject(new Error(`超时：${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)
    child.stdout.on('data', (c) => { stdout += c.toString('utf8') })
    child.stderr.on('data', (c) => { stderr += c.toString('utf8') })
    child.on('error', (error) => { clearTimeout(timer); reject(new Error(`系统 ssh 起不来：${error.message}`)) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0 && !stdout) return reject(friendly(new Error(stderr.trim() || `ssh 退出码 ${code}`)))
      resolve({ code, stdout, stderr, via: 'ssh-cli' })
    })
    child.stdin.end(script)
  })
}
