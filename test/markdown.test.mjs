/**
 * 单测：日报 Markdown → 预览块 / 导出 HTML（不跑页面、不连服务器）。
 *
 * 盯的是三件容易悄悄坏掉的事：
 *   1. 嵌套列表：`1. 标题` 下面 3 空格缩进的 `- 为什么算问题` 必须挂在同一项里，
 *      拆成独立列表的话，页面上「问题」和「怎么处理」就分家了；
 *   2. 预览和导出同源：导出的 HTML 必须来自同一棵 blocks，否则改版后两边会分叉；
 *   3. 转义：日报里有主机名、日志片段，`<` 和 `|` 不能把页面搞坏。
 */
import assert from 'node:assert/strict'
import {
  parseDocument,
  markdownToHtml,
  splitRow,
  parseInline,
  safeFilename,
  firstHeading,
} from '../lib/markdown.js'

let pass = 0
const check = (label, fn) => { fn(); console.log(`  ok  ${label}`); pass += 1 }

const REPORT = `# 运维日报 2026-11-20

**一句话**：共 3 台主机，其中 1 台需要马上处理，1 台有隐患。

## 总览

| 主机 | 结论 | CPU | 内存可用 | 磁盘最高 | 负载/核 | 失败服务 | 运行时长 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 内网工作站 | 🔴 有紧急问题 | 18% | 1.2 GB (12%) | / 96% | 1.20 / 8 | 2 | 12天3小时 |
| 自用服务器 | 🟠 有待跟进 | 3% | 6.4 GB (63%) | /data 61% | 0.31 / 4 | 0 | 42天7小时 |

## 最近 24 小时的走势

| 主机 | 采样次数 | 内存可用最低 | 磁盘最高 | 负载峰值/核 | 结论变化 |
| --- | --- | --- | --- | --- | --- |
| 内网工作站 | 3 | 11%（11-19 16:20） | 96%（11-20 08:10） | 1.42 | 变差 🟠→🔴 |

- ⚠️ 内网工作站 昨天到今天的结论在变差，今天优先看它。

## 需要处理

1. 🔴 **内网工作站 · swap 已用 100%**
   - 为什么算问题：swap 打满说明内存不够，进程随时可能被 OOM 杀掉。
   - 建议动作：先看 \`free -h\` 和占用最高的进程；确认不是内存泄漏再加内存。
2. 🟠 **内网工作站 · 磁盘 / 已用 96%**
   - 为什么算问题：写满后服务会直接报错。
   - 建议动作：清理旧日志。

## 顺带一提（不紧急）

- 自用服务器：18 个端口在监听

## 明天先做这三件事

1. 内网工作站：先看 free -h 和占用最高的进程
2. 保持每日一次巡检

> 生成时间 2026-11-20 09:00:12 · 数据来自最后一次只读巡检`

const blocks = parseDocument(REPORT)
const kinds = blocks.map((block) => block.type)

check('块顺序：标题 / 导语 / 小标题 / 表格 / 列表 / 引用', () => {
  assert.deepEqual(kinds, [
    'heading', 'paragraph',
    'heading', 'table',
    'heading', 'table', 'list',
    'heading', 'list',
    'heading', 'list',
    'heading', 'list',
    'quote',
  ])
})

check('一级标题就是文档标题', () => {
  assert.equal(firstHeading(blocks), '运维日报 2026-11-20')
})

check('导语里的粗体被拆成 strong 节点', () => {
  const lead = blocks[1]
  assert.equal(lead.inline[0].type, 'strong')
  assert.equal(lead.inline[0].text, '一句话')
})

check('总览表 8 列 2 行，单元格保留 emoji 与百分号', () => {
  const table = blocks[3]
  assert.equal(table.head.length, 8)
  assert.equal(table.head[0][0].text, '主机')
  assert.equal(table.rows.length, 2)
  assert.equal(table.rows[0][1][0].text, '🔴 有紧急问题')
})

check('需要处理：两条，每条都挂着缩进子项（不是独立列表）', () => {
  const list = blocks[8]
  assert.equal(list.ordered, true)
  assert.equal(list.items.length, 2)
  assert.equal(list.items[0].inline[0].text, '🔴 ')
  assert.equal(list.items[0].inline[1].type, 'strong')
  assert.equal(list.items[0].inline[1].text, '内网工作站 · swap 已用 100%')
  assert.equal(list.items[0].children.length, 1)
  const sub = list.items[0].children[0]
  assert.equal(sub.type, 'list')
  assert.equal(sub.ordered, false)
  assert.equal(sub.items.length, 2)
  assert.ok(sub.items[0].inline[0].text.startsWith('为什么算问题：'), sub.items[0].inline[0].text)
  assert.ok(sub.items[1].inline[0].text.startsWith('建议动作：'), sub.items[1].inline[0].text)
})

