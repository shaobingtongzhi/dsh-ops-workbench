/**
 * 单测：日报「预览」和「导出」画的是同一份东西。
 *
 * 用户要的效果是「日报别给我看原始 Markdown，要像预览那样排版」，右上角能导出 md / html。
 * 这里用假 DOM + 假 React 把 client.js 跑起来，拿真正的 report.js 生成日报，
 * 再把 DocView 的渲染树抓下来，断言：
 *   - 小标题、表格、嵌套列表、页脚引用都真的画成了对应标签（不是一坨 <pre>）
 *   - 「需要处理」这类小标题带上了 crit 色条
 *   - 页面上的字和导出的 HTML 里的字是同一批（不靠两套实现各猜一遍）
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildReport } from '../lib/report.js'
import { firstHeading, markdownToHtml, parseDocument } from '../lib/markdown.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT = join(HERE, '..', 'client.js')
const SRC = readFileSync(CLIENT, 'utf8')

let pass = 0
const check = (label, fn) => { fn(); console.log(`  ok  ${label}`); pass += 1 }

/* ------------------------------------------------- 假运行环境 */

const styleNodes = []
const doc = {
  visibilityState: 'visible',
  getElementById: (id) => styleNodes.find((el) => el.id === id) ?? null,
  createElement: (tag) => ({ tag, style: {}, dataset: {}, setAttribute() {}, textContent: '' }),
  head: { appendChild: (el) => styleNodes.push(el) },
  body: { appendChild() {}, removeChild() {} },
  addEventListener() {},
  removeEventListener() {},
  execCommand() {},
}

const win = {
  addEventListener() {},
  removeEventListener() {},
  __ModuleLoader__: { load: (mod) => { win.__MOD = mod } },
}

// 只跑首屏：每个函数组件拿到自己那份 hooks，够断言「树长什么样」了
let current = null
const react = {
  createElement: (type, props, ...children) => ({
    type,
    props: { ...(props ?? {}), children: children.flat(Infinity).filter((child) => child != null && child !== false) },
  }),
  useState: (init) => (current ? current.useState(init) : [typeof init === 'function' ? init() : init, () => {}]),
  useEffect: () => {},
  useLayoutEffect: () => {},
  useRef: (init) => ({ current: init }),
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
}

globalThis.window = win
globalThis.document = doc

await import(pathToFileURL(CLIENT).href + '?report-view-test=' + Date.now())

const registration = win.__MOD
assert.ok(registration && typeof registration.factory === 'function', 'client.js 应该注册一个模块')
const api = registration.factory((id) => {
  if (id !== 'react') throw new Error(`unexpected require(${JSON.stringify(id)})`)
  return react
})
api.apply({
  slots: { register: () => () => {}, inject: (name, fn) => { fn(); return () => {} } },
})

const T = globalThis.__DSH_OPS_TEST__
assert.ok(T && T.DocView && T.ReportView, 'apply() 应该把日报预览的组件挂到 __DSH_OPS_TEST__ 上')

/* ------------------------------------------------- 一份真日报 */

const now = Date.now()
const snapshot = {
  host: { name: 'web-01', cores: 2, uptimeSec: 812345 },
  cpu: { pct: 91 },
  mem: { availableBytes: 512 * 1024 ** 2, availPct: 12 },
  disks: [{ mount: '/', usedPct: 94 }],
  load: { l1: 3.2 },
  failedUnits: ['backup.service'],
}
const record = {
  at: now - 60e3,
  level: 'crit',
  snapshot,
  issues: [
    { level: 'crit', title: '磁盘快满了', detail: '`/` 已用 94%，再涨就写不进日志了。', fix: '先清 `/var/log`；再把日志轮转调紧' },
    { level: 'warn', title: '内存偏紧', detail: '可用只剩 512 MB。', fix: '看谁在涨：`ps aux --sort=-rss`' },
    { level: 'info', title: '有 1 个服务失败', detail: 'backup.service 没起来。', fix: 'journalctl -u backup' },
  ],
}
const host = { id: 'h1', name: 'web-01', host: '10.0.0.5' }
const built = buildReport({ hosts: [host], lastInspect: { h1: record }, now })
const blocks = parseDocument(built.markdown)
const docLive = { kind: 'live', title: built.title, markdown: built.markdown, blocks }

/* ------------------------------------------------- 抓渲染树 */

function collect(node, bag) {
  if (node == null || node === false) return bag
  if (typeof node === 'string' || typeof node === 'number') {
    bag.text.push(String(node))
    return bag
  }
  if (Array.isArray(node)) {
    for (const child of node) collect(child, bag)
    return bag
  }
  if (typeof node.type === 'function') {
    const saved = current
    const local = { hooks: [], cursor: 0 }
    const instance = {
      useState(init) {
        const i = local.cursor++
        if (!(i in local.hooks)) local.hooks[i] = typeof init === 'function' ? init() : init
        return [local.hooks[i], () => {}]
      },
    }
    current = instance
    let out
    try {
      out = node.type(node.props)
    } finally {
      current = saved
    }
    return collect(out, bag)
  }
  if (node.type === undefined) throw new Error('渲染出 type=undefined 的节点，props=' + JSON.stringify(node.props))
  bag.tags.push(String(node.type))
  if (node.props?.className) bag.classes.push(String(node.props.className))
  if (node.props?.['data-tone']) bag.tones.push(String(node.props['data-tone']))
  bag.nodes.push(node)
  for (const child of node.props?.children ?? node.children ?? []) collect(child, bag)
  return bag
}

const bag = collect(react.createElement(T.DocView, { doc: docLive }), { tags: [], classes: [], tones: [], text: [], nodes: [] })
const text = bag.text.join('')

/* ------------------------------------------------- 1. 排版 */

