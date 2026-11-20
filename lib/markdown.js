/**
 * 日报 Markdown：一次解析，两个出口
 *
 * 日报在页面上要「预览」，导出要「.md / .html」。如果页面和导出各写一遍
 * 「Markdown 转 HTML」，两边迟早长得不一样 —— 改了个字号，导出的还是旧的。
 * 所以只在宿主侧解析一次，页面拿 blocks 直接画，导出拿同一棵 blocks 拼 HTML。
 * （daily-worklog 也是这么定的，结论一样：一致性 > 少写一个解析器。）
 *
 * 和通用 Markdown 库的区别：日报是「有序列表项下面挂缩进子项」这种两层结构，
 * 通用库要么不认、要么把子项拆成独立列表。这里按 3 空格缩进认嵌套，够用且稳定。
 */

const HEADING = /^(#{1,6})\s+(.+?)\s*$/
const RULE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/
const QUOTE = /^\s{0,3}>\s?(.*)$/
const FENCE = /^\s{0,3}(`{3,}|~{3,})(.*)$/
const ITEM = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/

/** 小标题按语义上色：需要处理的红、顺带一提的灰，其余默认蓝。 */
const TONE = [
  [/需要处理|待处理|要处理|风险|故障|告警/, 'crit'],
  [/顺带|不紧急|其它|其他|备注|补充/, 'mute'],
]

/** 段落里第一个粗体是这几个词时，当成「导语」排版。 */
const LEAD = /^(一句话|结论|摘要|要点|总览)$/

/* ----------------------------------------------------------------- 解析 */

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 管道表格的一行 → 单元格数组。`\|` 是转义，不当分隔符。 */
export function splitRow(line) {
  const text = String(line ?? '').trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells = []
  let cell = ''
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\\' && text[index + 1] === '|') {
      cell += '|'
      index += 1
      continue
    }
    if (text[index] === '|') {
      cells.push(cell.trim())
      cell = ''
      continue
    }
    cell += text[index]
  }
  cells.push(cell.trim())
  return cells
}

/** 行内：**粗**、`代码`、[文字](链接)，其余原样。 */
export function parseInline(text) {
  const source = String(text ?? '')
  const nodes = []
  let plain = ''
  let index = 0
  const flushPlain = () => {
    if (plain) {
      nodes.push({ type: 'text', text: plain })
      plain = ''
    }
  }

  while (index < source.length) {
    if (source.startsWith('**', index)) {
      const end = source.indexOf('**', index + 2)
      if (end > index + 2) {
        flushPlain()
        nodes.push({ type: 'strong', text: source.slice(index + 2, end) })
        index = end + 2
        continue
      }
    }
    if (source[index] === '`') {
      const end = source.indexOf('`', index + 1)
      if (end > index + 1) {
        flushPlain()
        nodes.push({ type: 'code', text: source.slice(index + 1, end) })
        index = end + 1
        continue
      }
    }
    if (source[index] === '[') {
      const close = source.indexOf(']', index)
      if (close > index && source[close + 1] === '(') {
        const end = source.indexOf(')', close + 2)
        if (end > close) {
          flushPlain()
          nodes.push({ type: 'link', text: source.slice(index + 1, close), href: source.slice(close + 2, end) })
          index = end + 1
          continue
        }
      }
    }
    plain += source[index]
    index += 1
  }
  flushPlain()
  return nodes
}

function itemAt(line) {
  const match = String(line ?? '').match(ITEM)
  if (!match) return null
  return {
    indent: match[1].replace(/\t/g, '    ').length,
    ordered: /^\d/.test(match[2]),
    text: match[3].trim(),
  }
}

function startsTable(lines, index) {
  return String(lines[index] ?? '').includes('|') && TABLE_SEP.test(String(lines[index + 1] ?? ''))
}

function startsBlock(lines, index) {
  const line = String(lines[index] ?? '')
  return Boolean(
    HEADING.test(line)
    || RULE.test(line)
    || FENCE.test(line)
    || QUOTE.test(line)
    || itemAt(line)
    || startsTable(lines, index),
  )
}

/** 嵌套列表：缩进比本级更深的 `- xxx` 是上一条的子项。 */
function parseList(lines, start) {
  const first = itemAt(lines[start])
  const base = first.indent
  const ordered = first.ordered
  const items = []
  let index = start

  while (index < lines.length) {
    const line = lines[index]

    if (!line.trim()) {
      let next = index + 1
      while (next < lines.length && !lines[next].trim()) next += 1
      const info = next < lines.length ? itemAt(lines[next]) : null
      if (info && info.indent >= base) {
        index = next
        continue
      }
      break
    }

    const info = itemAt(line)
    if (info) {
      if (info.indent < base) break
      if (info.indent === base) {
        if (info.ordered !== ordered) break // 同层的另一种列表 = 另一个块
        items.push({ text: info.text, inline: parseInline(info.text), children: [] })
        index += 1
        continue
      }
      if (!items.length) break
      const sub = parseList(lines, index)
      items[items.length - 1].children.push(sub.block)
      index = sub.index > index ? sub.index : index + 1
      continue
    }

    // 缩进的续行并进上一条；顶格的普通行说明列表结束了
    if (items.length && /^\s+\S/.test(line) && !startsBlock(lines, index)) {
      const last = items[items.length - 1]
      last.text = `${last.text} ${line.trim()}`
      last.inline = parseInline(last.text)
      index += 1
      continue
    }
    break
  }

  return { block: { type: 'list', ordered, items }, index }
}