check('子项里的行内代码变成 code 节点，没有把整行吞掉', () => {
  const fix = blocks[8].items[0].children[0].items[1].inline
  const code = fix.find((node) => node.type === 'code')
  assert.equal(code.text, 'free -h')
  const joined = fix.map((node) => node.text).join('')
  assert.ok(joined.includes('：先看 '))
  assert.ok(joined.endsWith('确认不是内存泄漏再加内存。'))
})

check('走势小标题后面的 ⚠️ 列表是独立块', () => {
  const warn = blocks[6]
  assert.equal(warn.type, 'list')
  assert.equal(warn.ordered, false)
  assert.ok(warn.items[0].inline[0].text.startsWith('⚠️ 内网工作站'))
})

check('页脚是引用块', () => {
  assert.equal(blocks[13].type, 'quote')
  assert.ok(blocks[13].inline[0].text.startsWith('生成时间 2026-11-20 09:00:12'))
})

/* --------------------------------------------------------------- 行内与表格 */

check('转义竖线不拆单元格', () => {
  assert.deepEqual(splitRow('| a \\| b | c |'), ['a | b', 'c'])
})

check('行内解析：粗体优先于代码，链接带 href', () => {
  assert.deepEqual(parseInline('**a** `b` [c](http://x) d'), [
    { type: 'strong', text: 'a' },
    { type: 'text', text: ' ' },
    { type: 'code', text: 'b' },
    { type: 'text', text: ' ' },
    { type: 'link', text: 'c', href: 'http://x' },
    { type: 'text', text: ' d' },
  ])
})

/* ------------------------------------------------------------------ 导出 */

const html = markdownToHtml(REPORT, { title: '运维日报 2026-11-20', exportedAt: Date.parse('2026-11-20T09:00:12Z') })

check('HTML 是单文件（内联样式 + 中文 lang + 标题）', () => {
  assert.ok(html.startsWith('<!doctype html>'))
  assert.ok(html.includes('<html lang="zh-CN">'))
  assert.ok(html.includes('<title>运维日报 2026-11-20</title>'))
  assert.ok(html.includes('<style>'))
  assert.ok(html.includes('</html>'))
})

check('HTML 里保留结构与语义标记', () => {
  assert.ok(html.includes('<h1>运维日报 2026-11-20</h1>'))
  assert.ok(html.includes('<p class="lead"><strong>一句话</strong>'))
  assert.ok(html.includes('<div class="table"><table>'))
  assert.ok(html.includes('<blockquote>生成时间'))
  assert.ok(html.includes('<code>free -h</code>'))
})

check('嵌套子项渲染成 li 里的 ul，而不是并列列表', () => {
  const listHtml = html.slice(html.indexOf('<ol>'), html.indexOf('<ol>') + 700)
  assert.ok(/<li>.*<ul>.*为什么算问题/.test(listHtml), listHtml)
  const nested = listHtml.match(/<ul>[\s\S]*?<\/ul>/)
  assert.ok(nested, '没有嵌套 ul')
  assert.ok(!nested[0].includes('</ol>'), '嵌套列表被外层闭合打断')
})

check('小标题按语义上色：需要处理红、顺带一提灰', () => {
  assert.ok(html.includes('<h2 class="tone-crit">需要处理</h2>'))
  assert.ok(html.includes('<h2 class="tone-mute">顺带一提（不紧急）</h2>'))
  assert.ok(html.includes('<h2>总览</h2>'))
})

check('主机名里的尖括号被转义，不会漏出标签', () => {
  const evil = parseDocument('# t\n\n## 需要处理\n\n1. **<script>alert(1)</script> · x**\n   - 为什么算问题：<img src=x onerror=1>')
  const out = markdownToHtml('# t\n\n## 需要处理\n\n1. **<script>alert(1)</script> · x**\n   - 为什么算问题：<img src=x onerror=1>')
  assert.equal(evil.length, 3)
  assert.ok(!out.includes('<script>'))
  assert.ok(!out.includes('<img'))
  assert.ok(out.includes('&lt;script&gt;'))
})

check('文件名挡掉非法字符', () => {
  assert.equal(safeFilename('运维日报 2026-11-20'), '运维日报 2026-11-20')
  assert.equal(safeFilename('a/b:c*?"<>|d'), 'a b c d')
  assert.equal(safeFilename('   '), '运维日报')
})

console.log(`\n${pass} 项通过`)
