/**
 * 宿主半边：ops-workbench
 *
 * 职责边界很清楚 —— 浏览器只负责画，所有「碰服务器」的动作都在宿主里做：
 *   GET  /ops/api/state         读状态（主机清单、上次体检、阈值）
 *   POST /ops/api/host/save     新增/修改主机
 *   POST /ops/api/host/delete   删除主机
 *   POST /ops/api/host/test     连接测试（只跑 whoami/uname）
 *   POST /ops/api/inspect       只读体检（可指定主机，默认全部）
 *   POST /ops/api/diag          单个排障动作
 *   POST /ops/api/report        生成日报文本
 *   POST /ops/api/settings      阈值等设置
 *
 * 与页面通信不走 Remote（本包是纯 JS、没有装饰器），用 zhibo-work 同款做法：
 * webserver/index-inject 注入 globalThis.__DSH_OPS__ = { nonce }，
 * 每个请求带 x-ops-nonce 头，挡掉别的网页发起的 CSRF。
 */
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { INSPECT_SCRIPT, evaluate, parseSnapshot } from './lib/probe.js'
import { execScript, transportInfo } from './lib/ssh.js'
import { DIAGNOSTICS, diagScript, diagnosticCatalog, findDiagnostic } from './lib/diag.js'
import { buildReport } from './lib/report.js'
import {
  newHostId,
  normalizeHost,
  publicHost,
  readState,
  reportsDir,
  stateDir,
  stateFile,
  thresholdsOf,
  writeState,
} from './lib/store.js'

export const name = 'ops-workbench'

/** webServer 提供 /ops/api/*。 */
export const inject = ['webServer']

const MAX_BODY = 256 * 1024

let activeNonce = ''

function currentNonce() {
  return activeNonce
}

export function apply(ctx) {
  const nonce = randomBytes(24).toString('hex')
  activeNonce = nonce

  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: '__DSH_OPS__', value: { nonce } })
  })

  const routes = [
    ['/ops/api/state', 'GET', handleState],
    ['/ops/api/host/save', 'POST', handleHostSave],
    ['/ops/api/host/delete', 'POST', handleHostDelete],
    ['/ops/api/host/test', 'POST', handleHostTest],
    ['/ops/api/inspect', 'POST', handleInspect],
    ['/ops/api/diag', 'POST', handleDiag],
    ['/ops/api/report', 'POST', handleReport],
    ['/ops/api/reports', 'GET', handleReports],
    ['/ops/api/report/file', 'POST', handleReportFile],
    ['/ops/api/settings', 'POST', handleSettings],
    ['/ops/api/log', 'POST', handleLog],
    ['/ops/api/handshake', 'GET', handleHandshake],
  ]

  ctx.effect(() => {
    const disposers = routes.map(([path, method, handler]) => ctx.webServer.register({
      kind: 'exact',
      path,
      handler: async (req, res) => {
        if (req.method !== method) return sendJson(res, 405, { error: 'method-not-allowed' })
        // handshake 是自举入口，它本身就是「拿 nonce」用的，不能先验 nonce
        if (path !== '/ops/api/handshake' && !trusted(req, nonce)) return sendJson(res, 403, { error: 'bad-nonce' })
        try {
          const body = method === 'POST' ? await readJson(req) : {}
          await handler(res, body, req)
        } catch (error) {
          ctx.logger?.warn?.('[ops-workbench] %s failed: %o', path, error)
          sendJson(res, 500, { error: String(error?.message ?? error) })
        }
      },
    }))
    return () => { for (const dispose of disposers) dispose() }
  }, 'ops-workbench: routes')

  // 定时巡检 + 每日日报：跑在宿主进程里，页面关掉也照跑（只读采集）
  startScheduler(ctx)
}

/* ------------------------------------------------------------ 定时调度 */

const TICK_MS = 30_000
const HISTORY_LIMIT = 480 // 15 分钟一次 ≈ 5 天；再老的数据对判断没帮助

// 「连不上」几乎都不是服务器的问题，而是这台电脑刚开机/刚唤醒，网络或代理还没就绪。
// 这种情况等下一个 15 分钟周期太久，改成 1、2、3 分钟后各重试一次。
const RETRY_MAX = 3
const RETRY_BASE_MS = 60_000
const ATTEMPT_LIMIT = 20