check('日报画成了文档，不是一坨原始 Markdown', () => {
  assert.ok(bag.classes.includes('ow-doc'), '应该有 .ow-doc 容器')
  assert.equal(bag.tags.filter((tag) => tag === 'pre').length, 0, '正文里不该再出现 <pre> 原文')
})
check('一级标题不重复：卡片头已经显示了', () => {
  assert.equal(bag.tags.filter((tag) => tag === 'h1').length, 0, '正文里不该再画一遍 h1')
  assert.ok(text.includes('运维日报'), '标题应该出现在卡片头（DocView 的 head）')
})
check('小标题画成了 h2', () => {
  assert.ok(bag.tags.includes('h2'))
  assert.ok(text.includes('总览') && text.includes('需要处理') && text.includes('明天先做这三件事'))
})
check('「需要处理」带 crit 色条，不紧急的带 muted', () => {
  assert.ok(bag.tones.includes('crit'), '需要处理应该是 crit')
  assert.ok(bag.tones.includes('mute'), '顺带一提应该是 mute')
})
check('总览表画成了真表格，8 列', () => {
  assert.ok(bag.tags.includes('table'))
  const thead = bag.nodes.find((node) => node.type === 'thead')
  const ths = collect(thead, { tags: [], classes: [], tones: [], text: [], nodes: [] }).tags.filter((tag) => tag === 'th')
  assert.equal(ths.length, 8)
  assert.ok(text.includes('磁盘最高') && text.includes('负载/核'))
})
check('需要处理：编号列表 + 缩进子项（为什么 / 建议动作）', () => {
  assert.ok(bag.tags.includes('ol'), '需要处理应该画成编号列表')
  assert.ok(bag.tags.includes('ul'), '子项应该是嵌套的无序列表')
  assert.ok(text.includes('为什么算问题') && text.includes('建议动作'))
  // 子列表必须真的在 li 里面，而不是同级平铺
  const li = bag.nodes.find((node) => node.type === 'li')
  const inner = collect(li, { tags: [], classes: [], tones: [], text: [], nodes: [] })
  assert.ok(inner.tags.includes('ul'), 'li 里应该有嵌套的 ul')
})
check('行内代码画成了 <code>', () => {
  assert.ok(bag.tags.includes('code'))
  assert.ok(!text.includes('`/`'), '不该把反引号漏到页面上')
})
check('页脚引用画成了 blockquote', () => {
  assert.ok(bag.tags.includes('blockquote'))
  assert.ok(text.includes('数据来自最后一次只读巡检'))
})
check('加粗画成了 <strong>，没有字面 **', () => {
  assert.ok(bag.tags.includes('strong'))
  assert.ok(!text.includes('**'))
})
check('列表项里的主机名和问题标题都在', () => {
  assert.ok(text.includes('web-01'))
  assert.ok(text.includes('磁盘快满了'))
})

/* ------------------------------------------------- 2. 页面 = 导出 */

check('导出的 HTML 和页面是同一批字', () => {
  const html = markdownToHtml(built.markdown, { title: built.title, exportedAt: now })
  for (const piece of ['磁盘快满了', '为什么算问题', '建议动作', '明天先做这三件事', '数据来自最后一次只读巡检', 'web-01']) {
    assert.ok(text.includes(piece), `页面里应该看到「${piece}」`)
    assert.ok(html.includes(piece), `导出 HTML 里也应该有「${piece}」`)
  }
  assert.ok(html.includes('tone-crit'), '色条规则要和页面一致')
  assert.ok(html.includes('<table>'), '表格要和页面一致')
})
check('导出标题用日报自己的一级标题', () => {
  assert.equal(firstHeading(blocks), built.title)
})

/* ------------------------------------------------- 3. 右上角导出 */

function renderReport(props) {
  return collect(react.createElement(T.ReportView, props), { tags: [], classes: [], tones: [], text: [], nodes: [] })
}

check('工具栏：左边生成 / 复制，右边是导出', () => {
  const view = renderReport({ state: { hosts: [host] }, report: { ...built }, running: false, onRun() {} })
  const bar = view.nodes.find((node) => String(node.props?.className).includes('ow-report-bar'))
  assert.ok(bar, '应该有工具栏')
  const barText = collect(bar, { tags: [], classes: [], tones: [], text: [], nodes: [] }).text.join('')
  assert.ok(barText.includes('生成今天的日报'))
  assert.ok(barText.includes('复制全文'))
  assert.ok(barText.includes('导出'), '右上角要有导出按钮')
  assert.ok(view.classes.some((name) => name.includes('ow-export')), '导出按钮要有自己的位置包住')
})
check('导出支持 md 和 html 两种', () => {
  assert.deepEqual(T.EXPORT_TARGETS.map((target) => target.format), ['md', 'html'])
})
check('没数据时导出按钮禁用（不让人导出一份空的）', () => {
  const view = renderReport({ state: { hosts: [] }, report: null, running: false, onRun() {} })
  const button = view.nodes.find((node) => String(node.props?.className).includes('ow-export-btn'))
  assert.equal(button.props.disabled, true)
})
check('历史日报为空时给出怎么来的提示', () => {
  const view = renderReport({ state: { hosts: [] }, report: null, running: false, onRun() {} })
  assert.ok(view.text.join('').includes('还没有自动生成的日报'))
})
check('宿主没给 blocks 时退回原文，不至于白屏', () => {
  const view = collect(react.createElement(T.DocView, { doc: { kind: 'file', title: '旧的', markdown: '## 只有文本', blocks: [] } }),
    { tags: [], classes: [], tones: [], text: [], nodes: [] })
  assert.ok(view.classes.includes('ow-pre'))
  assert.ok(view.text.join('').includes('只有文本'))
})

console.log(`\n${pass} 项通过`)
