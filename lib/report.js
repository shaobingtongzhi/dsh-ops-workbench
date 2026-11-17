/**
 * 每日运维日报：把「体检结果」翻译成能直接发到群里、也能当作第二天行动清单的文字。
 *
 * 刻意不生成漂亮的 PDF：日报的价值在于「今天要做什么」，
 * 所以固定三段 —— 一句话结论 / 需要处理 / 明天先做这三件事。
 */
import { fmtGb, verdict } from './probe.js'

function pct(value) {
  return Number.isFinite(value) ? `${Math.round(value)}%` : '-'
}

function uptimeText(seconds) {
  if (!seconds) return '-'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  if (days > 0) return `${days} 天 ${hours} 小时`
  return `${hours} 小时`
}

function diskWorst(snapshot) {
  const disk = snapshot?.disks?.[0]
  return disk ? { text: `${disk.mount} ${disk.usedPct}%`, usedPct: disk.usedPct } : { text: '-', usedPct: 0 }
}

function dateLabel(ts) {
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const LEVEL_ICON = { crit: '🔴', warn: '🟠', info: '🔵', ok: '🟢', unreachable: '⚫' }

/**
 * 从趋势点里抽出「这段时间最难看的那一刻」——
 * 日报里最有信息量的不是当前值，而是「最低跌到多少、什么时候跌的」。
 */
function trendOf(points, now, hours = 24) {
  const since = now - hours * 3600e3
  const samples = (points ?? []).filter((point) => point && Number.isFinite(point.at) && point.at >= since)
  if (samples.length < 2) return null
  const pickMin = (key) => {
    let best = null
    for (const sample of samples) {
      const value = sample[key]
      if (!Number.isFinite(value)) continue
      if (!best || value < best.value) best = { value, at: sample.at }
    }
    return best
  }
  const pickMax = (key) => {
    let best = null
    for (const sample of samples) {
      const value = sample[key]
      if (!Number.isFinite(value)) continue
      if (!best || value > best.value) best = { value, at: sample.at }
    }
    return best
  }
  const first = samples[0]
  const last = samples[samples.length - 1]
  const rank = { ok: 0, info: 1, warn: 2, crit: 3 }
  const worsened = (rank[last.level] ?? 0) > (rank[first.level] ?? 0)
  const improved = (rank[last.level] ?? 0) < (rank[first.level] ?? 0)
  return {
    count: samples.length,
    memMin: pickMin('memAvailPct'),
    diskMax: pickMax('diskUsedPct'),
    loadMax: pickMax('loadPerCore'),
    first,
    last,
    worsened,
    improved,
  }
}

function clockOf(ts) {
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * @param {{hosts:Array, lastInspect:Object, now?:number}} input
 * @returns {{markdown:string, title:string, summary:string}}
 */
export function buildReport(input) {
  const now = input.now ?? Date.now()
  const title = `运维日报 ${dateLabel(now)}`
  const hosts = input.hosts ?? []
  const rows = hosts.map((host) => {
    const record = input.lastInspect?.[host.id]
    const snap = record?.snapshot
    return {
      host,
      record,
      snap,
      level: record?.level ?? 'unknown',
      disk: diskWorst(snap),
    }
  })

  const checked = rows.filter((row) => row.record)
  const critCount = checked.filter((row) => row.level === 'crit').length
  const warnCount = checked.filter((row) => row.level === 'warn').length
  const downCount = checked.filter((row) => row.level === 'unreachable').length

  let headline
  if (hosts.length === 0) headline = '还没有添加任何主机 —— 先在「主机」里加一台，之后每天只需点一次巡检。'
  else if (checked.length === 0) headline = `共 ${hosts.length} 台主机，今天还没有巡检过。`
  else if (critCount > 0) headline = `共 ${checked.length} 台主机，其中 ${critCount} 台需要马上处理，${warnCount} 台有隐患。`
  else if (downCount > 0 && warnCount > 0) headline = `共 ${checked.length} 台主机，${downCount} 台这次没连上，${warnCount} 台有隐患待跟进。`
  else if (downCount > 0) headline = `共 ${checked.length} 台主机，${downCount} 台这次没连上（其余正常）——先确认本机网络/代理是否就绪。`
  else if (warnCount > 0) headline = `共 ${checked.length} 台主机，没有紧急问题，${warnCount} 台有隐患待跟进。`
  else headline = `共 ${checked.length} 台主机，全部正常。`

  const lines = []
  lines.push(`# ${title}`)
  lines.push('')
  lines.push(`**一句话**：${headline}`)
  lines.push('')
  lines.push('## 总览')
  lines.push('')
  lines.push('| 主机 | 结论 | CPU | 内存可用 | 磁盘最高 | 负载/核 | 失败服务 | 运行时长 |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
  if (rows.length === 0) lines.push('| （无主机） | - | - | - | - | - | - | - |')
  for (const row of rows) {
    const snap = row.snap
    const name = row.host.name || row.host.host
    if (!snap) {
      lines.push(`| ${name} | 未巡检 | - | - | - | - | - | - |`)
      continue
    }
    const load = `${snap.load.l1.toFixed(2)} / ${snap.host.cores}`
    lines.push(
      `| ${name} | ${LEVEL_ICON[row.level] ?? '⚪'} ${verdict(row.level, row.record.issues.length)} | ${pct(snap.cpu.pct)} | ${fmtGb(snap.mem.availableBytes)} (${pct(snap.mem.availPct)}) | ${row.disk.text} | ${load} | ${snap.failedUnits.length} | ${uptimeText(snap.host.uptimeSec)} |`,
    )
  }

  const actionable = []
  for (const row of checked) {
    for (const issue of row.record.issues) {
      if (issue.level === 'crit' || issue.level === 'warn') actionable.push({ row, issue })
    }
  }

  // 趋势：只有多次采样才有意义（一次巡检就是「未知」）
  const trends = rows
    .map((row) => ({ row, trend: trendOf(input.history?.[row.host.id], now) }))
    .filter((item) => item.trend)
  if (trends.length > 0) {
    lines.push('')
    lines.push('## 最近 24 小时的走势')
    lines.push('')
    lines.push('| 主机 | 采样次数 | 内存可用最低 | 磁盘最高 | 负载峰值/核 | 结论变化 |')
    lines.push('| --- | --- | --- | --- | --- | --- |')
    for (const { row, trend } of trends) {
      const name = row.host.name || row.host.host
      const mem = trend.memMin
        ? `${pct(trend.memMin.value)}（${clockOf(trend.memMin.at)}）`
        : '-'
      const disk = trend.diskMax
        ? `${pct(trend.diskMax.value)}（${clockOf(trend.diskMax.at)}）`
        : '-'
      const load = trend.loadMax ? trend.loadMax.value.toFixed(2) : '-'
      const move = trend.worsened
        ? `变差 ${LEVEL_ICON[trend.first.level] ?? '⚪'}→${LEVEL_ICON[trend.last.level] ?? '⚪'}`
        : trend.improved
          ? `好转 ${LEVEL_ICON[trend.first.level] ?? '⚪'}→${LEVEL_ICON[trend.last.level] ?? '⚪'}`
          : '持平'
      lines.push(`| ${name} | ${trend.count} | ${mem} | ${disk} | ${load} | ${move} |`)
    }
    const worsening = trends.filter((item) => item.trend.worsened)
    if (worsening.length > 0) {
      lines.push('')
      for (const item of worsening) {
        lines.push(`- ⚠️ ${item.row.host.name || item.row.host.host} 昨天到今天的结论在变差，今天优先看它。`)
      }
    }
  }

  lines.push('')
  lines.push('## 需要处理')
  lines.push('')
  if (actionable.length === 0) {
    lines.push(checked.length === 0 ? '- 今天还没有巡检数据。' : '- 没有需要处理的问题，保持每日一次巡检即可。')
  } else {
    actionable.slice(0, 12).forEach((item, index) => {
      const name = item.row.host.name || item.row.host.host
      lines.push(`${index + 1}. ${LEVEL_ICON[item.issue.level]} **${name} · ${item.issue.title}**`)
      lines.push(`   - 为什么算问题：${item.issue.detail}`)
      lines.push(`   - 建议动作：${item.issue.fix}`)
    })
    if (actionable.length > 12) lines.push(`- 另有 ${actionable.length - 12} 项见工作台。`)
  }

  const infos = []
  for (const row of checked) {
    for (const issue of row.record.issues) {
      if (issue.level === 'info') infos.push(`${row.host.name || row.host.host}：${issue.title}`)
    }
  }
  if (infos.length > 0) {
    lines.push('')
    lines.push('## 顺带一提（不紧急）')
    lines.push('')
    for (const line of infos.slice(0, 6)) lines.push(`- ${line}`)
  }

  lines.push('')
  lines.push('## 明天先做这三件事')
  lines.push('')
  const todo = []
  for (const item of actionable) {
    const fix = item.issue.fix.split('；')[0]
    if (!todo.some((line) => line.includes(fix))) todo.push(`${item.row.host.name || item.row.host.host}：${fix}`)
    if (todo.length >= 3) break
  }
  if (todo.length === 0) {
    todo.push('保持每日一次巡检，重点看磁盘增长趋势与失败的定时任务')
    todo.push('确认备份任务真的在跑（有备份日志、且能恢复）')
    todo.push('检查安全组只放行必要端口')
  }
  todo.forEach((line, index) => lines.push(`${index + 1}. ${line}`))

  lines.push('')
  lines.push(`> 生成时间 ${new Date(now).toLocaleString('zh-CN')} · 数据来自最后一次只读巡检`)

  return { markdown: lines.join('\n'), title, summary: headline }
}
