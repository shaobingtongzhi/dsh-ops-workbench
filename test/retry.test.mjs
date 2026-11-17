/**
 * 单测：巡检出错后的重试判定（不碰网络、不碰服务器、不写状态文件）。
 *
 * 复现的真实事故（2026-11-17 14:04）：
 *   5 台主机，1.71.x 两台通，另外三台卡在 readyTimeout 15000ms。
 *   旧逻辑只认「全部失败」才重试，3/5 失败 = allFailed false → 不重试，
 *   于是「本机刚唤醒、链路半就绪」被画成「三台服务器宕了」，红到下一个 15 分钟周期。
 */
import assert from 'node:assert/strict'
import { noteAttempt, pickHosts, retryState } from '../index.js'

const HOSTS = [
  { id: 'h6b592575', name: '自用服务器', host: '39.99.149.236', port: 22 },
  { id: 'h8fce4c4d', name: '青花瓷UAT', host: '60.205.160.157', port: 22 },
  { id: 'h545ce8c3', name: '内网工作站', host: '10.10.10.115', port: 22 },
  { id: 'h1e7e6ff9', name: '青花瓷应用服务器', host: '1.71.9.142', port: 22 },
  { id: 'h480f565a', name: '青花瓷数据服务器', host: '1.71.80.113', port: 22 },
]

const ok = (id) => ({ hostId: id, ok: true })
const bad = (id) => ({ hostId: id, ok: false, error: '连接超时：检查 IP、端口、云安全组放行、以及能否 ping 通' })
const BROKEN = ['h6b592575', 'h8fce4c4d', 'h545ce8c3']
const incident = HOSTS.map((h) => (BROKEN.includes(h.id) ? bad(h.id) : ok(h.id)))

const T0 = 1794895445521
let pass = 0
const check = (label, fn) => { fn(); console.log(`  ok  ${label}`); pass += 1 }

// ── 1. 事故现场：3/5 失败必须安排重试，且重试名单就是那三台
let a = noteAttempt(incident, T0)
check('3/5 失败不被当成"全灭"', () => assert.equal(a.allFailed, false))
check('3/5 失败仍然安排 1 分钟后重试', () => assert.equal(a.retryAt, T0 + 60_000))
check('重试名单 = 失败的三台', () => assert.deepEqual(retryState().hostIds, BROKEN))
check('attemptLog 里三台的错误原文都在', () => {
  assert.equal(a.errors.length, 3)
  for (const e of a.errors) assert.match(e.message, /连接超时/)
})

// ── 2. 重试只补那三台，不能把已经通了的两台再连一遍
check('重试轮只挑失败主机', () => {
  const picked = pickHosts(HOSTS, { retryOnly: true })
  assert.deepEqual(picked.map((h) => h.id), BROKEN)
})
check('正常周期仍然跑全量', () => {
  assert.equal(pickHosts(HOSTS, { retryOnly: false }).length, 5)
})

// ── 3. 退避 1 → 2 → 3 分钟，第 4 次放弃（避免真宕机的主机无限重连）
a = noteAttempt(incident, T0 + 60_000)
check('第 2 次失败退避 2 分钟', () => assert.equal(a.retryAt, T0 + 60_000 + 120_000))
a = noteAttempt(incident, T0 + 180_000)
check('第 3 次失败退避 3 分钟', () => assert.equal(a.retryAt, T0 + 180_000 + 180_000))
a = noteAttempt(incident, T0 + 360_000)
check('第 4 次失败停止重试，等下个周期', () => assert.equal(a.retryAt, 0))
check('停止重试后名单清空', () => assert.deepEqual(retryState().hostIds, []))

// ── 4. 重试成功：清空重试，且恢复全量巡检
a = noteAttempt(HOSTS.map((h) => ok(h.id)), T0 + 420_000)
check('全部成功清空重试', () => {
  assert.equal(a.retryAt, 0)
  assert.equal(a.failed, 0)
  assert.deepEqual(retryState().hostIds, [])
  assert.equal(pickHosts(HOSTS, { retryOnly: true }).length, 5)
})

// ── 5. 重试轮里那三台通了、但另两台这次挂了：只认这一轮的结果
a = noteAttempt([ok('h6b592575'), ok('h8fce4c4d'), ok('h545ce8c3'), bad('h1e7e6ff9'), ok('h480f565a')], T0 + 480_000)
check('部分失败方向反过来也能正确排重试', () => {
  assert.equal(a.failed, 1)
  assert.deepEqual(retryState().hostIds, ['h1e7e6ff9'])
})

console.log(`\n${pass} 项通过`)
