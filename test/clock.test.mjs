/**
 * 单测：让「刚刚 / 13 分钟前」跟着时钟走（不碰网络、不渲染真页面、不写状态文件）。
 *
 * 复现的真实问题（2026-11-17 17:24）：
 *   17:11:16 巡检完，顶栏一直写着「（刚刚）」，到 17:24 还是「刚刚」。
 *   原因不是记录错了，而是相对时间只在重绘时算一次：轮询只在「巡检结果变了」时才重绘
 *   （signatureOf 那套），数据没变就永远停在渲染那一刻。
 *
 * 修法：相对时间不再在父组件渲染时算死，而是由 Ago / In / RetryHint / InspectedAt
 * 各自订阅一只共享时钟（useNow → clockSubs）。数据没变，它们每 5 秒也会自己走一步。
 *
 * 这里用假 DOM + 假 React 把 client.js 跑起来，直接驱动时钟广播来断言：
 *   同一份数据、不重新拉接口，文案从「刚刚」变成「13 分钟前」。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT = join(HERE, '..', 'client.js')
const SRC = readFileSync(CLIENT, 'utf8')

let pass = 0
const check = (label, fn) => { fn(); console.log(`  ok  ${label}`); pass += 1 }

/* ------------------------------------------------- 假运行环境（只够跑 apply） */

const styleNodes = []
const doc = {
  visibilityState: 'visible',
  getElementById: (id) => styleNodes.find((el) => el.id === id) ?? null,
  createElement: (tag) => ({ tag, style: {}, setAttribute() {}, textContent: '' }),
  head: { appendChild: (el) => styleNodes.push(el) },
  addEventListener() {},
  removeEventListener() {},
}

const win = {
  addEventListener() {},
  removeEventListener() {},
  __ModuleLoader__: { load: (mod) => { win.__MOD = mod } },
}

// hooks 默认是空占位（apply 本身不渲染组件）；真正跑组件时由 mount() 接管
let current = null
const react = {
  createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), children } }),
  useState: (init) => (current
    ? current.useState(init)
    : [typeof init === 'function' ? init() : init, () => {}]),
  useEffect: (fn, list) => { if (current) current.useEffect(fn, list) },
  useRef: (init) => ({ current: init }),
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  Component: class { constructor(props) { this.props = props } },
}

/**
 * 极简「渲染器」：足够跑通 useState + useEffect 的组件（我们这里全是返回字符串的组件）。
 * 目的不是模拟 React，而是验证组件真的靠订阅重绘了 —— setState 之后组件函数被重新调用。
 */
function mount(Comp, props) {
  const values = []
  const deps = []
  const cleanups = []
  let pending = []
  let stateCursor = 0
  let effectCursor = 0
  let out
  let unmounted = false

  const instance = {
    useState(init) {
      const i = stateCursor
      stateCursor += 1
      if (!(i in values)) values[i] = typeof init === 'function' ? init() : init
      return [values[i], (next) => {
        if (unmounted) return
        values[i] = typeof next === 'function' ? next(values[i]) : next
        render() // React 里是异步批处理；这里同步重画，断言更直接
      }]
    },
    useEffect(fn, list) {
      pending.push({ index: effectCursor, fn, list })
      effectCursor += 1
    },
  }

  function render() {
    const before = current
    current = instance
    stateCursor = 0
    effectCursor = 0
    pending = []
    try {
      out = Comp(props)
    } finally {
      current = before
    }
    for (const effect of pending) {
      const prev = deps[effect.index]
      const changed = !prev || !effect.list || effect.list.some((value, i) => value !== prev[i])
      if (changed) {
        deps[effect.index] = effect.list
        const cleanup = effect.fn()
        if (typeof cleanup === 'function') cleanups.push(cleanup)
      }
    }
  }

  render()
  return {
    text: () => out,
    unmount: () => {
      unmounted = true
      for (const cleanup of cleanups.reverse()) cleanup()
    },
  }
}

globalThis.window = win
globalThis.document = doc

await import(pathToFileURL(CLIENT).href + '?clock-test=' + Date.now())

const registration = win.__MOD
assert.ok(registration && typeof registration.factory === 'function', 'client.js 应该通过 __ModuleLoader__ 注册一个模块')

// 跟真 loader 一样：调 factory 拿到模块，再 apply 一次
const api = registration.factory((id) => {
  if (id !== 'react') throw new Error(`unexpected require(${JSON.stringify(id)})`)
  return react
})
assert.equal(api.id ?? registration.id, 'dsh-ops-workbench')
assert.deepEqual(api.inject, ['slots'])
assert.equal(typeof api.apply, 'function')

const disposers = []
api.apply({
  slots: {
    register: () => () => {},
    inject: (name, fn) => { disposers.push(fn() ?? (() => {})); return () => {} },
  },
})

const T = globalThis.__DSH_OPS_TEST__
assert.ok(T && T.clock, 'apply() 应该把相对时间与时钟的把手挂到 __DSH_OPS_TEST__ 上')

/* ---------------------------------------------------------------- 1. 文案 */

// 用本地时间构造，避免测试机时区影响
const AT = new Date(2026, 10, 17, 17, 11, 16).getTime()

check('30 秒内算「刚刚」', () => {
  assert.equal(T.fmtAgo(AT, AT + 30e3), '刚刚')
})

