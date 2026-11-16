/**
 * 状态存储：主机清单、阈值、最近一次体检结果。
 *
 * 落盘位置 ~/.dsh/ops-workbench/state.json（0600）。
 * 密码明文存在本机这个文件里 —— 这是有意的取舍：本插件跑在你自己的机器上，
 * 用 DSH 的凭据库需要把它绑定到某个模型 provider 的 key 引用上，语义不对；
 * 换来的可读性更好、出问题能直接看到。README 里写清了，并给了「改用密钥登录」的路径。
 */
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { DEFAULT_THRESHOLDS } from './probe.js'

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const STATE_DIR = join(DSH_HOME, 'ops-workbench')
const STATE_FILE = join(STATE_DIR, 'state.json')

const EMPTY = {
  version: 2,
  hosts: [],
  settings: {
    thresholds: {},
    allowWrites: false,
    // 定时巡检 / 每日日报：只做只读采集，默认开着
    auto: { enabled: true, everyMinutes: 15 },
    daily: { enabled: true, hour: 9, minute: 0 },
    lastAutoAt: 0,
    lastReportDate: '',
  },
  lastInspect: {},
  history: {},
  reportLog: [],
}

let cache = null

export function stateFile() {
  return STATE_FILE
}

/** 同目录下的其它文件（页面自述日志等），路径口径与 state.json 保持一致。 */
export function stateDir() {
  return STATE_DIR
}

/** 每日日报落盘目录：~/.dsh/ops-workbench/reports/YYYY-MM-DD.md */
export function reportsDir() {
  return join(STATE_DIR, 'reports')
}

export async function readState() {
  if (cache) return cache
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    const settings = parsed.settings ?? {}
    cache = {
      ...EMPTY,
      ...parsed,
      settings: {
        ...EMPTY.settings,
        ...settings,
        // 老状态文件没有这两块，深合并补上默认值（否则开关读出来是 undefined）
        auto: { ...EMPTY.settings.auto, ...(settings.auto ?? {}) },
        daily: { ...EMPTY.settings.daily, ...(settings.daily ?? {}) },
        thresholds: { ...(settings.thresholds ?? {}) },
      },
      hosts: Array.isArray(parsed.hosts) ? parsed.hosts.map(repairHostId) : [],
      lastInspect: parsed.lastInspect ?? {},
      history: parsed.history && typeof parsed.history === 'object' ? parsed.history : {},
      reportLog: Array.isArray(parsed.reportLog) ? parsed.reportLog : [],
    }
  } catch {
    cache = { ...EMPTY, hosts: [], settings: { ...EMPTY.settings }, lastInspect: {}, history: {}, reportLog: [] }
  }
  return cache
}

export async function writeState(next) {
  cache = next
  await fs.mkdir(STATE_DIR, { recursive: true })
  const tmp = join(STATE_DIR, `.state-${randomBytes(4).toString('hex')}.tmp`)
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 })
  try { await fs.chmod(STATE_FILE, 0o600) } catch { /* Windows 上无意义 */ }
  await fs.rename(tmp, STATE_FILE)
  return next
}

/** 本地阈值 = 默认值 + 用户覆盖。 */
export function thresholdsOf(state) {
  return { ...DEFAULT_THRESHOLDS, ...(state.settings?.thresholds ?? {}) }
}

export function newHostId() {
  return 'h' + randomBytes(4).toString('hex')
}

/**
 * 老数据里的主机可能没有 id（早期版本 bug），读盘时补一个，
 * 否则「保存第二台」会把它当成同一台覆盖掉。
 */
function repairHostId(host) {
  if (host && typeof host.id === 'string' && host.id.trim() !== '') return host
  return { ...host, id: newHostId() }
}

/** 送给浏览器的版本：抹掉密码与私钥正文。 */
export function publicHost(host) {
  const { password, keyText, ...rest } = host
  return {
    ...rest,
    hasPassword: Boolean(password),
    hasKeyText: Boolean(keyText),
  }
}

/** 保存/更新一台主机，字段做白名单清洗。 */
export function normalizeHost(input, existing) {
  // 注意：浏览器会给新主机传 id: ''（空串），不能直接用 input.id —— 空串是「没有 id」，
  // 不是「用这个 id」。之前这里用 ?? 兜底，导致所有新主机 id 都是 ''，第二台会覆盖第一台。
  const givenId = typeof input.id === 'string' ? input.id.trim() : ''
  const id = existing?.id || givenId || newHostId()
  const host = {
    id,
    name: String(input.name ?? '').trim() || String(input.host ?? '').trim(),
    host: String(input.host ?? '').trim(),
    port: Number(input.port) || 22,
    username: String(input.username ?? 'root').trim() || 'root',
    authType: input.authType === 'key' ? 'key' : 'password',
    keyPath: String(input.keyPath ?? '').trim(),
    group: String(input.group ?? '').trim(),
    note: String(input.note ?? '').trim(),
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  }
  // 密码/私钥：传空字符串表示「保持原样」，避免编辑主机时把密码洗掉。
  const password = typeof input.password === 'string' && input.password !== '' ? input.password : existing?.password
  const keyText = typeof input.keyText === 'string' && input.keyText !== '' ? input.keyText : existing?.keyText
  if (password) host.password = password
  if (keyText) host.keyText = keyText
  if (input.authType === 'key' && typeof input.clearKeyText === 'boolean' && input.clearKeyText) delete host.keyText
  return host
}
