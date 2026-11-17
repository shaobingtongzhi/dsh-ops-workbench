/**
 * 只读体检：一段远端脚本 + 一套本地解析 + 一套打分规则。
 *
 * 设计原则
 * 1. 一条连接、一段脚本、一次往返：三个采样点（cpu0→sleep 1→cpu1，net0→net1）
 *    让 CPU 使用率和网卡速率是「真测量」而不是开机均值。
 * 2. 只用 /proc 和 posix 工具，不装任何东西到服务器；工具缺失只会让某一节空着，
 *    不会让整次巡检失败。
 * 3. 解析在本地做：远端只负责吐原文，出问题时能直接看到原始输出。
 */

export const INSPECT_SCRIPT = String.raw`
export LC_ALL=C
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH
s() { printf '@@%s\n' "$1"; }
s meta; cat /etc/os-release 2>/dev/null | head -n 12; echo "--uname--"; uname -nrms
s cores; nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || grep -c '^processor' /proc/cpuinfo
s uptime; cat /proc/uptime 2>/dev/null
s load; cat /proc/loadavg 2>/dev/null
s cpu0; head -n 1 /proc/stat
s net0; cat /proc/net/dev 2>/dev/null
s mem; cat /proc/meminfo 2>/dev/null | head -n 32
s swap0; grep -E '^(pswpin|pswpout)' /proc/vmstat 2>/dev/null
s free; free -b 2>/dev/null
s disk; df -P -k -x tmpfs -x devtmpfs 2>/dev/null | head -n 26 || df -P -k | head -n 26
s inode; df -Pi -x tmpfs -x devtmpfs 2>/dev/null | head -n 26
s topcpu; ps -eo pid=,comm=,pcpu=,pmem= --sort=-pcpu 2>/dev/null | head -n 8
s topmem; ps -eo pid=,comm=,pcpu=,pmem= --sort=-pmem 2>/dev/null | head -n 8
s units; systemctl --failed --no-legend --plain 2>/dev/null | head -n 12
s sysstate; systemctl is-system-running 2>/dev/null
s ports; (ss -lntu 2>/dev/null || netstat -lntu 2>/dev/null) | head -n 40
s zombie; ps -eo stat= 2>/dev/null | grep -c '^Z'
s users; who 2>/dev/null | head -n 5
s clock; date -u +%s
sleep 1
s cpu1; head -n 1 /proc/stat
s net1; cat /proc/net/dev 2>/dev/null
s swap1; grep -E '^(pswpin|pswpout)' /proc/vmstat 2>/dev/null
s up2; cat /proc/uptime 2>/dev/null
s done; echo ok
`

/** 把 @@section 切成 map，行数组。 */
export function splitSections(stdout) {
  const map = new Map()
  let current = null
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    const hit = /^@@(\S+)\s*$/.exec(line)
    if (hit) {
      current = hit[1]
      map.set(current, [])
      continue
    }
    if (current) map.get(current).push(line)
  }
  return map
}

const pagesOf = (rows, key) => {
  const row = rows.find((line) => line.split(/\s+/)[0] === key)
  return row ? num(row.split(/\s+/)[1]) : 0
}