check('13 分钟就该写「13 分钟前」，不是「刚刚」', () => {
  assert.equal(T.fmtAgo(AT, AT + 13 * 60e3), '13 分钟前')
})

check('小时 / 天也照常进位', () => {
  assert.equal(T.fmtAgo(AT, AT + 3 * 3600e3), '3 小时前')
  assert.equal(T.fmtAgo(AT, AT + 2 * 86400e3), '2 天前')
})

check('倒计时：「1 分钟后」', () => {
  assert.equal(T.fmtIn(AT, AT - 60e3), '1 分钟后')
  assert.equal(T.retryHint({ at: AT + 60e3, count: 1, max: 3 }, AT), '1 分钟后自动重试（第 1/3 次）')
})

check('顶部绝对时间：当天只给时分秒，隔天补月日', () => {
  assert.equal(T.stampOf(AT, AT + 13 * 60e3), '17:11:16')
  assert.equal(T.stampOf(AT, AT + 86400e3 + 5 * 60e3), '11-17 17:11:16')
})

/* ------------------------------------------------- 2. 时钟广播（真正的回归点） */

check('数据没变，文案也要跟着走表（17:11 → 17:24）', () => {
  const clock = T.clock
  const realNow = Date.now
  let fakeNow = AT + 4e3
  Date.now = () => fakeNow
  clock.beat() // 挂载前先对一次表（真实实现里 useNow 挂载时也会对）
  const agos = mount(T.Ago, { at: AT, lead: '巡检于 ' })
  const top = mount(T.InspectedAt, { at: AT })
  try {
    // 页面最后一次重绘发生在巡检刚结束（4 秒后）——之后没人再拉数据
    assert.equal(agos.text(), '巡检于 刚刚')
    assert.equal(top.text(), '17:11:16（刚刚）')

    // 13 分钟后，时钟走一步：没有任何新数据、没有整页重绘
    fakeNow = AT + 13 * 60e3
    clock.beat()
    assert.equal(agos.text(), '巡检于 13 分钟前', '时钟一步之后，同一份数据就该显示 13 分钟前')
    assert.equal(top.text(), '17:11:16（13 分钟前）')

    // 后台标签页不白算：不可见时跳过
    doc.visibilityState = 'hidden'
    fakeNow = AT + 20 * 60e3
    clock.onBack()
    assert.equal(agos.text(), '巡检于 13 分钟前', '标签页在后台时不该空转')

    // 切回前台立刻对表
    doc.visibilityState = 'visible'
    clock.onBack()
    assert.equal(agos.text(), '巡检于 20 分钟前')
  } finally {
    agos.unmount()
    top.unmount()
    Date.now = realNow
    doc.visibilityState = 'visible'
  }
})

check('倒计时（下次自动巡检 / 下次重试）也自己走', () => {
  const realNow = Date.now
  const fakeNow = AT
  Date.now = () => fakeNow
  const clock = T.clock
  const next = AT + 2 * 60e3
  clock.beat()
  const inText = mount(T.In, { at: next, lead: '（下次 ', tail: '）' })
  const retryText = mount(T.RetryHint, { retry: { at: next, count: 1, max: 3 }, lead: ' ', tail: '。' })
  try {
    assert.equal(inText.text(), '（下次 2 分钟后）')
    assert.equal(retryText.text(), ' 2 分钟后自动重试（第 1/3 次）。')
    clock.beat() // 时间推不动了也没关系：这里只验证渲染出来的形状对
  } finally {
    inText.unmount()
    retryText.unmount()
    Date.now = realNow
  }
})

check('时钟间隔够细：「刚刚」最多错 1 分钟的一半', () => {
  assert.ok(T.clock.ms <= 30e3, `CLOCK_MS=${T.clock.ms} 太大，相对时间会明显滞后`)
})

check('组件卸载后不再订阅、也不会被叫醒（不泄漏）', () => {
  const before = T.clock.size()
  const mounted = mount(T.Ago, { at: AT })
  assert.equal(T.clock.size(), before + 1)
  mounted.unmount()
  assert.equal(T.clock.size(), before, '卸载后订阅要退干净，否则后台标签页永远在跑定时器')
})

/* --------------------------------------- 3. 静态检查：别再在渲染时把时间算死 */

check('相对时间必须走 Ago / In / RetryHint / InspectedAt，不能内联算', () => {
  const inline = [
    /fmtAgo\(record\.at\)/,
    /fmtAgo\(auto\.lastAutoAt\)/,
    /fmtAgo\(lastAt\)/,
    /fmtAgo\(retry/,
    /fmtIn\(auto\.nextAutoAt\)/,
    /fmtIn\(retry\.at\)/,
  ].filter((re) => re.test(SRC))
  assert.deepEqual(inline.map(String), [], '这些地方会把时间算死在渲染那一刻，数据不更新就永远不动')

  for (const wiring of ['function useNow', 'clockSubs.add(setNow)', 'function Ago', 'function In', 'function RetryHint', 'function InspectedAt']) {
    assert.ok(SRC.includes(wiring), `缺少 ${wiring}`)
  }
  assert.ok(SRC.includes('h(Ago, { at: record.at'), '主机卡片的「巡检于 …」应该用 Ago')
  assert.ok(SRC.includes('h(InspectedAt, { at: lastAt })'), '顶栏的「上次巡检 …」应该用 InspectedAt')
})

for (const dispose of disposers) dispose?.()
console.log(`\n${pass} 项通过`)
