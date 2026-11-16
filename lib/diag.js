/**
 * 排障动作库：每个动作一条只读命令 + 一句「为什么要看它 / 看到什么算不对」。
 *
 * 这里刻意不做「任选命令执行」的自由终端：新手真正需要的是
 * 「现象 → 该敲哪条命令 → 输出怎么读」，而不是一个更危险的终端。
 * 后续要放开写操作，也应该一次加一条、带确认和留痕。
 */

const PRELUDE = String.raw`
export LC_ALL=C
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH
`

export const DIAGNOSTICS = [
  {
    id: 'units-failed',
    label: '失败的服务',
    hint: 'systemd 认为挂掉的单元，最常见的「网站打不开」原因',
    look: '看 UNIT 列和 SUB 状态；failed 的就是起不来的服务',
    script: String.raw`
echo '## systemctl --failed'
systemctl --failed --no-pager 2>/dev/null || echo '(没有 systemd 或无权限)'
echo
echo '## is-system-running'
systemctl is-system-running 2>/dev/null
echo
echo '## 最近 15 条 systemd 错误'
journalctl -p err -n 15 --no-pager 2>/dev/null || echo '(journalctl 不可用或无权限)'
`,
  },
  {
    id: 'logs-errors',
    label: '最近的错误日志',
    hint: '内核 + systemd 的错误优先，比翻应用日志更快定位',
    look: '出现频率最高的那个报错通常就是根因；注意 OOM、No space left、permission denied',
    script: String.raw`
echo '## journalctl -p err -n 60'
journalctl -p err -n 60 --no-pager 2>/dev/null || true
echo
echo '## 非 systemd 机器的兜底：/var/log/syslog 或 messages'
if [ -f /var/log/syslog ]; then tail -n 400 /var/log/syslog | grep -iE 'error|fail|crit|panic' | tail -n 40; fi
if [ -f /var/log/messages ]; then tail -n 400 /var/log/messages | grep -iE 'error|fail|crit|panic' | tail -n 40; fi
`,
  },
  {
    id: 'logs-recent',
    label: '最新日志流',
    hint: '不带过滤的最近 120 行，适合刚重启完或刚部署完看现场',
    look: '找最后一条正常日志之后发生了什么',
    script: String.raw`
journalctl -n 120 --no-pager 2>/dev/null || tail -n 120 /var/log/syslog 2>/dev/null || tail -n 120 /var/log/messages 2>/dev/null
`,
  },
  {
    id: 'ports',
    label: '端口与监听',
    hint: '谁占着端口、监听在哪个地址',
    look: '该在的端口不在（服务没起来）；不该在的端口对 0.0.0.0 开着（暴露面）',
    script: String.raw`
echo '## 监听中的端口'
ss -lntup 2>/dev/null || netstat -lntup 2>/dev/null || netstat -lntu 2>/dev/null
echo
echo '## 连接状态统计'
ss -s 2>/dev/null || true
`,
  },
  {
    id: 'process',
    label: '进程与资源占用',
    hint: 'CPU / 内存 TOP + 进程状态分布',
    look: 'R 多=CPU 排队；D 多=卡在磁盘 IO；Z=僵尸；某个进程 %MEM 特别高',
    script: String.raw`
echo '## CPU TOP 12'
ps -eo pid,ppid,user,stat,pcpu,pmem,rss,etime,comm --sort=-pcpu 2>/dev/null | head -n 13
echo
echo '## 内存 TOP 12'
ps -eo pid,ppid,user,stat,pcpu,pmem,rss,etime,comm --sort=-pmem 2>/dev/null | head -n 13
echo
echo '## 进程状态分布'
ps -eo stat 2>/dev/null | tail -n +2 | cut -c1 | sort | uniq -c | sort -rn
`,
  },
  {
    id: 'disk-space',
    label: '磁盘空间去哪了',
    hint: '查大目录（会扫盘，慢一点）',
    look: '/var/log、/var/lib/docker、备份目录是最常见的三处',
    timeoutMs: 60_000,
    script: String.raw`
echo '## 各挂载点'
df -h -x tmpfs -x devtmpfs 2>/dev/null || df -h
echo
echo '## 根目录下一级占用'
(du -xh --max-depth=1 / 2>/dev/null | sort -h | tail -n 15) || echo '(du 不可用)'
echo
echo '## /var 下一级占用'
(du -xh --max-depth=1 /var 2>/dev/null | sort -h | tail -n 12) || true
echo
echo '## 最大的 15 个日志文件'
find /var/log -type f -size +10M 2>/dev/null | head -n 15 | xargs -r ls -lh 2>/dev/null
`,
  },
  {
    id: 'disk-io',
    label: 'IO 与负载',
    hint: 'CPU 不高但很卡，通常是这里的问题',
    look: 'wa 高=等磁盘；vmstat 的 b 列持续 >0 说明有进程卡在 IO',
    script: String.raw`
echo '## 负载'
cat /proc/loadavg
echo
echo '## vmstat 采样 3 次（r 运行队列 / b 阻塞 / wa IO 等待）'
vmstat 1 3 2>/dev/null || echo '(vmstat 不可用)'
echo
echo '## 磁盘利用率 %util（需要 sysstat）'
iostat -dx 1 2 2>/dev/null | tail -n 20 || echo '(iostat 未安装，可忽略)'
`,
  },
  {
    id: 'network',
    label: '网络连接与流量',
    hint: '连接数、异常状态、网卡速率',
    look: 'TIME_WAIT/CLOSE_WAIT 暴涨；单个 IP 连接数异常高（可能是攻击或爬虫）',
    script: String.raw`
echo '## 网卡'
cat /proc/net/dev
echo
echo '## 连接状态计数'
ss -tan 2>/dev/null | awk 'NR>1 {print $1}' | sort | uniq -c | sort -rn | head -n 10
echo
echo '## 连接最多的对端 IP (TOP 10)'
ss -tan 2>/dev/null | awk 'NR>1 {print $5}' | cut -d: -f1 | sort | uniq -c | sort -rn | head -n 10
`,
  },
  {
    id: 'auth-failed',
    label: '登录失败与爆破',
    hint: '公网 SSH 一定会被扫，重点看失败量',
    look: '失败次数极多说明正在被爆破；有陌生 IP 成功登录要立刻改密码并查进程',
    script: String.raw`
echo '## 最近失败的登录尝试'
(journalctl -u ssh -u sshd -n 300 --no-pager 2>/dev/null | grep -iE 'failed|invalid user' | tail -n 30) || true
(lastb 2>/dev/null | head -n 20) || true
echo
echo '## 最近成功登录'
last -n 15 2>/dev/null || true
echo
echo '## 当前在线'
who 2>/dev/null || true
`,
  },
  {
    id: 'oom',
    label: '内存被杀（OOM）',
    hint: '服务莫名重启的头号原因',
    look: '出现 "Killed process" 就说明进程被内核 OOM killer 杀了；接着要加内存或调 limit',
    script: String.raw`
echo '## 内核日志里的 OOM'
(dmesg -T 2>/dev/null || journalctl -k --no-pager 2>/dev/null) | grep -iE 'out of memory|killed process|oom-kill' | tail -n 20
echo
echo '## 内存现状'
free -h
`,
  },
  {
    id: 'time-sync',
    label: '时间同步',
    hint: '时钟错乱会让证书、日志、cron 全部混乱',
    look: 'System clock synchronized 要为 yes；NTP service 要为 active',
    script: String.raw`
timedatectl 2>/dev/null || (date; cat /etc/timezone 2>/dev/null)
echo
echo '## 与本机时间的偏差（秒，正数=服务器慢）'
echo $(date -u +%s)
`,
  },
  {
    id: 'docker',
    label: '容器概览',
    hint: '跑 docker 的机器先看容器状态再往里查',
    look: 'Restarting/Exited 的容器；容器日志里连续报错的那一个',
    script: String.raw`
if command -v docker >/dev/null 2>&1; then
  docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' 2>/dev/null | head -n 25
  echo
  echo '## 资源占用'
  docker stats --no-stream 2>/dev/null | head -n 15
else
  echo '(这台机器没有安装 docker)'
fi
`,
  },
  {
    id: 'cron',
    label: '定时任务',
    hint: '半夜出问题，先怀疑 cron 和备份脚本',
    look: '有没有跑失败但没报错的备份；多条重叠执行的脚本',
    script: String.raw`
echo '## 当前用户 crontab'
crontab -l 2>/dev/null || echo '(空)'
echo
echo '## /etc/cron.d 与 /etc/crontab'
ls -l /etc/cron.d 2>/dev/null; cat /etc/crontab 2>/dev/null | tail -n 15
echo
echo '## systemd 定时器'
systemctl list-timers --no-pager 2>/dev/null | head -n 15
`,
  },
]

export function findDiagnostic(id) {
  return DIAGNOSTICS.find((item) => item.id === id)
}

/** 页面用的清单（不带脚本正文）。 */
export function diagnosticCatalog() {
  return DIAGNOSTICS.map(({ id, label, hint, look }) => ({ id, label, hint, look }))
}

export function diagScript(id) {
  const action = findDiagnostic(id)
  if (!action) throw new Error(`未知的排障动作：${id}`)
  return PRELUDE + action.script
}