let inspecting = false
let retryAt = 0
let retryCount = 0
// 这一轮要补测的主机 id；空数组表示「没有针对性重试，跑全量」。
let retryHostIds = []

/**
 * 记一次巡检尝试，并决定要不要赶紧重试。
 *
 * 全失败和部分失败都要重试。只认「全灭」是不够的：这台电脑从休眠/断网恢复时，
 * 最常见的形态恰恰是部分就绪 —— 走内网的 1.71.x 先通了，走公网和办公网的另一半
 * 还卡在超时里。5 台通 2 台挂 3 台，allFailed 是 false，于是不重试、直接把这 3 台
 * 判成宕机挂到下一个 15 分钟周期，看起来就像「三台同时断了」。
 *
 * 退避 1/2/3 分钟，最多 RETRY_MAX 次；仍然不通才下结论，等下一个正常周期。
 */
export function noteAttempt(results, at = Date.now()) {
  const failed = results.filter((item) => !item.ok)
  const allFailed = results.length > 0 && failed.length === results.length
  if (failed.length > 0) {
    retryCount += 1
    if (retryCount <= RETRY_MAX) {
      retryAt = at + RETRY_BASE_MS * retryCount
      retryHostIds = failed.map((item) => item.hostId).filter(Boolean)
    } else {
      retryAt = 0
      retryHostIds = []
      retryCount = 0
    }
  } else {
    retryAt = 0
    retryHostIds = []
    retryCount = 0
  }
  return {
    at,
    total: results.length,
    failed: failed.length,
    allFailed,
    retryAt,
    errors: failed.slice(0, 5).map((item) => ({
      hostId: item.hostId,
      message: String(item.error ?? '').slice(0, 160),
    })),
  }
}

export function retryState() {
  return { at: retryAt, count: retryCount, max: RETRY_MAX, delayMs: RETRY_BASE_MS, hostIds: [...retryHostIds] }
}

/**
 * 决定这一轮巡检跑哪几台。
 * 正常周期跑全量；只是重试到点，就只补上次失败的那几台 —— 通了的不必再连一次。
 */
export function pickHosts(hosts, { retryOnly }) {
  if (!retryOnly || retryHostIds.length === 0) return hosts
  const wanted = new Set(retryHostIds)
  const subset = hosts.filter((host) => wanted.has(host.id))
  return subset.length ? subset : hosts
}