/** Markdown 文本 → 块数组（块内的文字已经拆成 inline 节点，客户端可以直接画）。 */
export function parseDocument(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }

    const fence = line.match(FENCE)
    if (fence) {
      const marker = fence[1]
      const lang = fence[2].trim()
      const body = []
      index += 1
      while (index < lines.length && !String(lines[index]).trim().startsWith(marker)) {
        body.push(lines[index])
        index += 1
      }
      index += 1
      blocks.push({ type: 'code', lang, text: body.join('\n') })
      continue
    }

    const heading = line.match(HEADING)
    if (heading) {
      const inline = parseInline(heading[2])
      const level = heading[1].length
      // 上色规则算在这里：页面和导出都读同一个 tone，省得两边各猜一遍
      blocks.push({ type: 'heading', level, inline, tone: level === 2 ? toneOf(inline) : '' })
      index += 1
      continue
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' })
      index += 1
      continue
    }

    if (startsTable(lines, index)) {
      const head = splitRow(line).map(parseInline)
      const rows = []
      index += 2
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
        rows.push(splitRow(lines[index]).map(parseInline))
        index += 1
      }
      blocks.push({ type: 'table', head, rows })
      continue
    }

    if (QUOTE.test(line)) {
      const buffer = []
      while (index < lines.length && QUOTE.test(lines[index])) {
        buffer.push(String(lines[index]).match(QUOTE)[1])
        index += 1
      }
      blocks.push({ type: 'quote', inline: parseInline(buffer.join(' ').trim()) })
      continue
    }

    if (itemAt(line)) {
      const list = parseList(lines, index)
      blocks.push(list.block)
      index = list.index
      continue
    }

    const buffer = [line.trim()]
    index += 1
    while (index < lines.length && lines[index].trim() && !startsBlock(lines, index)) {
      buffer.push(lines[index].trim())
      index += 1
    }
    const inline = parseInline(buffer.join(' '))
    const head = inline[0]
    // 「**一句话**：…」是导语：页面放大半号，导出同理
    blocks.push({ type: 'paragraph', inline, lead: Boolean(head && head.type === 'strong' && LEAD.test(head.text)) })
  }

  return blocks
}

/** 用第一个一级标题当文档标题（日报的 `# 运维日报 2026-11-20`）。 */
export function firstHeading(blocks) {
  const heading = (blocks ?? []).find((block) => block.type === 'heading' && block.level === 1)
  return heading ? heading.inline.map((node) => node.text).join('') : ''
}

/* ------------------------------------------------------------ HTML 导出 */

function plainText(nodes) {
  return (nodes ?? []).map((node) => node.text).join('')
}

function toneOf(nodes) {
  const text = plainText(nodes)
  for (const [pattern, tone] of TONE) if (pattern.test(text)) return tone
  return ''
}

function inlineToHtml(nodes) {
  return (nodes ?? []).map((node) => {
    if (node.type === 'strong') return `<strong>${escapeHtml(node.text)}</strong>`
    if (node.type === 'code') return `<code>${escapeHtml(node.text)}</code>`
    if (node.type === 'link') {
      return `<a href="${escapeHtml(node.href)}" target="_blank" rel="noreferrer noopener">${escapeHtml(node.text)}</a>`
    }
    return escapeHtml(node.text)
  }).join('')
}

function listToHtml(block) {
  const tag = block.ordered ? 'ol' : 'ul'
  const items = block.items.map((item) => {
    const children = item.children?.length
      ? item.children.map((child) => blockToHtml(child)).join('')
      : ''
    return `<li>${inlineToHtml(item.inline)}${children}</li>`
  }).join('')
  return `<${tag}>${items}</${tag}>`
}

function blockToHtml(block) {
  switch (block.type) {
    case 'heading': {
      const attr = block.tone ? ` class="tone-${block.tone}"` : ''
      return `<h${block.level}${attr}>${inlineToHtml(block.inline)}</h${block.level}>`
    }
    case 'paragraph':
      return `<p${block.lead ? ' class="lead"' : ''}>${inlineToHtml(block.inline)}</p>`
    case 'quote':
      return `<blockquote>${inlineToHtml(block.inline)}</blockquote>`
    case 'list':
      return listToHtml(block)
    case 'table': {
      const head = block.head.map((cell) => `<th>${inlineToHtml(cell)}</th>`).join('')
      const rows = block.rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineToHtml(cell)}</td>`).join('')}</tr>`).join('')
      return `<div class="table"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`
    }
    case 'code':
      return `<pre><code>${escapeHtml(block.text)}</code></pre>`
    case 'rule':
      return '<hr />'
    default:
      return ''
  }
}