const num = (value) => {
  const n = Number(String(value ?? '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function cpuSample(line) {
  const fields = String(line ?? '').trim().split(/\s+/).slice(1).map(Number)
  const [user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0] = fields
  const total = user + nice + system + idle + iowait + irq + softirq + steal
  return { total, idle: idle + iowait, iowait, system, user }
}

function netCounters(lines) {
  const map = new Map()
  for (const line of lines) {
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const name = line.slice(0, colon).trim()
    if (!name || name === 'Inter-|' || name === 'face') continue
    const cells = line.slice(colon + 1).trim().split(/\s+/)
    if (cells.length < 16) continue
    map.set(name, { rx: num(cells[0]), tx: num(cells[8]) })
  }
  return map
}

function meminfo(lines) {
  const out = {}
  for (const line of lines) {
    const hit = /^(\w+):\s+(\d+)/.exec(line)
    if (hit) out[hit[1]] = Number(hit[2]) * 1024
  }
  return out
}

const CONTAINER_LAYER = /\/(overlay2|overlay)\/|\/merged$/
// 卡片和巡检表的第一行画的是 disks[0]，必须是根分区。
// 按占用比例排序会让"某个 100% 的 snap 分区"或"数据盘"顶到第一行，看着像系统盘满了。
const diskOrder = (a, b) => {
  const rootDiff = Number(b.mount === '/') - Number(a.mount === '/')
  if (rootDiff !== 0) return rootDiff
  return b.usedPct - a.usedPct || b.sizeBytes - a.sizeBytes
}
const PSEUDO_FS = new Set(['tmpfs', 'devtmpfs', 'squashfs', 'nsfs', 'shm', 'none', 'ramfs', 'cgroup', 'cgroup2', 'sysfs', 'proc'])

function dfRows(lines) {
  const rows = []
  const seen = new Set()
  for (const line of lines) {
    const cells = line.trim().split(/\s+/)
    if (cells.length < 6) continue
    if (/^(Filesystem|文件系统)$/i.test(cells[0])) continue
    const mount = cells.slice(5).join(' ')
    if (/^\/(dev|sys|proc|run)(\/|$)/.test(mount)) continue
    if (mount === '/dev/shm') continue
    // 容器镜像层不是块设备：overlay2/<64位>/merged 这类路径重复且超长，
    // 主机视角下没有信息量（它们和宿主机 / 是同一块盘），混进来只会把卡片撑变形。
    if (PSEUDO_FS.has(String(cells[0]).toLowerCase())) continue
    if (CONTAINER_LAYER.test(mount)) continue
    // snap 包是只读 squashfs 挂在 loop 设备上，永远 100% 满。
    // 它们不是"磁盘快满了"，混进列表会直接把这台机器判成 crit。
    if (/^\/dev\/loop\d*$/.test(cells[0])) continue
    if (/^\/(snap|var\/lib\/snapd)(\/|$)/.test(mount)) continue
    if (mount.length > 120) continue
    if (seen.has(mount)) continue
    seen.add(mount)
    const sizeKb = num(cells[1])
    if (sizeKb <= 0) continue
    rows.push({
      fs: cells[0],
      sizeBytes: sizeKb * 1024,
      usedBytes: num(cells[2]) * 1024,
      availBytes: num(cells[3]) * 1024,
      usedPct: num(String(cells[4]).replace('%', '')),
      mount,
    })
  }
  return rows
}

function psRows(lines) {
  const rows = []
  for (const line of lines) {
    const cells = line.trim().split(/\s+/)
    if (cells.length < 4) continue
    const pid = num(cells[0])
    if (!pid) continue
    const pmem = num(cells[cells.length - 1])
    const pcpu = num(cells[cells.length - 2])
    rows.push({ pid, command: cells.slice(1, -2).join(' ').slice(0, 40), cpuPct: pcpu, memPct: pmem })
  }
  return rows
}

function portRows(lines) {
  const seen = new Set()
  const rows = []
  for (const line of lines) {
    const cells = line.trim().split(/\s+/)
    if (cells.length < 5) continue
    const proto = cells[0].toLowerCase()
    if (proto !== 'tcp' && proto !== 'udp') continue
    const local = cells[4]
    const cut = local.lastIndexOf(':')
    if (cut < 0) continue
    const addr = local.slice(0, cut).replace(/%.*$/, '')
    const port = num(local.slice(cut + 1))
    if (!port) continue
    const key = proto + ':' + addr + ':' + port
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({ proto, addr, port, exposed: addr === '0.0.0.0' || addr === '*' || addr === '::' || addr === '[::]' })
  }
  return rows.sort((a, b) => a.port - b.port)
}

/** 解析远端输出 → 快照。任何一节缺失都不抛错，只是字段为 0/空。 */
export function parseSnapshot(stdout, now = Date.now()) {
  const sec = splitSections(stdout)
  const lines = (name) => sec.get(name) ?? []
  const text = (name) => lines(name).join('\n').trim()

  const osLine = (() => {
    const meta = lines('meta')
    const cut = meta.indexOf('--uname--')
    const release = meta.slice(0, cut < 0 ? meta.length : cut)
    const uname = cut >= 0 ? meta[cut + 1]?.trim() : ''
    const kv = {}
    for (const line of release) {
      const hit = /^([A-Z_]+)=(.*)$/.exec(line.trim())
      if (hit) kv[hit[1]] = hit[2].replace(/^"|"$/g, '')
    }
    return { pretty: kv.PRETTY_NAME || kv.NAME || 'Linux', version: kv.VERSION_ID || '', uname: uname || '' }
  })()

  const cores = Math.max(1, Math.round(num(lines('cores')[0])) || 1)

  const cpu0 = cpuSample(lines('cpu0')[0])
  const cpu1 = cpuSample(lines('cpu1')[0])
  const dTotal = Math.max(0, cpu1.total - cpu0.total)
  const dIdle = Math.max(0, cpu1.idle - cpu0.idle)
  const cpuPct = dTotal > 0 ? Math.max(0, Math.min(100, ((dTotal - dIdle) / dTotal) * 100)) : 0
  const iowaitPct = dTotal > 0 ? Math.max(0, Math.min(100, ((cpu1.iowait - cpu0.iowait) / dTotal) * 100)) : 0

  const netA = netCounters(lines('net0'))
  const netB = netCounters(lines('net1'))
  const interfaces = []
  for (const [name, b] of netB) {
    if (name === 'lo') continue
    const a = netA.get(name) ?? b
    interfaces.push({ name, rxBps: Math.max(0, b.rx - a.rx), txBps: Math.max(0, b.tx - a.tx) })
  }
  interfaces.sort((x, y) => y.rxBps + y.txBps - (x.rxBps + x.txBps))

  const mi = meminfo(lines('mem'))
  const memTotal = mi.MemTotal ?? 0
  const memAvailable = mi.MemAvailable ?? (mi.MemFree ?? 0) + (mi.Buffers ?? 0) + (mi.Cached ?? 0)
  const memAvailPct = memTotal > 0 ? (memAvailable / memTotal) * 100 : 0

  const freeLines = lines('free')
  let swapTotal = mi.SwapTotal ?? 0
  let swapUsed = swapTotal - (mi.SwapFree ?? 0)
  for (const line of freeLines) {
    if (/^Swap:/i.test(line.trim())) {
      const cells = line.trim().split(/\s+/)
      swapTotal = num(cells[1])
      swapUsed = num(cells[2])
    }
  }

  const loadParts = String(lines('load')[0] ?? '').trim().split(/\s+/)
  const load = { l1: num(loadParts[0]), l5: num(loadParts[1]), l15: num(loadParts[2]) }
  const expectedSkew = Math.round((now - num(lines('clock')[0]) * 1000) / 1000)

  // 采样间隔 + swap 换入换出速率：
  // 「可用内存低」本身不一定会卡，真正会卡的是内核正在把页换出（pswpout），
  // 以及被换出去的页又被换回来（pswpin）。所以按 /proc/vmstat 的增量算每秒页数。
  const sampleSec = Math.max(0.2, num((lines('up2')[0] ?? '').split(/\s+/)[0]) - num((lines('uptime')[0] ?? '').split(/\s+/)[0]))
  const before = { in: pagesOf(lines('swap0'), 'pswpin'), out: pagesOf(lines('swap0'), 'pswpout') }
  const after = { in: pagesOf(lines('swap1'), 'pswpin'), out: pagesOf(lines('swap1'), 'pswpout') }
  const swapInPagesPerSec = Math.max(0, (after.in - before.in) / sampleSec)
  const swapOutPagesPerSec = Math.max(0, (after.out - before.out) / sampleSec)
  const swapActive = swapInPagesPerSec + swapOutPagesPerSec

  const failedUnits = lines('units')
    .map((line) => line.replace(/^\W+/, '').split(/\s+/)[0])
    .filter((name) => name && name.includes('.'))

  return {
    at: now,
    host: {
      hostname: osLine.uname.split(/\s+/)[0] || '',
      os: osLine.pretty,
      kernel: osLine.uname.split(/\s+/)[1] || '',
      arch: osLine.uname.split(/\s+/)[2] || '',
      cores,
      uptimeSec: Math.round(num((lines('uptime')[0] ?? '').split(/\s+/)[0])),
      clockSkewSec: expectedSkew,
    },
    load: { ...load, perCore: load.l1 / cores },
    cpu: { pct: cpuPct, iowaitPct, cores },
    mem: {
      totalBytes: memTotal,
      availableBytes: memAvailable,
      availPct: memAvailPct,
      swapTotalBytes: swapTotal,
      swapUsedPct: swapTotal > 0 ? (swapUsed / swapTotal) * 100 : 0,
      // 采样窗口内的实际换页速率（页/秒、MB/秒），用来区分「只是余量薄」和「真的在拿磁盘当内存」
      swapInPagesPerSec: Number(swapInPagesPerSec.toFixed(2)),
      swapOutPagesPerSec: Number(swapOutPagesPerSec.toFixed(2)),
      swapActive: Number(swapActive.toFixed(2)),
      swapRateMBps: Number((swapActive * 4096 / 1048576).toFixed(3)),
      sampleSec: Number(sampleSec.toFixed(2)),
    },
    net: {
      interfaces: interfaces.slice(0, 6),
      rxBps: interfaces.reduce((sum, item) => sum + item.rxBps, 0),
      txBps: interfaces.reduce((sum, item) => sum + item.txBps, 0),
    },
    disks: dfRows(lines('disk')).sort(diskOrder).slice(0, 8),
    inodes: dfRows(lines('inode')).sort((a, b) => b.usedPct - a.usedPct).slice(0, 5),
    topCpu: psRows(lines('topcpu')).slice(0, 6),
    topMem: psRows(lines('topmem')).slice(0, 6),
    failedUnits,
    systemState: text('sysstate').split(/\s+/)[0] || '',
    ports: portRows(lines('ports')),
    zombies: Math.round(num(lines('zombie')[0])),
    users: lines('users').filter(Boolean).slice(0, 5),
    raw: { systemState: text('sysstate') },
  }
}

export const DEFAULT_THRESHOLDS = {
  cpuPct: { warn: 85, crit: 95 },
  memAvailPct: { warn: 15, crit: 8 },
  swapUsedPct: { warn: 40, crit: 75 },
  diskUsedPct: { warn: 85, crit: 93 },
  inodeUsedPct: { warn: 85, crit: 95 },
  loadPerCore: { warn: 1, crit: 2 },
  clockSkewSec: { warn: 60, crit: 300 },
  failedUnits: { warn: 1, crit: 3 },
}

const LEVELS = { crit: 3, warn: 2, info: 1, ok: 0 }

function pick(value, rule, invert = false) {
  if (invert) {
    if (value <= rule.crit) return 'crit'
    if (value <= rule.warn) return 'warn'
    return 'ok'
  }
  if (value >= rule.crit) return 'crit'
  if (value >= rule.warn) return 'warn'
  return 'ok'
}

const fmtGb = (bytes) => (bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 0 : 1) + ' GB'
const fmtRate = (bps) => {
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let value = Math.max(0, bps)
  let i = 0
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1 }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`
}

/**
 * 打分：把快照变成「结论 + 若干条问题」。
 * 每条问题都带原因（为什么算问题）和处置建议（下一步做什么），
 * 这不是装饰：运维新手的真正门槛就是「看到数字不知道要不要管」。
 */
export function evaluate(snapshot, thresholds = DEFAULT_THRESHOLDS) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds }
  const issues = []
  const add = (level, key, title, detail, fix) => {
    if (level === 'ok') return
    issues.push({ level, key, title, detail, fix })
  }

  const cpu = Math.round(snapshot.cpu.pct)
  add(pick(cpu, t.cpuPct), 'cpu', `CPU 使用率 ${cpu}%`,
    cpu >= t.cpuPct.crit
      ? `连续采样 1 秒平均 ${cpu}%，已经接近打满；此时新请求会排队、接口变慢`
      : `平均 ${cpu}%，明显偏高但还没打满`,
    snapshot.topCpu[0]
      ? `先看谁在吃 CPU：${snapshot.topCpu.slice(0, 3).map((p) => `${p.command}(${Math.round(p.cpuPct)}%)`).join('、')}。偶发高峰可以等，持续 5 分钟以上再考虑扩容或限流`
      : '进入「排障」看进程 TOP，确认是哪个程序在跑')

  const memAvail = Math.round(snapshot.mem.availPct)
  const swapIn = snapshot.mem.swapInPagesPerSec ?? 0
  const swapOut = snapshot.mem.swapOutPagesPerSec ?? 0
  const swapRate = (swapIn + swapOut) * 4096 / 1048576 // MB/s
  // 每秒 4 页（约 16KB）以上才算内核真的在换页；低于这个量级只是零星抖动
  const swapping = (snapshot.mem.swapActive ?? 0) >= 4
  const memLevel = pick(memAvail, t.memAvailPct, true)
  const memSec = Math.max(0.2, snapshot.mem.sampleSec ?? 1).toFixed(1)
  if (swapping) {
    add(memLevel, 'mem', `可用内存 ${memAvail}%，正在换页`,
      `总 ${fmtGb(snapshot.mem.totalBytes)}，可用 ${fmtGb(snapshot.mem.availableBytes)}；采样这 ${memSec} 秒内换入 ${swapIn.toFixed(1)} 页/秒、换出 ${swapOut.toFixed(1)} 页/秒，磁盘当内存用会慢一个数量级`,
      '先看内存 TOP 找出在涨的进程，再决定重启它还是扩容；不要 echo 3 > drop_caches 掩盖问题')
  } else {
    // 可用内存低但没在换页：只是余量薄，还没真的拖慢机器，降一档提示
    add(memLevel === 'crit' ? 'warn' : memLevel, 'mem', `可用内存只剩 ${memAvail}%`,
      `总 ${fmtGb(snapshot.mem.totalBytes)}，可用 ${fmtGb(snapshot.mem.availableBytes)}；采样这 ${memSec} 秒没有换入换出，说明余量薄但暂时不卡。危险的是「再涨一点就开始换」`,
      '别急着动手：先看内存 TOP 里谁最大、是不是它一直在涨；有余量就先不动，真要腾地方优先调小 Java 堆 / MySQL 缓冲池')
  }

  const swapPct = Math.round(snapshot.mem.swapUsedPct)
  if (swapPct >= 20 || (swapPct > 0 && swapping)) {
    add(swapping ? pick(swapPct, t.swapUsedPct) : (swapPct >= 40 ? 'warn' : 'info'), 'swap', `swap 已用 ${swapPct}%`,
      swapping
        ? '正在换页：swap 里的页被反复换进换出，每次都要走磁盘，这是「整机变卡」的直接原因'
        : 'swap 里有页说明物理内存曾经紧张过，但现在没在换，暂时不影响速度；留个记录看趋势就行',
      '加内存，或把常驻大内存的服务（数据库、Java）的堆/缓冲池参数调小；数据库类服务别指望 swap')
  }

  for (const disk of snapshot.disks.slice(0, 4)) {
    add(pick(disk.usedPct, t.diskUsedPct), `disk:${disk.mount}`, `${disk.mount} 使用率 ${disk.usedPct}%`,
      `${disk.mount} 已用 ${fmtGb(disk.usedBytes)} / ${fmtGb(disk.sizeBytes)}，剩 ${fmtGb(disk.availBytes)}；超过 93% 后日志写不进去会连带服务异常`,
      '排障 → 磁盘大目录找出占空间的东西；优先清 /var/log 与旧备份，别删 /var/lib 下的数据')
  }

  for (const node of snapshot.inodes.slice(0, 2)) {
    add(pick(node.usedPct, t.inodeUsedPct), `inode:${node.mount}`, `${node.mount} inode 使用率 ${node.usedPct}%`,
      'inode 用尽时磁盘还有空间也写不进新文件，常见于 session 文件、缓存小文件堆积',
      '排障 → 磁盘大目录；或 find 该挂载点下小文件最多的目录')
  }

  const loadPerCore = Number(snapshot.load.perCore.toFixed(2))
  add(pick(loadPerCore, t.loadPerCore), 'load', `1 分钟负载 ${snapshot.load.l1.toFixed(2)}，单核 ${loadPerCore}`,
    loadPerCore >= t.loadPerCore.crit
      ? '负载超过核数 2 倍，队列在堆积，用户在等'
      : '负载高于核数，说明任务排队中',
    '负载高但 CPU 不高 → 多半卡在磁盘 IO 或网络等待，看排障里的 IO/进程状态；CPU 也高 → 看进程 TOP')

  add(pick(Math.abs(snapshot.host.clockSkewSec), t.clockSkewSec), 'clock',
    `服务器时钟偏差 ${snapshot.host.clockSkewSec > 0 ? '+' : ''}${snapshot.host.clockSkewSec} 秒`,
    '时钟不准会导致日志时间错乱、HTTPS 证书校验失败、定时任务提前/延后触发',
    '开时间同步：timedatectl set-ntp true（或装 chrony），然后 timedatectl status 确认 synchronized')

  add(pick(snapshot.failedUnits.length, t.failedUnits), 'units',
    `${snapshot.failedUnits.length} 个 systemd 服务处于 failed`,
    snapshot.failedUnits.join('、'),
    'systemctl status <服务名> 看退出原因，再看 journalctl -u <服务名> -n 50；修好后 systemctl reset-failed')

  if (snapshot.systemState && snapshot.systemState !== 'running') {
    add(snapshot.systemState === 'degraded' ? 'warn' : 'info', 'sysstate', `systemd 整体状态：${snapshot.systemState}`,
      'degraded 表示有单元失败，通常与上面的 failed 服务同源',
      'systemctl --failed 看清单')
  }

  if (snapshot.zombies > 3) {
    add('warn', 'zombie', `僵尸进程 ${snapshot.zombies} 个`,
      '僵尸本身不占资源，但持续增加说明父进程没回收子进程，往往意味着某个服务在反复 fork 失败',
      'ps -eo stat,ppid,pid,comm | awk \'$1 ~ /^Z/\' 找到父进程，重启对应服务')
  }

  const exposed = snapshot.ports.filter((p) => p.exposed)
  const risky = exposed.filter((p) => ![22, 80, 443, 50602].includes(p.port))
  if (risky.length > 0) {
    add('info', 'ports', `${risky.length} 个端口对整个网络监听`,
      risky.slice(0, 8).map((p) => `${p.proto}/${p.port}`).join('、') + '；云服务器上这些端口会被公网扫到',
      '确认是否必要：云安全组只放行 22/80/443；数据库、Redis、管理后台只允许内网访问')
  }

  if (snapshot.ports.length === 0) {
    add('info', 'ports-empty', '没读到监听端口', 'ss 与 netstat 都不可用，或输出被截断', '装 iproute2（ss）后重试')
  }

  issues.sort((a, b) => LEVELS[b.level] - LEVELS[a.level])
  const level = issues.reduce((worst, item) => (LEVELS[item.level] > LEVELS[worst] ? item.level : worst), 'ok')
  return { level, issues, thresholds: t }
}

/** 一句话结论，日报与列表都用它。 */
export function verdict(level, issueCount) {
  if (level === 'unreachable') return `连不上（${issueCount} 项异常）`
  if (level === 'crit') return `需要马上处理（${issueCount} 项异常）`
  if (level === 'warn') return `有隐患待跟进（${issueCount} 项）`
  if (level === 'info') return `基本正常（${issueCount} 条提醒）`
  return '一切正常'
}

export { fmtGb, fmtRate }