/** 本地日期 yyyy-mm-dd（用户就这一台电脑，按本机时区算最直观）。 */
function localDate(ts = Date.now()) {
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function autoSettings(state) {
  const auto = state.settings.auto ?? {}
  const every = Number(auto.everyMinutes)
  return {
    enabled: auto.enabled !== false,
    everyMinutes: Number.isFinite(every) ? Math.min(1440, Math.max(5, Math.round(every))) : 15,
  }
}

function dailySettings(state) {
  const daily = state.settings.daily ?? {}
  const hour = Number(daily.hour)
  const minute = Number(daily.minute)
  return {
    enabled: daily.enabled !== false,
    hour: Number.isFinite(hour) ? Math.min(23, Math.max(0, Math.round(hour))) : 9,
    minute: Number.isFinite(minute) ? Math.min(59, Math.max(0, Math.round(minute))) : 0,
  }
}

/** 给页面看的调度状态：下次什么时候跑，一眼能算出来。 */
export function schedulerView(state, now = Date.now()) {
  const auto = autoSettings(state)
  const daily = dailySettings(state)
  const lastAutoAt = Number(state.settings.lastAutoAt) || 0
  const nextAutoAt = auto.enabled ? lastAutoAt + auto.everyMinutes * 60_000 : 0
  const today = localDate(now)
  const dueToday = new Date(now)
  dueToday.setHours(daily.hour, daily.minute, 0, 0)
  let nextDailyAt = dueToday.getTime()
  if (state.settings.lastReportDate === today || nextDailyAt <= now) {
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(daily.hour, daily.minute, 0, 0)
    nextDailyAt = state.settings.lastReportDate === today ? tomorrow.getTime() : Math.max(nextDailyAt, now)
  }
  return {
    auto: { ...auto, lastAutoAt, nextAutoAt },
    daily: { ...daily, lastReportDate: state.settings.lastReportDate || '', nextDailyAt },
    retry: retryState(),
    attemptLog: (state.attemptLog ?? []).slice(0, 5),
    historyLimit: HISTORY_LIMIT,
  }
}

/** 把一次巡检压成趋势点，供「最近走势」用。 */
function historyPoint(record) {
  const snap = record?.snapshot
  return {
    at: record?.at ?? Date.now(),
    level: record?.level ?? 'unknown',
    cpuPct: snap?.cpu?.pct ?? null,
    memAvailPct: snap?.mem?.availPct ?? null,
    swapUsedPct: snap?.mem?.swapUsedPct ?? null,
    diskUsedPct: snap?.disks?.[0]?.usedPct ?? null,
    inodeUsedPct: snap?.inodes?.[0]?.usedPct ?? null,
    loadPerCore: snap?.load && snap?.host?.cores ? snap.load.l1 / snap.host.cores : null,
    failedUnits: Array.isArray(snap?.failedUnits) ? snap.failedUnits.length : null,
  }
}

function withHistory(state, lastInspect, hostIds) {
  const history = { ...(state.history ?? {}) }
  for (const id of hostIds) {
    const record = lastInspect[id]
    if (!record) continue
    // 连不上的那次没有快照 —— 别把空洞当成「内存掉到 0%」画进走势
    if (!record.snapshot) continue
    const list = Array.isArray(history[id]) ? history[id] : []
    history[id] = [...list, historyPoint(record)].slice(-HISTORY_LIMIT)
  }
  return history
}

/**
 * 真正干活的那一小段：读状态 → 决定要不要巡检/出日报 → 写回。
 * 手动按钮和定时器共用它，靠 inspecting 这个锁避免同时连两次。
 */
async function runInspection(hosts, thresholds) {
  return mapLimit(hosts, 3, async (host) => {
    const started = Date.now()
    try {
      const run = await execScript(host, INSPECT_SCRIPT, { timeoutMs: 45_000 })
      const snapshot = parseSnapshot(run.stdout)
      const verdict = evaluate(snapshot, thresholds)
      return {
        hostId: host.id,
        ok: true,
        via: run.via,
        durationMs: Date.now() - started,
        level: verdict.level,
        issues: verdict.issues,
        snapshot,
      }
    } catch (error) {
      return {
        hostId: host.id,
        ok: false,
        durationMs: Date.now() - started,
        level: 'unreachable',
        error: String(error?.message ?? error),
        issues: [{
          level: 'crit',
          key: 'unreachable',
          title: '连不上这台服务器',
          detail: String(error?.message ?? error),
          fix: '先在「主机」里点连接测试确认账号密码与网络；云服务器还要确认安全组放行 22 端口',
        }],
      }
    }
  })
}

/** 把巡检结果并进 lastInspect（成功带快照，失败保留原因）。 */
function mergeInspect(lastInspect, results, at = Date.now()) {
  const next = { ...lastInspect }
  for (const result of results) {
    if (!result.ok) {
      next[result.hostId] = {
        at,
        level: 'unreachable',
        issues: result.issues,
        error: result.error,
        snapshot: null,
        durationMs: result.durationMs,
      }
      continue
    }
    next[result.hostId] = {
      at,
      level: result.level,
      issues: result.issues,
      snapshot: result.snapshot,
      durationMs: result.durationMs,
    }
  }
  return next
}

function startScheduler(ctx) {
  return ctx.effect(() => {
    let stopped = false
    let ticking = false

    const beat = async () => {
      if (stopped || ticking) return
      ticking = true
      try {
        await tick(ctx)
      } catch (error) {
        ctx.logger?.warn?.('[ops-workbench] 定时任务出错: %o', error)
      } finally {
        ticking = false
      }
    }

    const timer = setInterval(beat, TICK_MS)
    timer.unref?.() // 别因为一个定时器把宿主进程钉住
    // 启动后先跑一次：装上插件就能看到最新状态，而不是等到第一个周期
    beat()

    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, 'ops-workbench: scheduler')
}

async function tick(ctx) {
  const state = await readState()
  if (!state.hosts.length) return
  const now = Date.now()
  const auto = autoSettings(state)

  if (!auto.enabled) {
    retryAt = 0
    retryCount = 0
  }

  const retryDue = retryAt > 0 && now >= retryAt
  const cadenceDue = now - (Number(state.settings.lastAutoAt) || 0) >= auto.everyMinutes * 60_000

  if (auto.enabled && !inspecting && (retryDue || cadenceDue)) {
    inspecting = true
    // 正常周期跑全量；只是重试到点就只补上次失败的那几台
    const retryOnly = retryDue && !cadenceDue
    const targets = pickHosts(state.hosts, { retryOnly })
    let results = []
    try {
      results = await runInspection(targets, thresholdsOf(state))
    } finally {
      inspecting = false
    }
    const attempt = noteAttempt(results, now)
    const fresh = await readState()
    const lastInspect = mergeInspect(fresh.lastInspect, results, now)
    await writeState({
      ...fresh,
      lastInspect,
      // 走势只记「这一轮真的测了」的主机：补测那几台之外的老记录不能重复落点
      history: withHistory(fresh, lastInspect, results.map((item) => item.hostId)),
      settings: { ...fresh.settings, lastAutoAt: now },
      attemptLog: [attempt, ...(fresh.attemptLog ?? [])].slice(0, ATTEMPT_LIMIT),
    })
    ctx.logger?.debug?.('[ops-workbench] 自动巡检完成：%d 台，失败 %d 台', attempt.total, attempt.failed)
  }

  await maybeDailyReport(ctx)
}

/** 到点了就生成当天日报并落盘（成功才更新 lastReportDate，失败下次心跳重试）。 */
async function maybeDailyReport(ctx) {
  const state = await readState()
  if (!state.hosts.length) return
  const daily = dailySettings(state)
  if (!daily.enabled) return
  const now = new Date()
  const today = localDate(now.getTime())
  if (state.settings.lastReportDate === today) return
  const due = new Date(now)
  due.setHours(daily.hour, daily.minute, 0, 0)
  if (now.getTime() < due.getTime()) return

  const report = buildReport({
    hosts: state.hosts.map(publicHost),
    lastInspect: state.lastInspect,
    history: state.history,
    now: now.getTime(),
  })
  const dir = reportsDir()
  await mkdir(dir, { recursive: true }).catch(() => {})
  await writeFile(join(dir, `${today}.md`), report.markdown, 'utf8')
  const fresh = await readState()
  await writeState({
    ...fresh,
    settings: { ...fresh.settings, lastReportDate: today },
    reportLog: [{ at: now.getTime(), title: report.title, summary: report.summary }, ...(fresh.reportLog ?? [])].slice(0, 30),
  })
  ctx.logger?.debug?.('[ops-workbench] 已生成日报 %s', today)
}

/* --------------------------------------------------------------- 路由实现 */

async function handleState(res) {
  const state = await readState()
  const now = Date.now()
  sendJson(res, 200, {
    hosts: state.hosts.map(publicHost),
    lastInspect: state.lastInspect,
    history: state.history ?? {},
    settings: state.settings,
    thresholds: thresholdsOf(state),
    scheduler: schedulerView(state, now),
    attempts: state.attemptLog ?? [],
    reportsDir: reportsDir(),
    transport: transportInfo(),
    diagnostics: diagnosticCatalog(),
    stateFile: stateFile(),
    serverTime: now,
  })
}

async function handleHostSave(res, body) {
  const state = await readState()
  const input = body?.host ?? {}
  if (!String(input.host ?? '').trim()) throw new Error('请填写服务器地址（IP 或域名）')
  // 只有真的带了 id 才算「编辑」，空串一律当新增（否则会覆盖掉已有主机）
  const wantedId = typeof input.id === 'string' ? input.id.trim() : ''
  const existingIndex = wantedId ? state.hosts.findIndex((item) => item.id === wantedId) : -1
  const existing = existingIndex >= 0 ? state.hosts[existingIndex] : undefined
  const host = normalizeHost(input, existing)
  if (host.authType === 'password' && !host.password) throw new Error('请填写密码（或改用密钥登录）')
  if (host.authType === 'key' && !host.keyText && !host.keyPath) throw new Error('请粘贴私钥内容，或填写本机私钥路径')
  const hosts = state.hosts.slice()
  if (existingIndex >= 0) hosts[existingIndex] = host
  else hosts.push(host)
  await writeState({ ...state, hosts })
  return sendJson(res, 200, { host: publicHost(host), hosts: hosts.map(publicHost) })
}

async function handleHostDelete(res, body) {
  const state = await readState()
  const id = String(body?.id ?? '')
  const hosts = state.hosts.filter((item) => item.id !== id)
  const lastInspect = { ...state.lastInspect }
  delete lastInspect[id]
  await writeState({ ...state, hosts, lastInspect })
  return sendJson(res, 200, { hosts: hosts.map(publicHost) })
}

async function handleHostTest(res, body) {
  const state = await readState()
  const host = state.hosts.find((item) => item.id === body?.id)
  if (!host) throw new Error('主机不存在，可能已被删除')
  const started = Date.now()
  let result
  try {
    result = await execScript(host, [
      'export LC_ALL=C',
      'echo "user: $(id -un)"',
      'echo "host: $(uname -n)"',
      'echo "kernel: $(uname -r)"',
      'echo "uptime: $(cut -d" " -f1 /proc/uptime)"',
    ].join('\n'), { timeoutMs: 20_000 })
  } catch (error) {
    // 连不上也是一条结论，不是服务器错误 —— 让它以 200 回到页面，前端直接显示原因。
    return sendJson(res, 200, {
      ok: false,
      via: 'n/a',
      durationMs: Date.now() - started,
      whoami: '',
      hostname: '',
      kernel: '',
      uptimeSec: 0,
      stderr: String(error?.message ?? error),
    })
  }
  const text = result.stdout.trim()
  const pick = (key) => (new RegExp(`^${key}: (.*)$`, 'm').exec(text)?.[1] ?? '').trim()
  return sendJson(res, 200, {
    ok: result.code === 0,
    via: result.via,
    durationMs: Date.now() - started,
    whoami: pick('user'),
    hostname: pick('host'),
    kernel: pick('kernel'),
    uptimeSec: Number(pick('uptime')) || 0,
    stderr: result.stderr.slice(0, 400),
  })
}

async function handleInspect(res, body) {
  const state = await readState()
  const wanted = Array.isArray(body?.ids) && body.ids.length > 0 ? new Set(body.ids) : null
  const targets = state.hosts.filter((host) => !wanted || wanted.has(host.id))
  if (targets.length === 0) return sendJson(res, 200, { results: [] })
  if (inspecting) throw new Error('上一次巡检还没跑完，等几秒再点')

  inspecting = true
  let results = []
  try {
    results = await runInspection(targets, thresholdsOf(state))
  } finally {
    inspecting = false
  }

  // 手动点了就算「刚跑过」，别让定时器紧接着再跑一遍
  const fresh = await readState()
  const at = Date.now()
  const attempt = noteAttempt(results, at)
  const lastInspect = mergeInspect(fresh.lastInspect, results, at)
  const hostIds = targets.map((host) => host.id)
  await writeState({
    ...fresh,
    lastInspect,
    history: withHistory(fresh, lastInspect, hostIds),
    settings: { ...fresh.settings, lastAutoAt: at },
    attemptLog: [attempt, ...(fresh.attemptLog ?? [])].slice(0, ATTEMPT_LIMIT),
  })
  return sendJson(res, 200, { results, lastInspect, retry: retryState() })
}

async function handleDiag(res, body) {
  const state = await readState()
  const host = state.hosts.find((item) => item.id === body?.id)
  if (!host) throw new Error('主机不存在，可能已被删除')
  const action = findDiagnostic(body?.action)
  if (!action) throw new Error('未知的排障动作')
  const started = Date.now()
  const run = await execScript(host, diagScript(action.id), { timeoutMs: action.timeoutMs ?? 45_000 })
  const output = (run.stdout || run.stderr || '').replace(/\s+$/, '')
  const limit = 60_000
  return sendJson(res, 200, {
    action: { id: action.id, label: action.label, look: action.look },
    ok: run.code === 0,
    via: run.via,
    durationMs: Date.now() - started,
    output: output.length > limit ? `${output.slice(0, limit)}\n…（输出过长，已截断）` : output,
    truncated: output.length > limit,
  })
}

async function handleReport(res, body) {
  const state = await readState()
  const report = buildReport({
    hosts: state.hosts.map(publicHost),
    lastInspect: state.lastInspect,
    history: state.history,
    now: Number(body?.now) || Date.now(),
  })
  const reportLog = [{ at: Date.now(), title: report.title, summary: report.summary }, ...state.reportLog].slice(0, 30)
  await writeState({ ...state, reportLog })
  return sendJson(res, 200, report)
}

/** 历史日报清单：读 reports 目录，按日期倒序。 */
async function handleReports(res) {
  const dir = reportsDir()
  let names = []
  try {
    names = await readdir(dir)
  } catch {
    names = []
  }
  const items = names
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
    .sort()
    .reverse()
    .map((name) => ({ date: name.replace(/\.md$/, '') }))
  return sendJson(res, 200, { dir, items })
}

/** 读某一天的日报原文。 */
async function handleReportFile(res, body) {
  const date = String(body?.date ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期格式不对，应该是 2026-11-16')
  const file = join(reportsDir(), `${date}.md`)
  try {
    const markdown = await readFile(file, 'utf8')
    return sendJson(res, 200, { date, markdown, file })
  } catch {
    throw new Error(`没有 ${date} 的日报 —— 那天可能还没配好主机，或日报时间还没到`)
  }
}

async function handleSettings(res, body) {
  const state = await readState()
  const patch = body?.settings ?? {}
  const thresholds = body?.thresholds && typeof body.thresholds === 'object' ? body.thresholds : state.settings.thresholds
  const settings = {
    ...state.settings,
    ...patch,
    // 这两块是对象，整块覆盖会让页面没传的字段丢掉，所以按键合并
    auto: { ...autoSettings(state), ...(patch.auto ?? {}) },
    daily: { ...dailySettings(state), ...(patch.daily ?? {}) },
    thresholds,
  }
  await writeState({ ...state, settings })
  return sendJson(res, 200, {
    settings,
    thresholds: thresholdsOf({ settings }),
    scheduler: schedulerView({ settings }, Date.now()),
  })
}

/* ---------------------------------------------------------------- 小工具 */

/**
 * 页面把自身异常写回本机日志：面板白屏时，这里是唯一的现场证据。
 * 只保留最近 200KB，避免日志自己把磁盘写满。
 */
async function handleLog(res, body) {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    kind: String(body?.kind ?? 'unknown').slice(0, 40),
    message: String(body?.message ?? '').slice(0, 4000),
    stack: String(body?.stack ?? '').slice(0, 6000),
    extra: body?.extra ?? null,
  })
  const file = clientLogFile()
  let previous = ''
  try {
    previous = await readFile(file, 'utf8')
  } catch {
    previous = ''
  }
  const next = `${previous}${line}\n`.slice(-200 * 1024)
  // 目录通常已由 store 建好；mkdir 失败（例如沙箱拦了）不该连累写日志
  await mkdir(dirname(file), { recursive: true }).catch(() => {})
  await writeFile(file, next, { mode: 0o600 })
  return sendJson(res, 200, { ok: true, file })
}

function clientLogFile() {
  return join(stateDir(), 'client.log')
}

/**
 * 同源页面才能拿到的 nonce。注入脚本没生效时，页面靠这一步自举。
 *
 * 判断口径故意「只拒有证据的跨源」：Electron 里页面可能是 file://（Origin: null、
 * 没有 sec-fetch-* 头），一刀切要求同源会把桌面端直接锁死。
 */
async function handleHandshake(res, body, req) {
  const site = String(req?.headers?.['sec-fetch-site'] ?? '')
  const origin = String(req?.headers?.origin ?? '')
  const host = String(req?.headers?.host ?? '')
  let sameOrigin = true
  if (site === 'cross-site' || site === 'same-site') sameOrigin = false
  if (origin !== '' && origin !== 'null' && host !== '' && !origin.endsWith(`//${host}`)) sameOrigin = false
  if (!sameOrigin) return sendJson(res, 403, { error: 'cross-origin' })
  return sendJson(res, 200, { nonce: currentNonce() })
}

function trusted(req, nonce) {
  const header = req.headers['x-ops-nonce']
  return typeof header === 'string' && header.length === nonce.length && header === nonce
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

/** 有并发上限的 map，避免 10 台机器同时连把本机文件句柄打满。 */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

export { DIAGNOSTICS, newHostId }