/**
 * 导出的 HTML 和面板里的预览是同一套排版：
 * 小标题左侧色条、表头浅底、嵌套子项灰字加竖线、页脚引用块。
 * 面板窄所以字号小半号（13px）；导出的页面更宽，放大到 13.5px 更好读。
 */
const DOC_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; background: #f6f7f9; color: #1f2328; font-family: -apple-system, BlinkMacSystemFont,
    "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    -webkit-font-smoothing: antialiased; }
  .doc { max-width: 900px; margin: 0 auto; padding: 26px 18px 60px; }
  .doc-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 24px 28px 20px;
    font-size: 13.5px; line-height: 1.75; box-shadow: 0 1px 2px rgba(16,24,40,.04), 0 12px 32px rgba(16,24,40,.06); }
  .doc-card > :first-child { margin-top: 0; }
  .doc-card > :last-child { margin-bottom: 0; }
  h1 { font-size: 17px; font-weight: 600; margin: 0 0 14px; padding-bottom: 10px; border-bottom: 1px solid #e8eaee;
    letter-spacing: .01em; }
  h2 { font-size: 13.5px; font-weight: 600; margin: 24px 0 9px; padding-left: 11px; position: relative; }
  h2::before { content: ""; position: absolute; left: 0; top: .36em; width: 3px; height: .92em; border-radius: 2px;
    background: #2f6feb; opacity: .85; }
  h2.tone-crit::before { background: #d1453b; opacity: 1; }
  h2.tone-mute::before { background: #9aa0aa; opacity: 1; }
  h3, h4, h5, h6 { font-size: 13px; font-weight: 600; margin: 18px 0 6px; }
  p { margin: 9px 0; }
  p.lead { font-size: 13.8px; }
  strong { font-weight: 600; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; padding: 1px 5px;
    border-radius: 4px; background: #f1f2f4; }
  a { color: #2f6feb; text-decoration: none; }
  a:hover { text-decoration: underline; }
  ul, ol { margin: 9px 0; padding-left: 22px; }
  li { margin: 5px 0; }
  li::marker { color: #9aa0aa; }
  li > ul, li > ol { margin: 5px 0 8px; padding-left: 16px; border-left: 2px solid #e8eaee; color: #6b7280;
    font-size: 12.5px; list-style: disc; }
  blockquote { margin: 16px 0 0; padding: 9px 12px; border-left: 3px solid #e2e5e9; border-radius: 0 8px 8px 0;
    background: #f6f7f9; color: #6b7280; font-size: 12px; }
  blockquote p { margin: 0; }
  hr { border: 0; border-top: 1px solid #e8eaee; margin: 18px 0; }
  pre { margin: 10px 0; padding: 11px 13px; border-radius: 8px; background: #f6f7f9; overflow: auto; }
  pre code { background: none; padding: 0; font-size: 12px; line-height: 1.55; }
  .table { margin: 10px 0 6px; border: 1px solid #e8eaee; border-radius: 9px; overflow: auto; }
  .table table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .table th { text-align: left; font-weight: 600; font-size: 11.5px; color: #6b7280; padding: 7px 10px;
    border-bottom: 1px solid #e5e7eb; background: #f6f7f9; white-space: nowrap; }
  .table td { padding: 6px 10px; border-bottom: 1px solid #eef0f3; vertical-align: middle; }
  .table tbody tr:last-child td { border-bottom: none; }
  .table tbody tr:hover td { background: #fafbfc; }
  .table td:first-child { font-weight: 500; }
  .doc-meta { margin: 14px 2px 0; font-size: 11.5px; color: #9aa0aa; }
  @media print {
    body { background: #fff; }
    .doc { max-width: none; padding: 0; }
    .doc-card { border: none; border-radius: 0; padding: 0; box-shadow: none; }
    .doc-meta { display: none; }
    h2 { break-after: avoid; }
    .table { break-inside: avoid; }
  }
`

/**
 * 拼一份「单文件」HTML：样式内联，双击就能看，也能直接打印成 PDF。
 * @param {string} markdown
 * @param {{title?:string, exportedAt?:number|string}} [options]
 */
export function markdownToHtml(markdown, options = {}) {
  const blocks = parseDocument(markdown)
  const title = options.title || firstHeading(blocks) || '运维日报'
  const when = options.exportedAt ? new Date(options.exportedAt) : new Date()
  const body = blocks.map((block) => blockToHtml(block)).join('\n')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="generator" content="ops-workbench" />
<title>${escapeHtml(title)}</title>
<style>${DOC_CSS}</style>
</head>
<body>
<main class="doc">
<article class="doc-card">
${body}
</article>
<p class="doc-meta">运维工作台 · 导出于 ${escapeHtml(when.toLocaleString('zh-CN'))}</p>
</main>
</body>
</html>
`
}

/** 文件名里不能出现的字符，顺手挡掉。 */
export function safeFilename(name, fallback = '运维日报') {
  const clean = String(name ?? '').replace(/[\\/:*?"<>|\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim()
  return clean || fallback
}
