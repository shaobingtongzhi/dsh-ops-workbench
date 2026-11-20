/**
 * 页面半边：ops-workbench
 *
 * 这份文件由 DSH 的 ModuleLoader 直接执行（不需要构建），所以：
 *  - 不能写 JSX，全部 h(...) 调用
 *  - 不能 import，React 由 require('react') 给
 *  - 不依赖任何 Harness 内部包，样式只用继承色 + 主题中性 rgba，
 *    这样浅色/深色主题下都不会出现「白底白字」
 */
window.__ModuleLoader__.load({
  id: 'dsh-ops-workbench',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useMemo, useRef } = React

    /* ------------------------------------------------------------- 样式 */

    const CSS = `
      .ow-root { display:flex; flex-direction:column; height:100%; min-height:0; color:inherit;
        font-size:13px; line-height:1.6; --ow-line:rgba(127,127,127,.22); --ow-line-soft:rgba(127,127,127,.13);
        --ow-fill:rgba(127,127,127,.07); --ow-fill-2:rgba(127,127,127,.12); --ow-mute:rgba(127,127,127,.9); }
      .ow-head { padding:14px 20px 0; flex:0 0 auto; }
      .ow-title { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
      .ow-title h1 { font-size:15px; font-weight:600; margin:0; letter-spacing:.01em; }
      .ow-sub { color:var(--ow-mute); font-size:11.5px; margin-top:4px; display:flex; flex-wrap:wrap; gap:2px 10px; }
      .ow-sub > span { white-space:nowrap; }
      .ow-sub > span + span::before { content:'·'; margin-right:8px; opacity:.7; }
      .ow-spacer { flex:1 1 auto; }
      .ow-tabs { display:flex; gap:2px; margin:12px 0 0; border-bottom:1px solid var(--ow-line); padding:0 20px; flex:0 0 auto; overflow-x:auto; }
      .ow-tab { appearance:none; border:0; background:none; color:var(--ow-mute); font:inherit; font-size:12.5px;
        padding:7px 11px; cursor:pointer; border-bottom:2px solid transparent; white-space:nowrap; border-radius:6px 6px 0 0; }
      .ow-tab:hover { color:inherit; background:var(--ow-fill); }
      .ow-tab[data-on="1"] { color:inherit; border-bottom-color:currentColor; font-weight:600; }
      .ow-tab .ow-count { margin-left:5px; font-size:11px; opacity:.75; }
      .ow-body { flex:1 1 auto; min-height:0; overflow-y:auto; padding:16px 20px 28px; }
      .ow-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; }
      .ow-card { border:1px solid var(--ow-line); border-radius:10px; padding:12px 13px; background:var(--ow-fill); }
      .ow-card-h { display:flex; align-items:baseline; gap:8px; }
      .ow-card-h b { font-size:13.5px; font-weight:600; }
      .ow-host { color:var(--ow-mute); font-size:11.5px; font-variant-numeric:tabular-nums; }
      .ow-dot { width:7px; height:7px; border-radius:50%; display:inline-block; flex:0 0 auto; }
      .ow-verdict { display:flex; align-items:center; gap:6px; margin-top:6px; font-size:12px; }
      .ow-metrics { display:grid; grid-template-columns:1fr 1fr; gap:4px 12px; margin-top:9px; }
      .ow-metric { display:flex; flex-direction:column; gap:1px; min-width:0; }
      .ow-metric-wide { grid-column:1 / -1; }
      .ow-metric-k { color:var(--ow-mute); font-size:10.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .ow-metric-v { font-size:12.5px; font-variant-numeric:tabular-nums; white-space:nowrap; }
      .ow-metric-hint { font-size:10.5px; color:var(--ow-mute); line-height:1.25; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .ow-sub2 { display:block; font-size:10.5px; color:var(--ow-mute); white-space:nowrap; }
      .ow-diskscell { line-height:1.45; }
      .ow-diskscell em { font-style:normal; color:var(--ow-mute); font-size:10px; margin-left:4px; white-space:nowrap; }
      .ow-disks { margin-top:9px; padding-top:7px; border-top:1px solid var(--ow-line-soft); }
      .ow-disks-h { font-size:10.5px; color:var(--ow-mute); margin-bottom:3px; }
      .ow-disks-more { appearance:none; border:0; background:none; font:inherit; font-size:10.5px;
        color:var(--ow-mute); padding:2px 0; margin-top:2px; cursor:pointer; text-align:left; }
      .ow-disks-more:hover { color:inherit; text-decoration:underline; }
      .ow-disk-row { display:flex; align-items:center; gap:8px; padding:1.5px 0; min-width:0; }
      .ow-disk-mount { flex:0 0 76px; font-size:10.5px; color:var(--ow-mute);
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .ow-disk-bar { flex:1 1 auto; min-width:36px; height:4px; border-radius:2px; background:var(--ow-fill-2); overflow:hidden; }
      .ow-disk-bar i { display:block; height:100%; border-radius:2px; }
      .ow-disk-val { flex:0 0 auto; font-size:10.5px; color:inherit; font-variant-numeric:tabular-nums; white-space:nowrap; }
      .ow-mounts { display:flex; flex-wrap:wrap; align-items:center; gap:4px 6px; margin-top:7px; }
      .ow-mounts-cap { font-size:10.5px; color:var(--ow-mute); }
      .ow-mount { font-size:10.5px; color:var(--ow-mute); border:1px solid var(--ow-line); border-radius:6px;
        padding:0 6px; max-width:190px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .ow-mount b { font-weight:600; color:inherit; }
      .ow-metric span:first-child { color:var(--ow-mute); font-size:10.5px; }
      .ow-bar { height:3px; border-radius:2px; background:var(--ow-fill-2); overflow:hidden; margin-top:3px; }
      .ow-bar i { display:block; height:100%; border-radius:2px; }
      .ow-foot { display:flex; align-items:center; gap:8px; margin-top:10px; padding-top:8px; border-top:1px solid var(--ow-line-soft); }
      .ow-btn { appearance:none; font:inherit; font-size:12px; cursor:pointer; border-radius:7px; padding:4px 10px;
        border:1px solid var(--ow-line); background:var(--ow-fill-2); color:inherit; }
      .ow-btn:hover:not(:disabled) { background:var(--ow-fill-2); filter:brightness(1.06); }
      .ow-btn:disabled { opacity:.5; cursor:default; }
      .ow-btn[data-kind="primary"] { background:#2f6feb; border-color:#2f6feb; color:#fff; font-weight:600; }
      .ow-btn[data-kind="danger"] { color:#d1453b; border-color:rgba(209,69,59,.4); }
      .ow-btn[data-kind="ghost"] { border-color:transparent; background:none; }
      .ow-tiny { font-size:11.5px; padding:2px 7px; }
      .ow-pill { display:inline-flex; align-items:center; gap:5px; font-size:11px; padding:1px 8px; border-radius:999px;
        border:1px solid var(--ow-line); background:var(--ow-fill); white-space:nowrap; }
      .ow-row { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
      .ow-h2 { font-size:12px; font-weight:600; letter-spacing:.04em; text-transform:none; color:var(--ow-mute); margin:18px 0 8px; }
      .ow-h2:first-child { margin-top:0; }
      .ow-issue { border:1px solid var(--ow-line-soft); border-left-width:3px; border-radius:8px; padding:9px 11px; margin-bottom:8px; background:var(--ow-fill); }
      .ow-issue b { font-size:12.5px; font-weight:600; }
      .ow-issue p { margin:4px 0 0; font-size:12px; color:var(--ow-mute); }
      .ow-issue .ow-fix { color:inherit; opacity:.92; }
      .ow-issue-head { display:flex; align-items:center; gap:6px; }
      .ow-issue-head .ow-spacer { min-width:8px; }
      .ow-trend-tabs { display:flex; flex-wrap:wrap; gap:6px; margin:2px 0 8px; }
      .ow-chart { display:grid; grid-template-columns:44px 1fr; gap:6px; }
      .ow-chart-y { display:flex; flex-direction:column; justify-content:space-between; height:132px; font-size:10.5px; line-height:1; text-align:right; opacity:.62; font-variant-numeric:tabular-nums; }
      .ow-chart-main { min-width:0; }
      .ow-chart-plot { position:relative; cursor:pointer; }
      .ow-plot-dot { position:absolute; width:8px; height:8px; margin:-4px 0 0 -4px; border-radius:50%; border:1.5px solid rgba(255,255,255,.92); box-sizing:border-box; pointer-events:none; box-shadow:0 0 0 1px rgba(0,0,0,.14); }
      .ow-plot-dot--last { width:5px; height:5px; margin:-2.5px 0 0 -2.5px; border-width:1px; }
      .ow-cross { position:absolute; top:0; bottom:0; width:1px; background:currentColor; opacity:.26; pointer-events:none; }
      .ow-chart-svg { width:100%; height:120px; display:block; overflow:visible; }
      .ow-chart-x { position:relative; height:15px; margin-top:3px; font-size:10.5px; opacity:.62; font-variant-numeric:tabular-nums; }
      .ow-chart-x span { position:absolute; top:0; white-space:nowrap; }
      .ow-tip { position:absolute; z-index:3; transform:translate(-50%,-118%); background:rgba(24,26,30,.94); color:#fff; font-size:11px; line-height:1.5; padding:3px 7px; border-radius:5px; white-space:nowrap; pointer-events:none; box-shadow:0 2px 8px rgba(0,0,0,.25); }
      .ow-tip b { font-weight:600; }
      .ow-table { width:100%; border-collapse:collapse; font-size:12px; }
      .ow-table th { text-align:left; font-weight:600; color:var(--ow-mute); font-size:11px; padding:6px 8px; border-bottom:1px solid var(--ow-line); white-space:nowrap; }
      .ow-table td { padding:6px 8px; border-bottom:1px solid var(--ow-line-soft); vertical-align:middle; }
      .ow-table td.num { font-variant-numeric:tabular-nums; }
      .ow-pre { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:11.5px; line-height:1.55;
        white-space:pre-wrap; word-break:break-word; margin:0; padding:11px 12px; border-radius:8px;
        background:var(--ow-fill); border:1px solid var(--ow-line-soft); max-height:46vh; overflow:auto; }
      /* 日报预览：和导出 HTML 同一套排版（小标题色条 / 表头浅底 / 嵌套子项灰字竖线）。
         改这里的字号、间距时，lib/markdown.js 里的 DOC_CSS 要一起改，否则导出的和屏幕上的会长得不一样。 */
      .ow-report-bar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:10px; }
      .ow-report-hint { flex:1 1 140px; min-width:110px; }
      .ow-dates { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin:0 0 14px; }
      .ow-dates-label { font-size:11.5px; color:var(--ow-mute); margin-right:2px; white-space:nowrap; }
      .ow-doc-wrap { max-width:900px; }
      .ow-doc-head { display:flex; align-items:center; gap:8px; margin:0 0 8px; min-width:0; }
      .ow-doc-head b { font-size:13.5px; font-weight:600; }
      .ow-doc-path { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:10.5px;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:48%; }
      .ow-doc { border:1px solid var(--ow-line); border-radius:12px; background:var(--ow-fill);
        padding:18px 22px 16px; font-size:13px; line-height:1.75; }
      .ow-doc > :first-child { margin-top:0; }
      .ow-doc > :last-child { margin-bottom:0; }
      .ow-doc h1 { font-size:16px; font-weight:600; margin:0 0 12px; padding-bottom:9px; border-bottom:1px solid var(--ow-line); }
      .ow-doc h2 { font-size:13.5px; font-weight:600; margin:22px 0 8px; padding-left:10px; position:relative; }
      .ow-doc h2::before { content:''; position:absolute; left:0; top:.36em; width:3px; height:.92em;
        border-radius:2px; background:#2f6feb; opacity:.85; }
      .ow-doc h2[data-tone="crit"]::before { background:#d1453b; opacity:1; }
      .ow-doc h2[data-tone="mute"]::before { background:var(--ow-mute); opacity:.55; }
      .ow-doc h3 { font-size:12.5px; font-weight:600; margin:16px 0 6px; }
      .ow-doc p { margin:8px 0; }
      .ow-doc p.ow-doc-lead { font-size:13.2px; }
      .ow-doc strong { font-weight:600; }
      .ow-doc code { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:11.5px; padding:1px 5px;
        border-radius:4px; background:var(--ow-fill-2); }
      .ow-doc a { color:#2f6feb; text-decoration:none; }
      .ow-doc a:hover { text-decoration:underline; }
      .ow-doc ul, .ow-doc ol { margin:8px 0; padding-left:22px; }
      .ow-doc li { margin:5px 0; }
      .ow-doc li::marker { color:var(--ow-mute); }
      .ow-doc li > ul, .ow-doc li > ol { margin:5px 0 8px; padding-left:16px; border-left:2px solid var(--ow-line-soft);
        color:var(--ow-mute); font-size:12px; list-style:disc; }
      .ow-doc blockquote { margin:16px 0 0; padding:9px 12px; border-left:3px solid var(--ow-line); border-radius:0 8px 8px 0;
        background:var(--ow-fill-2); color:var(--ow-mute); font-size:11.5px; }
      .ow-doc blockquote p { margin:0; }
      .ow-doc hr { border:0; border-top:1px solid var(--ow-line); margin:16px 0; }
      .ow-doc-table { margin:10px 0 6px; border:1px solid var(--ow-line-soft); border-radius:9px; overflow:auto; }
      .ow-doc-table table { width:100%; border-collapse:collapse; font-size:12px; }
      .ow-doc-table th { text-align:left; font-weight:600; font-size:11px; color:var(--ow-mute); padding:7px 10px;
        border-bottom:1px solid var(--ow-line); background:var(--ow-fill-2); white-space:nowrap; }
      .ow-doc-table td { padding:6px 10px; border-bottom:1px solid var(--ow-line-soft); vertical-align:middle; }
      .ow-doc-table tbody tr:last-child td { border-bottom:none; }
      .ow-doc-table tbody tr:hover td { background:var(--ow-fill); }
      .ow-doc-table td:first-child { font-weight:500; }
      .ow-doc pre { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:11.5px; line-height:1.55;
        white-space:pre-wrap; word-break:break-word; margin:10px 0; padding:10px 12px; border-radius:8px;
        background:var(--ow-fill-2); overflow:auto; }
      /* 导出下拉：面板宽度有限，菜单用 DSH 的浮层底色（拿不到就退回中性半透明） */
      .ow-export { position:relative; margin-left:auto; }
      .ow-export-btn { display:inline-flex; align-items:center; gap:6px; }
      .ow-caret { font-size:9px; opacity:.72; line-height:1; }
      .ow-menu { position:absolute; right:0; top:calc(100% + 6px); z-index:30; min-width:248px; padding:5px;
        border-radius:10px; border:1px solid var(--dsw-alias-border-l1, var(--ow-line));
        background:var(--dsw-alias-bg-layer-1, var(--ow-fill-2)); box-shadow:0 14px 34px rgba(0,0,0,.22); }
      .ow-menu-item { display:block; width:100%; text-align:left; appearance:none; border:0; background:none;
        color:inherit; font:inherit; font-size:12.5px; padding:7px 9px; border-radius:7px; cursor:pointer; }
      .ow-menu-item:hover { background:var(--dsw-alias-bg-layer-2, var(--ow-fill)); }
      .ow-menu-item b { font-weight:600; }
      .ow-menu-item .ow-note { display:block; margin-top:1px; }
      .ow-menu-err { position:absolute; right:0; top:calc(100% + 6px); z-index:31; max-width:290px; font-size:11.5px;
        color:#d1453b; background:rgba(209,69,59,.10); border:1px solid rgba(209,69,59,.35);
        border-radius:8px; padding:6px 9px; }
      .ow-input, .ow-select, .ow-area { font:inherit; font-size:12.5px; color:inherit; background:var(--ow-fill);
        border:1px solid var(--ow-line); border-radius:7px; padding:5px 8px; width:100%; box-sizing:border-box; }
      .ow-input:focus, .ow-select:focus, .ow-area:focus { outline:2px solid rgba(47,111,235,.45); outline-offset:0; border-color:#2f6feb; }
      .ow-area { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:11px; min-height:88px; resize:vertical; }
      .ow-form { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:10px 14px; }
      .ow-field { display:flex; flex-direction:column; gap:3px; }
      .ow-field > label { font-size:11px; color:var(--ow-mute); }
      .ow-field.wide { grid-column:1 / -1; }
      .ow-empty { text-align:center; padding:34px 18px; border:1px dashed var(--ow-line); border-radius:12px; color:var(--ow-mute); }
      .ow-empty b { display:block; color:inherit; font-size:13.5px; margin-bottom:5px; }
      .ow-note { font-size:11.5px; color:var(--ow-mute); }
      .ow-banner { margin:0 0 14px; padding:11px 13px; border-radius:10px; border:1px solid rgba(138,143,152,.45); background:rgba(138,143,152,.10); font-size:12.5px; line-height:1.55; }
      .ow-banner b { font-size:13px; }
      .ow-banner { display:flex; gap:9px; align-items:flex-start; font-size:12px; padding:9px 11px; border-radius:8px;
        border:1px solid var(--ow-line); background:var(--ow-fill); margin-bottom:14px; }
      .ow-guide { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; align-items:start; }
      .ow-guide ol, .ow-guide ul { margin:6px 0 0; padding-left:18px; }
      .ow-guide li { margin:3px 0; font-size:12px; }
      .ow-guide li b { font-weight:600; }
      .ow-kbd { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:11px; padding:1px 5px; border-radius:4px;
        border:1px solid var(--ow-line); background:var(--ow-fill-2); }
      .ow-actions { display:flex; flex-wrap:wrap; gap:6px; }
      .ow-actions .ow-btn[data-on="1"] { border-color:#2f6feb; color:#2f6feb; }
      .ow-split { display:grid; grid-template-columns:minmax(0,1fr); gap:12px; }
      .ow-spin { display:inline-block; width:11px; height:11px; border-radius:50%; border:2px solid var(--ow-line);
        border-top-color:#2f6feb; animation:ow-spin .7s linear infinite; vertical-align:-1px; }
      @keyframes ow-spin { to { transform:rotate(360deg) } }
      .ow-sb { display:flex; align-items:center; justify-content:center; width:100%; height:100%; opacity:.85; }
    `

    const STYLE_ID = 'ops-workbench-style'
    function ensureStyle() {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID)) return
      const el = document.createElement('style')
      el.id = STYLE_ID
      el.setAttribute('data-plugin-css', 'ops-workbench')
      el.textContent = CSS
      document.head.appendChild(el)
    }

    /* --------------------------------------------------------- 基础设施 */

    const LEVEL = {
      crit: { color: '#d1453b', soft: 'rgba(209,69,59,.12)', label: '要处理' },
      warn: { color: '#d89b1b', soft: 'rgba(216,155,27,.14)', label: '有隐患' },
      info: { color: '#2f6feb', soft: 'rgba(47,111,235,.12)', label: '提一句' },
      ok: { color: '#2e9e5b', soft: 'rgba(46,158,91,.13)', label: '正常' },
      // 连不上 ≠ 服务器挂了：多半是本机网络/代理还没就绪。所以用灰点，不占用红/橙语义。
      unreachable: { color: '#8a8f98', soft: 'rgba(138,143,152,.16)', label: '连不上' },
      unknown: { color: 'rgba(127,127,127,.75)', soft: 'rgba(127,127,127,.12)', label: '未巡检' },
    }

    function levelOf(record) {
      if (!record) return 'unknown'
      return LEVEL[record.level] ? record.level : 'unknown'
    }

    let nonceWait = null
    async function getNonce() {
      const read = () => (globalThis.__DSH_OPS__ && globalThis.__DSH_OPS__.nonce) || ''
      let value = read()
      if (value) return value
      if (!nonceWait) {
        nonceWait = new Promise((resolve) => {
          let tries = 0
          const tick = () => {
            const now = read()
            if (now || ++tries > 40) return resolve(now)
            setTimeout(tick, 50)
          }
          tick()
        })
      }
      value = await nonceWait
      if (value) return value
      // 注入脚本没赶上（Electron 下页面是 file:// + IPC 引导的）时，向宿主自举一次
      const res = await fetch('/ops/api/handshake')
      const data = await res.json().catch(() => ({}))
      if (data && data.nonce) {
        globalThis.__DSH_OPS__ = { nonce: data.nonce }
        nonceWait = Promise.resolve(data.nonce)
        return data.nonce
      }
      reportError('nonce.missing', new Error(`拿不到 nonce（handshake ${res.status}）`))
      return ''
    }

    let reporting = 0
    /** 白屏时唯一的现场：把异常写回宿主日志（~/.dsh/ops-workbench/client.log）。 */
    function reportError(kind, error, extra) {
      if (reporting > 5) return
      reporting++
      try {
        const nonce = (globalThis.__DSH_OPS__ && globalThis.__DSH_OPS__.nonce) || ''
        fetch('/ops/api/log', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-ops-nonce': nonce },
          body: JSON.stringify({
            kind,
            message: String((error && error.message) || error || ''),
            stack: String((error && error.stack) || ''),
            extra: extra ?? null,
          }),
          keepalive: true,
        }).catch(() => {})
      } catch { /* 上报失败就算了，不能让它把页面再搞挂一次 */ }
    }

    async function api(path, body) {      const nonce = await getNonce()
      const init = body === undefined
        ? { headers: { 'x-ops-nonce': nonce } }
        : { method: 'POST', headers: { 'x-ops-nonce': nonce, 'content-type': 'application/json' }, body: JSON.stringify(body) }
      const res = await fetch(path, init)
      const text = await res.text()
      let data = {}
      try { data = text ? JSON.parse(text) : {} } catch { data = { error: text.slice(0, 200) } }
      if (!res.ok) throw new Error(data.error || `请求失败（HTTP ${res.status}）`)
      return data
    }

    const fmtPct = (v) => (Number.isFinite(v) ? `${Math.round(v)}%` : '-')
    const fmtGb = (bytes) => {
      if (!Number.isFinite(bytes) || bytes <= 0) return '-'
      const gb = bytes / 1024 ** 3
      if (gb >= 1024) return `${(gb / 1024).toFixed(1)} TB`
      return gb >= 10 ? `${gb.toFixed(0)} GB` : `${gb.toFixed(1)} GB`
    }
    // 容量小到几百兆时 GB 会显示成 0.3 GB，做运维时更习惯看 MB
    const fmtSize = (bytes) => {
      if (!Number.isFinite(bytes) || bytes <= 0) return '-'
      const mb = bytes / 1024 ** 2
      if (mb < 1024) return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`
      return fmtGb(bytes)
    }
    // 「已用 32 GB / 共 39 GB」——磁盘这一项光看百分比看不出还剩多少余地
    const fmtDiskUse = (disk) => {
      if (!disk) return '-'
      const used = Number.isFinite(disk.usedBytes) ? fmtSize(disk.usedBytes) : null
      const total = Number.isFinite(disk.sizeBytes) ? fmtSize(disk.sizeBytes) : null
      if (used && total) return `${used} / ${total}`
      return total ? `共 ${total}` : '-'
    }
    // 挂载点路径可能很长（/var/lib/kubelet/pods/…/volumes/…），卡片里只留最后两段
    const shortMount = (mount) => {
      if (!mount) return '-'
      const parts = String(mount).split('/').filter(Boolean)
      if (parts.length <= 2) return '/' + parts.join('/')
      return '…/' + parts.slice(-2).join('/')
    }
    const fmtDiskPair = (disk) => {
      if (!disk || !Number.isFinite(disk.sizeBytes) || !Number.isFinite(disk.usedBytes)) return ''
      const gb = (n) => n / 1024 ** 3
      const totalGb = gb(disk.sizeBytes)
      const usedGb = gb(disk.usedBytes)
      if (totalGb >= 1 && usedGb >= 1) {
        const round = totalGb >= 100 ? 0 : 1
        const trim = (value) => String(Number(value.toFixed(round)))
        return `${trim(usedGb)}/${trim(totalGb)} GB`
      }
      return `${fmtSize(disk.usedBytes)}/${fmtSize(disk.sizeBytes)}`
    }
    const fmtRate = (bps) => {
      if (!Number.isFinite(bps) || bps <= 0) return '0'
      const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
      let value = bps
      let index = 0
      while (value >= 1024 && index < units.length - 1) { value /= 1024; index++ }
      return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
    }
    /* ---------------------------------------------- 时钟（相对时间用） */

    // 「刚刚 / 13 分钟前 / 还有 2 分钟」这类话只在重绘时算一次。数据没变就不重绘
    // （见下面的 signature 逻辑），文案就会冻在渲染那一刻：17:11 巡检完，17:24 还写着「刚刚」。
    // 这里挂一只共享时钟：只有订阅它的那几段文字会重绘，5 秒一跳，不动整棵树。
    const CLOCK_MS = 5000
    let clockNow = Date.now()
    const clockSubs = new Set()
    let clockTimer = null

    function clockBeat() {
      clockNow = Date.now()
      for (const push of clockSubs) push(clockNow)
    }

    // 标签页在后台时浏览器本来就会掐定时器，别白算；切回来立刻对一次表
    function clockOnBack() {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      clockBeat()
    }

    function clockStart() {
      if (clockTimer) return
      clockTimer = setInterval(clockOnBack, CLOCK_MS)
      // 浏览器里 id 是数字，没有 unref；无头环境（离线测试）里是 Timeout，要 unref 才不会让进程挂住
      if (clockTimer && typeof clockTimer.unref === 'function') clockTimer.unref()
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', clockOnBack)
      }
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('focus', clockOnBack)
      }
    }

    function clockStop() {
      clearInterval(clockTimer)
      clockTimer = null
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', clockOnBack)
      }
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('focus', clockOnBack)
      }
    }

    /** 当前时刻，跟着共享时钟走。订阅它的组件多走一步就重绘一次。 */
    function useNow() {
      const [now, setNow] = useState(clockNow)
      useEffect(() => {
        clockSubs.add(setNow)
        clockStart()
        // 挂载时先对一次：父组件可能几秒前就渲染好了，别从旧时间开始往回数
        const fresh = Date.now()
        if (fresh !== clockNow) {
          clockNow = fresh
          setNow(fresh)
        }
        return () => {
          clockSubs.delete(setNow)
          if (clockSubs.size === 0) clockStop()
        }
      }, [])
      return now
    }

    const fmtAgo = (ts, now = Date.now()) => {
      if (!ts) return '还没巡检过'
      const diff = Math.max(0, now - ts)
      if (diff < 60e3) return '刚刚'
      if (diff < 3600e3) return `${Math.round(diff / 60e3)} 分钟前`
      if (diff < 86400e3) return `${Math.round(diff / 3600e3)} 小时前`
      return `${Math.round(diff / 86400e3)} 天前`
    }
    const fmtIn = (ts, now = Date.now()) => {
      if (!ts) return ''
      const diff = ts - now
      if (diff <= 0) return '马上'
      if (diff < 60e3) return `${Math.round(diff / 1000)} 秒后`
      if (diff < 3600e3) return `${Math.round(diff / 60e3)} 分钟后`
      if (diff < 86400e3) return `${Math.round(diff / 3600e3)} 小时后`
      return `${Math.round(diff / 86400e3)} 天后`
    }

    /** 一段「相对时间」文本。自己看表，所以父组件不重绘它也照样走。 */
    function Ago({ at, lead = '', tail = '' }) {
      return `${lead}${fmtAgo(at, useNow())}${tail}`
    }

    /** 反过来：「还有 N 分钟」——下次自动巡检、下次重试。 */
    function In({ at, lead = '', tail = '' }) {
      return `${lead}${fmtIn(at, useNow())}${tail}`
    }

    const fmtClock = (ts) => {
      if (!ts) return '-'
      const d = new Date(ts)
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    /** 「1 分钟后重试（第 1/3 次）」—— 全失败后宿主会自己快速重试，得让用户看见。 */
    const retryHint = (retry, now = Date.now()) => {
      if (!retry || !retry.at) return ''
      const count = retry.count ?? 1
      const max = retry.max ?? 3
      return `${fmtIn(retry.at, now)}自动重试（第 ${count}/${max} 次）`
    }

    /** 重试预告：自己看表，倒计时会真的往下走。 */
    function RetryHint({ retry, lead = '', tail = '' }) {
      const text = retryHint(retry, useNow())
      return text ? `${lead}${text}${tail}` : ''
    }

    // 只到分钟，x 轴刻度和气泡都用它
    const fmtHm = (ts) => {
      if (!ts) return '-'
      const d = new Date(ts)
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    const fmtUptime = (sec) => {
      if (!sec) return '-'
      const days = Math.floor(sec / 86400)
      const hours = Math.floor((sec % 86400) / 3600)
      return days > 0 ? `${days}天${hours}小时` : `${hours}小时`
    }

    function copyText(text) {
      if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      document.body.removeChild(area)
      return Promise.resolve()
    }

    /** 把一段文本存成本地文件（浏览器里下载只有这一条路）。 */
    function saveFile(filename, content, mime) {
      const blob = new Blob([content], { type: mime })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }

    /* --------------------------------------------- 把问题带到对话框（处理） */

    // apply() 拿到的 client 侧 Context。面板本身没有会话绑定，只能借它去开一个对话。
    let HOST_CTX = null

    /** 巡检时的那几个关键指标，压成一行 —— 让 AI 不用再问一遍现状。 */
    function metricLine(snapshot) {
      if (!snapshot) return ''
      const parts = []
      if (snapshot.cpu) parts.push(`CPU ${fmtPct(snapshot.cpu.pct)}`)
      if (snapshot.mem) {
        parts.push(`内存可用 ${fmtPct(snapshot.mem.availPct)}（${fmtGb(snapshot.mem.availableBytes)} / ${fmtGb(snapshot.mem.totalBytes)}）`)
        if (Number.isFinite(snapshot.mem.swapUsedPct)) parts.push(`swap ${fmtPct(snapshot.mem.swapUsedPct)}`)
      }
      if (snapshot.disks?.[0]) parts.push(`磁盘 ${snapshot.disks[0].mount} ${fmtPct(snapshot.disks[0].usedPct)}`)
      if (snapshot.load) parts.push(`负载 ${Number(snapshot.load.l1).toFixed(2)}（${snapshot.host?.cores ?? '?'} 核）`)
      if (Array.isArray(snapshot.failedUnits)) parts.push(`失败服务 ${snapshot.failedUnits.length} 个`)
      return parts.join(' · ')
    }

    /** 把一条问题写成「人话 + 实测数据 + 我的处理要求」：AI 拿到它就能直接干活。 */
    function buildHandoff(issue) {
      const host = issue?.host ?? {}
      const snapshot = issue?.snapshot ?? null
      const lines = []
      lines.push('帮我一起处理一个运维问题。')
      lines.push('')
      lines.push(`【主机】${host.name || host.host}（${host.host}:${host.port || 22}${host.username ? `，用户 ${host.username}` : ''}）`)
      if (snapshot?.host?.os) lines.push(`【系统】${snapshot.host.os}${snapshot.host.kernel ? ` / ${snapshot.host.kernel}` : ''}`)
      lines.push(`【级别】${LEVEL[issue?.level]?.label ?? '待确认'}`)
      lines.push(`【问题】${issue?.title ?? ''}`)
      if (issue?.detail) lines.push(`【实测】${issue.detail}`)
      if (issue?.fix) lines.push(`【面板的建议】${issue.fix}`)
      const metrics = metricLine(snapshot)
      if (metrics) lines.push(`【巡检时的指标】${metrics}`)
      if (issue?.at) lines.push(`【巡检时间】${new Date(issue.at).toLocaleString('zh-CN')}`)
      lines.push('')
      lines.push('我的要求：')
      lines.push('1. 先告诉我最该先做哪一步、为什么是这一步，再给后面的顺序；')
      lines.push('2. 每条命令写清楚作用、风险、怎么回滚，命令要能整行复制；')
      lines.push('3. 需要我确认信息或授权的先问，不要替我假设；')
      lines.push('4. 要改配置或重启服务的，等我说「执行」再动手。')
      return lines.join('\n')
    }

    /**
     * 把求助稿放进对话的输入框 —— 不直接发送，发之前你得看一眼。
     * 面板没有会话绑定，所以用 uiWorkspace.startSession 打开 workspace 里那个可复用的空白会话；
     * 那个会话本来就有草稿时会接在后面（append），不会把你写的字冲掉。
     */
    function openHandoffInChat(text) {
      let ui = null
      try { ui = HOST_CTX && typeof HOST_CTX.get === 'function' ? HOST_CTX.get('uiWorkspace') : null } catch { ui = null }
      if (!ui || typeof ui.startSession !== 'function') return { ok: false, reason: 'no-workspace-service' }
      try {
        ui.startSession(undefined, { prompt: text, whenDraftExists: 'append', clearPreviousDraft: false })
        return { ok: true, via: 'uiWorkspace.startSession' }
      } catch (error) {
        reportError('handoff.start-session', error)
        return { ok: false, reason: 'start-session-failed' }
      }
    }

    /* ------------------------------------------------------------ 小部件 */

    function Dot({ level, size }) {
      const theme = LEVEL[level] ?? LEVEL.unknown
      const px = size ?? 7
      return h('span', { className: 'ow-dot', style: { background: theme.color, width: px, height: px } })
    }

    function Bar({ pct, level }) {
      const theme = LEVEL[level] ?? LEVEL.ok
      const width = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0))
      return h('div', { className: 'ow-bar' }, h('i', { style: { width: `${width}%`, background: theme.color } }))
    }

    function Metric({ label, value, pct, level, hint, wide }) {
      return h('div', { className: `ow-metric${wide ? ' ow-metric-wide' : ''}` },
        h('span', { className: 'ow-metric-k' }, label),
        h('span', { className: 'ow-metric-v' }, value),
        Number.isFinite(pct) ? h(Bar, { pct, level }) : null,
        hint ? h('span', { className: 'ow-metric-hint' }, hint) : null,
      )
    }

    // 磁盘一个挂载点一行：根分区和数据盘各自一行、各自一根进度条，
    // 不用"取最满的那块"混成一个数字 —— 根分区满会写不进日志，数据盘满会写不进业务，
    // 两种故障要分开看。
    // 1 GB 以下的分区（/boot/efi 这类引导分区）默认折叠成一行提示：
    // 它们几乎不会成为问题，平白占掉一行视觉位置反而把大盘挤下去。
    // 例外：根分区永不折叠；小分区真的超了阈值也不折叠（那是真问题，藏起来就是失职）。
    const TINY_DISK = 1024 ** 3
    const diskLevelOf = (disk, thresholds) => {
      const warn = thresholds?.diskUsedPct?.warn ?? 85
      const crit = thresholds?.diskUsedPct?.crit ?? 93
      return disk.usedPct >= crit ? 'crit' : disk.usedPct >= warn ? 'warn' : 'ok'
    }
    const isTinyDisk = (disk) => disk.mount !== '/' && Number.isFinite(disk.sizeBytes) && disk.sizeBytes < TINY_DISK
    const isQuietTiny = (disk, thresholds) => isTinyDisk(disk) && diskLevelOf(disk, thresholds) === 'ok'

    function DiskRow({ disk, thresholds }) {
      const level = diskLevelOf(disk, thresholds)
      const theme = LEVEL[level]
      const root = disk.mount === '/'
      return h('div', {
        className: 'ow-disk-row',
        title: `${disk.fs} 挂载在 ${disk.mount}：已用 ${fmtSize(disk.usedBytes)} / 共 ${fmtSize(disk.sizeBytes)}，剩 ${fmtSize(disk.availBytes)}`,
      },
        h('span', { className: 'ow-disk-mount' }, root ? '根分区 /' : shortMount(disk.mount)),
        h('span', { className: 'ow-disk-bar' }, h('i', {
          style: { width: `${Math.max(0, Math.min(100, disk.usedPct))}%`, background: theme.color },
        })),
        h('span', { className: 'ow-disk-val', style: level === 'ok' ? null : { color: theme.color } },
          `${fmtDiskUse(disk)} · ${fmtPct(disk.usedPct)}`),
      )
    }

    function DiskList({ disks, thresholds }) {
      const [showTiny, setShowTiny] = useState(false)
      if (!disks || !disks.length) return null
      const quiet = disks.filter((disk) => isQuietTiny(disk, thresholds))
      const shown = disks.filter((disk) => !isQuietTiny(disk, thresholds)).slice(0, 4)
      const rest = disks.filter((disk) => !isQuietTiny(disk, thresholds)).length - shown.length
      return h('div', { className: 'ow-disks' },
        h('div', { className: 'ow-disks-h' }, '磁盘'),
        shown.map((disk) => h(DiskRow, { key: `${disk.fs}|${disk.mount}`, disk, thresholds })),
        showTiny
          ? quiet.map((disk) => h(DiskRow, { key: `${disk.fs}|${disk.mount}`, disk, thresholds }))
          : null,
        quiet.length && !showTiny
          ? h('button', {
            type: 'button',
            className: 'ow-disks-more',
            onClick: () => setShowTiny(true),
            title: quiet.map((disk) => `${disk.mount} ${fmtPct(disk.usedPct)}`).join(' · '),
          }, `另有 ${quiet.length} 个小分区（< 1 GB，已折叠）`)
          : null,
        showTiny && quiet.length
          ? h('button', {
            type: 'button',
            className: 'ow-disks-more',
            onClick: () => setShowTiny(false),
          }, '收起小分区')
          : null,
        rest > 0 ? h('div', { className: 'ow-disks-h' }, `还有 ${rest} 个挂载点，去「巡检」看完整列表`) : null,
      )
    }

    function Btn({ children, kind, tiny, ...rest }) {
      return h('button', {
        className: `ow-btn${tiny ? ' ow-tiny' : ''}`,
        'data-kind': kind ?? 'default',
        type: 'button',
        ...rest,
      }, children)
    }

    function Field({ label, wide, children }) {
      return h('div', { className: `ow-field${wide ? ' wide' : ''}` }, h('label', null, label), children)
    }

    function verdictText(record) {
      const issues = record?.issues ?? []
      if (!record) return '未巡检'
      if (record.error) return '连不上'
      const crit = issues.filter((i) => i.level === 'crit').length
      const warn = issues.filter((i) => i.level === 'warn').length
      if (crit > 0) return `${crit} 项要处理`
      if (warn > 0) return `${warn} 项隐患`
      return '一切正常'
    }

    /* -------------------------------------------------------------- 总览 */

    function HostCard({ host, record, busy, thresholds, onInspect, onOpenDiag }) {
      const snap = record?.snapshot
      const level = levelOf(record)
      const theme = LEVEL[level]
      const cpuLevel = snap && snap.cpu.pct >= 85 ? (snap.cpu.pct >= 95 ? 'crit' : 'warn') : 'ok'
      const memLevel = snap && snap.mem.availPct <= 15 ? (snap.mem.availPct <= 8 ? 'crit' : 'warn') : 'ok'

      return h('div', { className: 'ow-card' },
        h('div', { className: 'ow-card-h' },
          h(Dot, { level }),
          h('b', null, host.name || host.host),
          h('span', { className: 'ow-host' }, `${host.host}:${host.port}`),
        ),
        h('div', { className: 'ow-verdict' },
          h('span', { className: 'ow-pill', style: { color: theme.color, borderColor: theme.color, background: theme.soft } }, verdictText(record)),
          h('span', { className: 'ow-note' }, snap
            ? h(Ago, { at: record.at, lead: '巡检于 ' })
            : record ? h(Ago, { at: record.at, lead: '连不上 · ' }) : '点右边巡检一次'),
        ),
        record?.error
          ? h('div', { className: 'ow-note', style: { marginTop: 6 } }, `原因：${String(record.error).slice(0, 120)}`)
          : null,
        snap
          ? h('div', { className: 'ow-metrics' },
            h(Metric, { label: 'CPU', value: fmtPct(snap.cpu.pct), pct: snap.cpu.pct, level: cpuLevel }),
            h(Metric, {
              label: '内存可用',
              value: `${fmtGb(snap.mem.availableBytes)} · ${fmtPct(snap.mem.availPct)}`,
              pct: 100 - snap.mem.availPct,
              level: memLevel,
              hint: snap.mem.totalBytes ? `共 ${fmtSize(snap.mem.totalBytes)}` : null,
            }),
            h(Metric, { label: '负载 / 核数', value: `${snap.load.l1.toFixed(2)} / ${snap.host.cores}`, pct: Math.min(100, (snap.load.perCore ?? 0) * 100 / 2) }),
            h(Metric, { label: '网络 入/出', value: `${fmtRate(snap.net.rxBps)} / ${fmtRate(snap.net.txBps)}` }),
            h(Metric, { label: '已运行', value: fmtUptime(snap.host.uptimeSec) }),
          )
          : null,
        snap ? h(DiskList, { disks: snap.disks, thresholds }) : null,
        record?.issues?.length
          ? h('div', { className: 'ow-note', style: { marginTop: 8 } }, record.issues.slice(0, 2).map((issue) => issue.title).join(' · ') + (record.issues.length > 2 ? ` 等 ${record.issues.length} 项` : ''))
          : null,
        h('div', { className: 'ow-foot' },
          h(Btn, { tiny: true, onClick: () => onInspect(host.id), disabled: busy }, busy ? h('span', { className: 'ow-spin' }) : '巡检'),
          h(Btn, { tiny: true, kind: 'ghost', onClick: () => onOpenDiag(host.id) }, '排障'),
        ),
      )
    }

    function Overview({ state, busyIds, onInspectAll, onInspectOne, onScan, goTab, goDiag }) {
      const hosts = state?.hosts ?? []
      const lastInspect = state?.lastInspect ?? {}
      const rows = hosts.map((host) => ({ host, record: lastInspect[host.id] }))
      const critHosts = rows.filter((row) => row.record?.level === 'crit').length
      const warnHosts = rows.filter((row) => row.record?.level === 'warn').length
      const downHosts = rows.filter((row) => row.record?.error).length
      const allDown = hosts.length > 0 && downHosts === hosts.length
      const retry = state?.scheduler?.retry

      if (hosts.length === 0) {
        return h('div', { className: 'ow-empty' },
          h('b', null, '先加一台服务器，剩下的交给我'),
          h('div', null, '填地址、用户名、密码就行 —— 全部操作都是只读的，我不会去改你的机器。'),
          h('div', { style: { marginTop: 12 } }, h(Btn, { kind: 'primary', onClick: () => goTab('hosts') }, '添加主机')),
        )
      }

      return h('div', null,
        h('div', { className: 'ow-row', style: { marginBottom: 14 } },
          h('div', { className: 'ow-pill' }, h(Dot, { level: 'ok' }), `${hosts.length} 台主机`),
          critHosts > 0 ? h('div', { className: 'ow-pill', style: { color: LEVEL.crit.color, borderColor: LEVEL.crit.color } }, `${critHosts} 台要处理`) : null,
          warnHosts > 0 ? h('div', { className: 'ow-pill', style: { color: LEVEL.warn.color, borderColor: LEVEL.warn.color } }, `${warnHosts} 台有隐患`) : null,
          h('div', { className: 'ow-spacer' }),
          h(Btn, { kind: 'primary', onClick: onInspectAll, disabled: busyIds.size > 0 }, busyIds.size > 0 ? '巡检中…' : '全部巡检一次'),
        ),
        allDown
          ? h('div', { className: 'ow-banner' },
            h('b', null, `${hosts.length} 台一台都没连上`),
            h('div', { style: { marginTop: 4 } },
              '这多半不是服务器的问题，而是这台电脑的网络/代理还没就绪（刚开机、刚唤醒、VPN 或公司代理没连上）。',
              retry?.at ? h(RetryHint, { retry, lead: ' ', tail: '。' }) : ' 这轮重试用完了 —— 网络恢复后点「全部巡检一次」即可。'),
            h('div', { className: 'ow-note', style: { marginTop: 4 } },
              `失败原因：${String(rows[0]?.record?.error ?? '').slice(0, 120)}`),
          )
          : null,
        h('div', { className: 'ow-grid' },
          rows.map(({ host, record }) => h(HostCard, {
            key: host.id,
            host,
            record,
            busy: busyIds.has(host.id),
            thresholds: state?.thresholds,
            onInspect: onInspectOne,
            onOpenDiag: goDiag,
          })),
        ),
        h('div', { className: 'ow-note', style: { marginTop: 14 } },
          '巡检只读：跑一段 shell 采数据，不改配置、不重启服务。'),
      )
    }

    /* -------------------------------------------------------------- 主机 */

    const BLANK_HOST = {
      id: '', name: '', host: '', port: 22, username: 'root',
      authType: 'password', password: '', keyPath: '', keyText: '', group: '', note: '',
    }

    function HostForm({ draft, setDraft, onSubmit, onCancel, saving, error }) {
      const set = (key) => (event) => setDraft({ ...draft, [key]: event.target.value })
      const isEdit = Boolean(draft.id)
      return h('form', {
        className: 'ow-card',
        style: { marginBottom: 14 },
        onSubmit: (event) => { event.preventDefault(); onSubmit() },
      },
        h('div', { className: 'ow-card-h', style: { marginBottom: 10 } }, h('b', null, isEdit ? '编辑主机' : '添加主机')),
        h('div', { className: 'ow-form' },
          h(Field, { label: '名字（自己看得懂就行）' }, h('input', { className: 'ow-input', value: draft.name, onChange: set('name'), placeholder: '网站服务器' })),
          h(Field, { label: '地址 IP / 域名' }, h('input', { className: 'ow-input', value: draft.host, onChange: set('host'), placeholder: '1.2.3.4' })),
          h(Field, { label: '端口' }, h('input', { className: 'ow-input', value: draft.port, onChange: set('port'), inputMode: 'numeric' })),
          h(Field, { label: '用户名' }, h('input', { className: 'ow-input', value: draft.username, onChange: set('username'), placeholder: 'root' })),
          h(Field, { label: '登录方式' },
            h('select', { className: 'ow-select', value: draft.authType, onChange: set('authType') },
              h('option', { value: 'password' }, '用户名 + 密码'),
              h('option', { value: 'key' }, '私钥文件'),
            )),
          draft.authType === 'password'
            ? h(Field, { label: isEdit ? '密码（留空=不修改）' : '密码' },
              h('input', { className: 'ow-input', type: 'password', value: draft.password, onChange: set('password'), placeholder: isEdit ? '不修改' : '服务器密码' }))
            : h(Field, { label: '本机私钥路径（可选）' },
              h('input', { className: 'ow-input', value: draft.keyPath, onChange: set('keyPath'), placeholder: 'C:/Users/Administrator/.ssh/id_rsa' })),
          draft.authType === 'key'
            ? h(Field, { label: '或者直接粘贴私钥内容', wide: true },
              h('textarea', { className: 'ow-area', value: draft.keyText, onChange: set('keyText'), placeholder: '-----BEGIN OPENSSH PRIVATE KEY-----' }))
            : null,
          h(Field, { label: '分组（可选）' }, h('input', { className: 'ow-input', value: draft.group, onChange: set('group'), placeholder: '生产 / 测试' })),
          h(Field, { label: '备注（可选）' }, h('input', { className: 'ow-input', value: draft.note, onChange: set('note'), placeholder: '跑着什么服务' })),
        ),
        error ? h('div', { className: 'ow-note', style: { color: LEVEL.crit.color, marginTop: 8 } }, error) : null,
        h('div', { className: 'ow-row', style: { marginTop: 12 } },
          h(Btn, { kind: 'primary', type: 'submit', disabled: saving }, saving ? '保存中…' : '保存'),
          h(Btn, { kind: 'ghost', type: 'button', onClick: onCancel }, '取消'),
          h('span', { className: 'ow-note' }, '密码只存在本机的 ~/.dsh/ops-workbench/state.json 里，不上传任何地方。'),
        ),
      )
    }

    function Hosts({ state, onSave, onDelete, onTest, testing }) {
      const [draft, setDraft] = useState(BLANK_HOST)
      const [editing, setEditing] = useState(false)
      const [saving, setSaving] = useState(false)
      const [error, setError] = useState('')
      const hosts = state?.hosts ?? []

      const submit = async () => {
        setSaving(true)
        setError('')
        try {
          await onSave(draft)
          setDraft(BLANK_HOST)
          setEditing(false)
        } catch (err) {
          setError(String(err?.message ?? err))
        } finally {
          setSaving(false)
        }
      }

      const startEdit = (host) => {
        setDraft({ ...BLANK_HOST, ...host, port: host.port, password: '', keyText: '' })
        setEditing(true)
      }

      return h('div', null,
        (editing || hosts.length === 0)
          ? h(HostForm, { draft, setDraft, onSubmit: submit, onCancel: () => { setEditing(false); setDraft(BLANK_HOST); setError('') }, saving, error })
          : h('div', { className: 'ow-row', style: { marginBottom: 12 } },
            h(Btn, { kind: 'primary', onClick: () => { setDraft(BLANK_HOST); setEditing(true) } }, '添加主机'),
            h('span', { className: 'ow-note' }, `${hosts.length} 台已配置`),
          ),
        hosts.length > 0
          ? h('div', { className: 'ow-card', style: { padding: 0, overflow: 'hidden' } },
            h('table', { className: 'ow-table' },
              h('thead', null, h('tr', null,
                h('th', null, '主机'), h('th', null, '登录'), h('th', null, '分组'), h('th', null, '最近巡检'), h('th', null, ''),
              )),
              h('tbody', null, hosts.map((host) => {
                const record = state.lastInspect?.[host.id]
                const test = testing[host.id]
                return h('tr', { key: host.id },
                  h('td', null,
                    h('div', { className: 'ow-row', style: { gap: 6 } }, h(Dot, { level: levelOf(record) }), h('b', null, host.name || host.host)),
                    h('div', { className: 'ow-note' }, `${host.host}:${host.port}${host.note ? ' · ' + host.note : ''}`),
                  ),
                  h('td', null, host.authType === 'password' ? '密码' : '私钥'),
                  h('td', null, host.group || '-'),
                  h('td', { className: 'num' }, record ? h(Ago, { at: record.at }) : '未巡检'),
                  h('td', null,
                    h('div', { className: 'ow-row', style: { gap: 4, justifyContent: 'flex-end' } },
                      test ? h('span', { className: 'ow-pill' },
                        test.ok ? h(Dot, { level: 'ok' }) : h(Dot, { level: 'crit' }),
                        test.ok ? `${test.whoami}@${test.hostname}` : (test.error || '失败'),
                      ) : null,
                      h(Btn, { tiny: true, kind: 'ghost', onClick: () => onTest(host.id), disabled: Boolean(test?.pending) }, test?.pending ? '测试中…' : '测连接'),
                      h(Btn, { tiny: true, kind: 'ghost', onClick: () => startEdit(host) }, '改'),
                      h(Btn, { tiny: true, kind: 'ghost', onClick: () => onDelete(host) }, '删'),
                    ),
                  ),
                )
              })),
            ))
          : null,
      )
    }

    /* -------------------------------------------------------------- 巡检 */

    /* ---------------------------------------------------------- 走势曲线 */
    // 取最近多少次巡检；页面「最近走势」用它，后端最多保留 480 次
    const TREND_POINTS = 24
    const TREND_W = 240
    const TREND_H = 120
    const TREND_PAD = 5
    const TREND_SPAN = TREND_H - TREND_PAD * 2
    // 自适应纵轴的最小跨度（百分点）。真实内存波动只有 0.1–2.6pp，
    // 全按 0–100% 画就是一条死直线；但也不能把 0.1pp 的抖动放大成过山车，所以兜 6pp 底。
    const TREND_MIN_SPAN = 6

    function trendAvails(points) {
      return (points ?? [])
        .filter((point) => point && Number.isFinite(point.at))
        .map((point) => (Number.isFinite(point.memAvailPct) ? point.memAvailPct : 100))
    }

    // 纵轴范围：数据落在这个区间里，两端各留一点余量；同时夹在 0–100 之内
    function trendDomain(points) {
      const avails = trendAvails(points)
      if (avails.length === 0) return { d0: 0, d1: 100 }
      const low = Math.min(...avails)
      const high = Math.max(...avails)
      const span = Math.max(high - low + Math.max(2, (high - low) * 0.3), TREND_MIN_SPAN)
      const mid = (low + high) / 2
      let d0 = mid - span / 2
      let d1 = mid + span / 2
      if (d0 < 0) { d1 -= d0; d0 = 0 }
      if (d1 > 100) { d0 -= d1 - 100; d1 = 100 }
      return { d0: Math.max(0, d0), d1: Math.min(100, d1) }
    }

    // Catmull-Rom 转三次贝塞尔：每个采样点只受左右邻居影响，画出来是一条平滑曲线，
    // 既不抖成折线，也不会像样条那样在两点之间乱冲（控制点一律夹在框内）。
    function smoothPath(points) {
      if (!points || points.length === 0) return ''
      const first = points[0]
      if (points.length === 1) return `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`
      const clampY = (value) => Math.max(TREND_PAD, Math.min(TREND_H - TREND_PAD, value))
      const tension = 0.2
      let d = `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`
      for (let i = 0; i < points.length - 1; i += 1) {
        const p0 = points[i - 1] ?? points[i]
        const p1 = points[i]
        const p2 = points[i + 1]
        const p3 = points[i + 2] ?? p2
        const c1x = p1.x + (p2.x - p0.x) * tension
        const c1y = clampY(p1.y + (p2.y - p0.y) * tension)
        const c2x = p2.x - (p3.x - p1.x) * tension
        const c2y = clampY(p2.y - (p3.y - p1.y) * tension)
        d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
      }
      return d
    }

    // 采样点 → 画布坐标：纵轴画「内存可用%」，越高越松快
    function trendPoints(points, domain) {
      const usable = (points ?? []).filter((point) => point && Number.isFinite(point.at))
      const range = domain ?? trendDomain(usable)
      const span = Math.max(0.0001, range.d1 - range.d0)
      return usable.map((point, index) => {
        const avail = Number.isFinite(point.memAvailPct) ? point.memAvailPct : 100
        const used = Math.max(0, Math.min(100, 100 - avail))
        const x = usable.length === 1 ? TREND_W : (index / (usable.length - 1)) * TREND_W
        const ratio = Math.max(0, Math.min(1, (avail - range.d0) / span))
        const y = TREND_PAD + TREND_SPAN * (1 - ratio)
        return { x, y, at: point.at, avail, used }
      })
    }

    // x 轴刻度下标：按点数均匀挑，默认 6 个；点太少就少给几个，避免标签互相压字
    const X_TICKS = 6
    function xTickIndexes(count, want = X_TICKS) {
      if (!Number.isFinite(count) || count <= 0) return []
      if (count === 1) return [0]
      const ticks = Math.max(2, Math.min(want, count))
      const out = []
      for (let i = 0; i < ticks; i += 1) out.push(Math.round((i * (count - 1)) / (ticks - 1)))
      return Array.from(new Set(out))
    }

    // 鼠标横向位置（0–1）落在第几个采样点上
    function hoverIndexAt(ratio, count) {
      if (!Number.isFinite(ratio) || count <= 0) return 0
      const clamped = Math.max(0, Math.min(1, ratio))
      return Math.round(clamped * (count - 1))
    }

    function TrendChart({ points, rules, hostName }) {
      const [hover, setHover] = useState(null)
      const domain = trendDomain(points)
      const pts = trendPoints(points, domain)
      const availWarn = rules.memAvailPct?.warn ?? 15
      const availCrit = rules.memAvailPct?.crit ?? 8
      const worst = pts.reduce((min, point) => Math.min(min, point.avail), 100)
      const color = worst <= availCrit ? LEVEL.crit.color : worst <= availWarn ? LEVEL.warn.color : LEVEL.ok.color
      const last = pts[pts.length - 1]
      const line = smoothPath(pts)
      const area = pts.length > 1 ? `${line} L ${TREND_W} ${TREND_H} L 0 ${TREND_H} Z` : ''
      const span = Math.max(0.0001, domain.d1 - domain.d0)
      const warnInside = availWarn >= domain.d0 && availWarn <= domain.d1
      const warnY = TREND_PAD + TREND_SPAN * (1 - (availWarn - domain.d0) / span)
      const ticks = [domain.d1, (domain.d1 + domain.d0) / 2, domain.d0]
      const xTicks = xTickIndexes(pts.length).map((index) => ({ index, at: pts[index].at, x: pts[index].x }))

      const onMove = (event) => {
        if (pts.length === 0) return
        const box = event?.currentTarget?.getBoundingClientRect?.()
        if (!box || !box.width) return
        setHover(hoverIndexAt((event.clientX - box.left) / box.width, pts.length))
      }
      const onLeave = () => setHover(null)
      const hovered = hover != null && pts[hover] ? pts[hover] : null
      const hoverLeft = hovered ? Math.min(94, Math.max(6, (hovered.x / TREND_W) * 100)) : 0

      return h('div', { className: 'ow-chart' },
        h('div', { className: 'ow-chart-y' }, ticks.map((value, index) => h('span', { key: index }, `${value.toFixed(1)}%`))),
        h('div', { className: 'ow-chart-main' },
          h('div', { className: 'ow-chart-plot', onMouseMove: onMove, onMouseLeave: onLeave },
            h('svg', {
              className: 'ow-chart-svg',
              viewBox: `0 0 ${TREND_W} ${TREND_H}`,
              preserveAspectRatio: 'none',
              role: 'img',
              'aria-label': `${hostName ?? ''} 内存可用走势，纵向 ${domain.d0.toFixed(1)}% 到 ${domain.d1.toFixed(1)}%`,
            },
              ticks.map((value, index) => h('line', {
                key: `grid${index}`,
                x1: 0, y1: (TREND_PAD + TREND_SPAN * (index / 2)).toFixed(2),
                x2: TREND_W, y2: (TREND_PAD + TREND_SPAN * (index / 2)).toFixed(2),
                stroke: 'currentColor', strokeWidth: 1, opacity: 0.12,
                vectorEffect: 'non-scaling-stroke',
              })),
              xTicks.map((tick) => h('line', {
                key: `xgrid${tick.index}`,
                x1: tick.x.toFixed(2), y1: 0, x2: tick.x.toFixed(2), y2: TREND_H,
                stroke: 'currentColor', strokeWidth: 1, opacity: 0.08,
                vectorEffect: 'non-scaling-stroke',
              })),
              warnInside
                ? h('line', {
                  x1: 0, y1: warnY.toFixed(2), x2: TREND_W, y2: warnY.toFixed(2),
                  stroke: LEVEL.warn.color, strokeWidth: 1, strokeDasharray: '3 4', opacity: 0.5,
                  vectorEffect: 'non-scaling-stroke',
                })
                : null,
              area ? h('path', { d: area, fill: color, fillOpacity: 0.12, stroke: 'none' }) : null,
              pts.length > 1
                ? h('path', {
                  d: line, fill: 'none', stroke: color, strokeWidth: 1.6,
                  strokeLinejoin: 'round', strokeLinecap: 'round', vectorEffect: 'non-scaling-stroke',
                })
                : null,
            ),
            // 圆点和准线一律用 HTML 绝对定位到画布上：SVG 是 preserveAspectRatio="none" 横向拉伸的，
            // 画在里面的 circle 会被一起拉成椭圆（看着又大又扁），HTML 元素不受这个缩放影响。
            last
              ? h('div', {
                className: 'ow-plot-dot ow-plot-dot--last',
                style: { left: `${(last.x / TREND_W) * 100}%`, top: `${(last.y / TREND_H) * 100}%`, background: color },
              })
              : null,
            hovered
              ? h('div', { className: 'ow-cross', style: { left: `${(hovered.x / TREND_W) * 100}%` } })
              : null,
            hovered
              ? h('div', {
                className: 'ow-plot-dot',
                style: { left: `${(hovered.x / TREND_W) * 100}%`, top: `${(hovered.y / TREND_H) * 100}%`, background: color },
              })
              : null,
            hovered
              ? h('div', { className: 'ow-tip', style: { left: `${hoverLeft}%`, top: `${(hovered.y / TREND_H) * 100}%` } },
                h('b', null, fmtHm(hovered.at)),
                ` · 可用 ${hovered.avail.toFixed(1)}% · 已用 ${hovered.used.toFixed(1)}%`)
              : null,
          ),
          h('div', { className: 'ow-chart-x' },
            xTicks.map((tick) => h('span', {
              key: `xt${tick.index}`,
              style: {
                left: `${(tick.x / TREND_W) * 100}%`,
                // 首个左对齐、末个右对齐，免得标签被画布边缘切掉
                transform: tick.index === 0 ? 'none' : tick.index === pts.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
              },
            }, fmtHm(tick.at))),
          ),
        ),
      )
    }

    function InspectView({ state, results, running, onRun, onSaveThresholds, onSchedule }) {
      const hosts = state?.hosts ?? []
      const lastInspect = state?.lastInspect ?? {}
      const history = state?.history ?? {}
      const sched = state?.scheduler ?? {}
      const auto = sched.auto ?? { enabled: false, everyMinutes: 15 }
      const daily = sched.daily ?? { enabled: false, hour: 9, minute: 0 }
      const pad2 = (n) => String(n).padStart(2, '0')
      const [openRules, setOpenRules] = useState(false)
      const [draft, setDraft] = useState(null)
      // 正在准备「带去对话」的那一条；null = 没打开
      const [handoff, setHandoff] = useState(null)
      const [trendHostId, setTrendHostId] = useState('')

      const rows = useMemo(() => hosts.map((host) => {
        const record = lastInspect[host.id]
        return { host, record, level: levelOf(record) }
      }), [hosts, lastInspect])

      const issues = rows.flatMap((row) => (row.record?.issues ?? []).map((issue) => ({
        ...issue, host: row.host, snapshot: row.record?.snapshot ?? null, at: row.record?.at,
      })))
      const order = { crit: 0, warn: 1, info: 2 }
      issues.sort((a, b) => (order[a.level] ?? 3) - (order[b.level] ?? 3))

      // 走势：只有两次以上采样才有意义
      const trendRows = hosts.map((host) => {
        const points = (history[host.id] ?? [])
          .filter((point) => point && Number.isFinite(point.at))
          .slice(-24)
        if (points.length < 2) return null
        let memMin = null
        let diskMax = null
        for (const point of points) {
          if (Number.isFinite(point.memAvailPct) && (!memMin || point.memAvailPct < memMin.value)) memMin = { value: point.memAvailPct, at: point.at }
          if (Number.isFinite(point.diskUsedPct) && (!diskMax || point.diskUsedPct > diskMax.value)) diskMax = { value: point.diskUsedPct, at: point.at }
        }
        return { host, points, memMin, diskMax }
      }).filter(Boolean)

      const startHandoff = (issue) => setHandoff({ issue, text: buildHandoff(issue), note: '' })

      const confirmHandoff = () => {
        if (!handoff) return
        const result = openHandoffInChat(handoff.text)
        if (result.ok) {
          setHandoff({ ...handoff, note: '已经放进对话的输入框 —— 检查一下，按发送我就接着干。' })
          return
        }
        copyText(handoff.text)
          .then(() => setHandoff({ ...handoff, note: '没找到对话接口，已复制到剪贴板，粘进输入框就行。' }))
          .catch(() => setHandoff({ ...handoff, note: '对话没打开、复制也失败 —— 手动选上面的文字复制。' }))
      }

      const rules = state?.thresholds ?? {}
      const spec = [
        ['cpuPct', 'CPU 使用率', '%'],
        ['memAvailPct', '内存可用低于', '%'],
        ['swapUsedPct', 'Swap 使用率', '%'],
        ['diskUsedPct', '磁盘使用率', '%'],
        ['inodeUsedPct', 'inode 使用率', '%'],
        ['loadPerCore', '每核负载', 'x'],
        ['clockSkewSec', '时间偏差', '秒'],
        ['failedUnits', '失败服务数', '个'],
      ]

      return h('div', null,
        h('div', { className: 'ow-row', style: { marginBottom: 12 } },
          h(Btn, { kind: 'primary', onClick: onRun, disabled: running }, running ? h('span', { className: 'ow-spin' }) : null, running ? ' 正在巡检…' : '巡检所有主机'),
          h('span', { className: 'ow-note' }, '只读采集，约 1–3 秒一台'),
          h('div', { className: 'ow-spacer' }),
          h(Btn, { tiny: true, kind: 'ghost', onClick: () => { setOpenRules(!openRules); if (!draft) setDraft(JSON.parse(JSON.stringify(rules))) } }, openRules ? '收起判定标准' : '判定标准'),
        ),

        h('div', { className: 'ow-card', style: { marginBottom: 14 } },
          h('div', { className: 'ow-row', style: { gap: 8 } },
            h('b', null, '定时任务'),
            h('div', { className: 'ow-spacer' }),
            h('span', { className: 'ow-note' }, '跑在宿主里，页面关掉也照跑（只读采集）'),
          ),
          h('div', { className: 'ow-row', style: { marginTop: 8, gap: 6 } },
            h(Btn, {
              tiny: true,
              kind: auto.enabled ? 'primary' : 'default',
              onClick: () => onSchedule({ auto: { enabled: !auto.enabled } }),
            }, auto.enabled ? '自动巡检：开' : '自动巡检：关'),
            [10, 15, 30, 60].map((minutes) => h(Btn, {
              key: minutes,
              tiny: true,
              kind: auto.enabled && auto.everyMinutes === minutes ? 'primary' : 'ghost',
              onClick: () => onSchedule({ auto: { enabled: true, everyMinutes: minutes } }),
            }, `${minutes} 分钟`)),
            h('span', { className: 'ow-note' }, auto.lastAutoAt ? h(Ago, { at: auto.lastAutoAt, lead: '上次自动巡检 ' }) : '还没跑过自动巡检'),
          ),
          h('div', { className: 'ow-row', style: { marginTop: 8, gap: 6 } },
            h(Btn, {
              tiny: true,
              kind: daily.enabled ? 'primary' : 'default',
              onClick: () => onSchedule({ daily: { enabled: !daily.enabled } }),
            }, daily.enabled ? '每日日报：开' : '每日日报：关'),
            h('select', {
              className: 'ow-input',
              style: { width: 92 },
              value: String(daily.hour),
              onChange: (event) => onSchedule({ daily: { enabled: true, hour: Number(event.target.value) } }),
            }, Array.from({ length: 24 }, (_, hour) => h('option', { key: hour, value: String(hour) }, `${pad2(hour)}:${pad2(daily.minute)}`))),
            h('span', { className: 'ow-note' },
              sched.daily?.lastReportDate
                ? `今天（${sched.daily.lastReportDate}）已经生成过了`
                : '到点自动生成，存到本机 reports 目录'),
          ),
        ),

        openRules
          ? h('div', { className: 'ow-card', style: { marginBottom: 14 } },
            h('div', { className: 'ow-note', style: { marginBottom: 8 } }, '超过这些线就报警。第一次用建议别改 —— 默认值是按「小网站能扛住」定的。'),
            h('div', { className: 'ow-form' },
              spec.map(([key, label, unit]) => h(Field, { key, label: `${label}（${unit}）` },
                h('div', { className: 'ow-row', style: { gap: 4 } },
                  h('input', {
                    className: 'ow-input',
                    value: draft?.[key]?.warn ?? '',
                    onChange: (event) => setDraft({ ...draft, [key]: { ...(draft?.[key] ?? {}), warn: Number(event.target.value) } }),
                    title: '提示线',
                  }),
                  h('input', {
                    className: 'ow-input',
                    value: draft?.[key]?.crit ?? '',
                    onChange: (event) => setDraft({ ...draft, [key]: { ...(draft?.[key] ?? {}), crit: Number(event.target.value) } }),
                    title: '严重线',
                  }),
                ),
              )),
            ),
            h('div', { className: 'ow-row', style: { marginTop: 10 } },
              h(Btn, { kind: 'primary', tiny: true, onClick: () => onSaveThresholds(draft) }, '保存'),
              h('span', { className: 'ow-note' }, '左=提示 右=严重'),
            ))
          : null,

        handoff
          ? h('div', {
            className: 'ow-card',
            style: { marginBottom: 14, borderColor: (LEVEL[handoff.issue.level] ?? LEVEL.info).color },
          },
            h('div', { className: 'ow-row', style: { gap: 8 } },
              h(Dot, { level: handoff.issue.level }),
              h('b', null, '带着这条去对话'),
              h('div', { className: 'ow-spacer' }),
              h('span', { className: 'ow-note' }, '可以改，改完再打开'),
            ),
            h('div', { className: 'ow-note', style: { margin: '6px 0 8px' } },
              '点「在对话里打开」会切到对话页，把下面这段放进输入框 —— 不会自动发送，你看过再按发送。'),
            h('textarea', {
              className: 'ow-area',
              style: { minHeight: 168 },
              value: handoff.text,
              onChange: (event) => setHandoff({ ...handoff, text: event.target.value, note: '' }),
            }),
            h('div', { className: 'ow-row', style: { marginTop: 10 } },
              h(Btn, { kind: 'primary', tiny: true, onClick: confirmHandoff }, '在对话里打开'),
              h(Btn, {
                tiny: true,
                onClick: () => copyText(handoff.text)
                  .then(() => setHandoff({ ...handoff, note: '已复制。' }))
                  .catch(() => setHandoff({ ...handoff, note: '复制失败，手动选一下文本。' })),
              }, '复制'),
              h(Btn, { tiny: true, kind: 'ghost', onClick: () => setHandoff(null) }, '取消'),
              h('div', { className: 'ow-spacer' }),
              handoff.note ? h('span', { className: 'ow-note' }, handoff.note) : null,
            ),
          )
          : null,

        issues.length > 0
          ? h('div', null,
            h('div', { className: 'ow-h2' }, `问题清单（${issues.length}）`),
            issues.map((issue, index) => h('div', {
              key: `${issue.host.id}-${issue.key}-${index}`,
              className: 'ow-issue',
              style: { borderLeftColor: (LEVEL[issue.level] ?? LEVEL.info).color },
            },
              h('div', { className: 'ow-issue-head' },
                h(Dot, { level: issue.level }),
                h('b', null, issue.title),
                h('span', { className: 'ow-note' }, issue.host.name || issue.host.host),
                h('div', { className: 'ow-spacer' }),
                h(Btn, {
                  tiny: true,
                  onClick: () => startHandoff(issue),
                  title: '把这条问题和实测数据带到对话里，和 AI 一起处理',
                }, '处理'),
              ),
              h('p', null, issue.detail),
              h('p', { className: 'ow-fix' }, `怎么处理：${issue.fix}`),
            )),
          )
          : null,

        rows.length === 0
          ? h('div', { className: 'ow-empty' }, h('b', null, '还没有主机'), '先去「主机」加一台。')
          : issues.length === 0 && rows.some((row) => row.record)
            ? h('div', { className: 'ow-empty' }, h('b', null, '没有发现问题'), '所有已巡检主机都在阈值内。')
            : null,

        rows.length > 0
          ? h('div', null,
            h('div', { className: 'ow-h2' }, '逐台明细'),
            h('div', { className: 'ow-card', style: { padding: 0, overflowX: 'auto' } },
              h('table', { className: 'ow-table' },
                h('thead', null, h('tr', null,
                  h('th', null, '主机'), h('th', null, 'CPU'), h('th', null, '内存可用'), h('th', null, '磁盘'),
                  h('th', null, 'inode'), h('th', null, '负载/核'), h('th', null, '失败服务'), h('th', null, '结论'),
                )),
                h('tbody', null, rows.map(({ host, record, level }) => {
                  const snap = record?.snapshot
                  return h('tr', { key: host.id },
                    h('td', null, h('div', { className: 'ow-row', style: { gap: 6 } }, h(Dot, { level }), h('span', null, host.name || host.host))),
                    h('td', { className: 'num' }, snap ? fmtPct(snap.cpu.pct) : '-'),
                    h('td', { className: 'num' }, snap ? fmtPct(snap.mem.availPct) : '-'),
                    h('td', { className: 'num ow-diskscell' },
                      snap?.disks?.length
                        ? snap.disks.filter((item) => !isQuietTiny(item, state?.thresholds)).slice(0, 3).map((item) => h('div', { key: `${item.fs}|${item.mount}` },
                          h('span', null, `${item.mount === '/' ? '根' : shortMount(item.mount)} ${fmtPct(item.usedPct)}`),
                          h('em', null, fmtDiskPair(item)),
                        ))
                        : '-',
                    ),
                    h('td', { className: 'num' }, snap?.inodes?.[0] ? fmtPct(snap.inodes[0].usedPct) : '-'),
                    h('td', { className: 'num' }, snap ? `${snap.load.l1.toFixed(2)}/${snap.host.cores}` : '-'),
                    h('td', { className: 'num' }, snap ? snap.failedUnits.length : '-'),
                    h('td', null, verdictText(record)),
                  )
                })),
              )),
          )
          : null,

        results.length > 0
          ? h('div', { className: 'ow-note', style: { marginTop: 10 } }, `本次跑了 ${results.length} 台，${results.filter((r) => r.ok).length} 台成功。`)
          : null,

        trendRows.length > 0
          ? (() => {
            const active = trendRows.find((row) => row.host.id === trendHostId) ?? trendRows[0]
            const samples = active.points
            return h('div', { style: { marginTop: 4 } },
              h('div', { className: 'ow-h2' }, '最近走势'),
              h('div', { className: 'ow-note', style: { marginBottom: 6 } },
                `取最近 ${TREND_POINTS} 次巡检的「内存可用」：往上走是松快，往下走是变紧。纵轴按这台机器自己的波动范围自适应（跨度至少 ${TREND_MIN_SPAN} 个百分点），所以别拿两台机器的斜率直接比大小 —— 看数字。鼠标滑过曲线看某个时间点的具体数值。`),
              h('div', { className: 'ow-trend-tabs' }, trendRows.map((row) => h(Btn, {
                key: row.host.id,
                tiny: true,
                kind: row.host.id === active.host.id ? 'primary' : undefined,
                onClick: () => setTrendHostId(row.host.id),
              }, h(Dot, { level: levelOf((lastInspect ?? {})[row.host.id]) }), ` ${row.host.name || row.host.host}`))),
              h('div', { className: 'ow-card', style: { padding: '10px 12px' } },
                h('div', { className: 'ow-row', style: { gap: 8, marginBottom: 2 } },
                  h('b', null, active.host.name || active.host.host),
                  h('div', { className: 'ow-spacer' }),
                  h('span', { className: 'ow-note' }, `${samples.length} 次采样 · ${fmtClock(samples[0].at)} → ${fmtClock(samples[samples.length - 1].at)}`),
                ),
                h(TrendChart, { points: samples, rules, hostName: active.host.name || active.host.host }),
                h('div', { className: 'ow-row', style: { marginTop: 6, gap: 12, flexWrap: 'wrap' } },
                  h('span', { className: 'ow-note' }, `内存可用最低 ${active.memMin ? `${active.memMin.value.toFixed(1)}%（${fmtHm(active.memMin.at)}）` : '-'}`),
                  h('span', { className: 'ow-note' }, `磁盘最高 ${active.diskMax ? `${Math.round(active.diskMax.value)}%` : '-'}`),
                  h('div', { className: 'ow-spacer' }),
                  h('span', { className: 'ow-note' }, '纵轴是自适应范围，不是 0–100%'),
                ),
              ),
            )
          })()
          : null,
      )
    }

    /* -------------------------------------------------------------- 排障 */

    function DiagView({ state, hostId, setHostId, output, running, onRun }) {
      const hosts = state?.hosts ?? []
      const actions = state?.diagnostics ?? []
      const current = hosts.find((host) => host.id === hostId) ?? hosts[0]

      if (hosts.length === 0) {
        return h('div', { className: 'ow-empty' }, h('b', null, '先添加主机'), '有机器才能排障。')
      }

      return h('div', null,
        h('div', { className: 'ow-row', style: { marginBottom: 12 } },
          h('span', { className: 'ow-note' }, '要查哪台'),
          h('select', {
            className: 'ow-select',
            style: { width: 200 },
            value: current?.id ?? '',
            onChange: (event) => setHostId(event.target.value),
          }, hosts.map((host) => h('option', { key: host.id, value: host.id }, `${host.name || host.host}（${host.host}）`))),
        ),
        h('div', { className: 'ow-h2' }, '出事了，按这个顺序点'),
        h('div', { className: 'ow-actions' },
          actions.map((action) => h(Btn, {
            key: action.id,
            tiny: true,
            disabled: running || !current,
            title: action.hint,
            onClick: () => onRun(current.id, action.id),
          }, running && output?.action?.id === action.id ? `${action.label}…` : action.label)),
        ),
        h('div', { className: 'ow-note', style: { marginTop: 10 } },
          '查不出东西的时候记住顺序：① 服务起没起来 → ② 端口通不通 → ③ 日志里第一行报错 → ④ 磁盘是不是满了 → ⑤ 时间对不对。'),
        output
          ? h('div', { style: { marginTop: 16 } },
            h('div', { className: 'ow-row', style: { marginBottom: 6 } },
              h('b', null, output.action?.label ?? '结果'),
              h('span', { className: 'ow-pill' }, output.ok ? h(Dot, { level: 'ok' }) : h(Dot, { level: 'crit' }), output.ok ? '命令执行完成' : '命令返回非 0'),
              h('span', { className: 'ow-note' }, `${output.durationMs} ms · ${output.via === 'ssh2' ? 'ssh2' : '系统 ssh'}`),
              h('div', { className: 'ow-spacer' }),
              h(Btn, { tiny: true, kind: 'ghost', onClick: () => copyText(output.output || '') }, '复制'),
            ),
            h('div', { className: 'ow-note', style: { marginBottom: 6 } }, `看点：${output.action?.look ?? ''}`),
            h('pre', { className: 'ow-pre' }, output.output || '（没有任何输出）'),
          )
          : null,
      )
    }

    /* -------------------------------------------------------------- 日报 */

    // 导出下拉：写清楚「拿去干什么」，比只写后缀有用
    const EXPORT_TARGETS = [
      { format: 'md', label: 'Markdown（.md）', hint: '原始文本，贴群里、进 Git 都方便' },
      { format: 'html', label: '网页（.html）', hint: '单文件，双击就能看，也能打印成 PDF' },
    ]

    /** 行内节点 → React 子节点。纯文本直接给字符串，不额外套一层。 */
    function inlineNodes(nodes, prefix = '') {
      return (nodes ?? []).map((node, index) => {
        const key = `${prefix}${index}`
        if (node.type === 'strong') return h('strong', { key }, node.text)
        if (node.type === 'code') return h('code', { key }, node.text)
        if (node.type === 'link') {
          return h('a', { key, href: node.href, target: '_blank', rel: 'noreferrer noopener' }, node.text)
        }
        return node.text
      })
    }

    function DocTable({ block }) {
      return h('div', { className: 'ow-doc-table' },
        h('table', null,
          h('thead', null,
            h('tr', null,
              block.head.map((cell, index) => h('th', { key: index }, inlineNodes(cell, `h${index}-`))),
            ),
          ),
          h('tbody', null,
            block.rows.map((row, rowIndex) => h('tr', { key: rowIndex },
              row.map((cell, cellIndex) => h('td', { key: cellIndex }, inlineNodes(cell, `r${rowIndex}c${cellIndex}-`))),
            )),
          ),
        ),
      )
    }

    function DocList({ block }) {
      const tag = block.ordered ? 'ol' : 'ul'
      return h(tag, null, block.items.map((item, index) => h('li', { key: index },
        inlineNodes(item.inline, `i${index}-`),
        (item.children ?? []).map((child, childIndex) => h(DocList, { key: `c${childIndex}`, block: child })),
      )))
    }

    function DocBlock({ block }) {
      if (block.type === 'heading') {
        return h(`h${block.level}`, block.tone ? { 'data-tone': block.tone } : null, inlineNodes(block.inline))
      }
      if (block.type === 'paragraph') {
        return h('p', block.lead ? { className: 'ow-doc-lead' } : null, inlineNodes(block.inline))
      }
      if (block.type === 'quote') return h('blockquote', null, inlineNodes(block.inline))
      if (block.type === 'list') return h(DocList, { block })
      if (block.type === 'table') return h(DocTable, { block })
      if (block.type === 'code') return h('pre', null, h('code', null, block.text))
      if (block.type === 'rule') return h('hr')
      return null
    }

    /** 导出按钮 + 下拉菜单（点外面或按 Esc 收起）。 */
    function ExportButton({ doc }) {
      const [open, setOpen] = useState(false)
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const box = useRef(null)

      useEffect(() => {
        if (!open) return undefined
        const onDown = (event) => {
          if (box.current && !box.current.contains(event.target)) setOpen(false)
        }
        const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
        document.addEventListener('mousedown', onDown, true)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('mousedown', onDown, true)
          document.removeEventListener('keydown', onKey)
        }
      }, [open])

      const pick = (format) => {
        setOpen(false)
        if (!doc || busy) return
        setBusy(format)
        setError('')
        // 渲染留在宿主侧：导出的 HTML 和屏幕上看到的是同一份排版
        api('/ops/api/report/export', { format, markdown: doc.markdown, title: doc.title })
          .then((data) => {
            saveFile(data.filename, data.content, data.mime)
            setBusy('')
          })
          .catch((problem) => {
            setError(problem.message)
            setBusy('')
            reportError('report.export', problem, { format })
          })
      }

      return h('div', { className: 'ow-export', ref: box },
        h('button', {
          type: 'button',
          className: 'ow-btn ow-export-btn',
          disabled: !doc || Boolean(busy),
          'aria-haspopup': 'menu',
          'aria-expanded': open ? 'true' : 'false',
          onClick: () => setOpen((value) => !value),
        },
          h('span', null, busy ? '导出中…' : '导出'),
          h('span', { className: 'ow-caret' }, '▾'),
        ),
        open
          ? h('div', { className: 'ow-menu', role: 'menu' },
            EXPORT_TARGETS.map((target) => h('button', {
              key: target.format,
              type: 'button',
              role: 'menuitem',
              className: 'ow-menu-item',
              onClick: () => pick(target.format),
            },
              h('b', null, target.label),
              h('span', { className: 'ow-note' }, target.hint),
            )),
          )
          : null,
        error ? h('div', { className: 'ow-menu-err' }, error) : null,
      )
    }

    /** 一份日报的预览。blocks 由宿主给（和导出用的是同一棵），这里只负责画。 */
    function DocView({ doc }) {
      const blocks = doc.blocks ?? []
      // 一级标题已经在卡片头上显示了，正文里不再重复一遍
      const rest = blocks.length > 0 && blocks[0].type === 'heading' && blocks[0].level === 1
        ? blocks.slice(1)
        : blocks
      return h('div', { className: 'ow-doc-wrap' },
        h('div', { className: 'ow-doc-head' },
          h('b', null, doc.title || '运维日报'),
          doc.kind === 'live' ? h('span', { className: 'ow-pill' }, '本次生成') : null,
          h('div', { className: 'ow-spacer' }),
          doc.kind === 'file' && doc.file
            ? h('span', { className: 'ow-note ow-doc-path', title: doc.file }, doc.file)
            : null,
        ),
        rest.length > 0
          ? h('div', { className: 'ow-doc' }, rest.map((block, index) => h(DocBlock, { key: index, block })))
          : h('pre', { className: 'ow-pre' }, doc.markdown),
      )
    }

    function ReportView({ state, report, running, onRun }) {
      const hosts = state?.hosts ?? []
      const [stored, setStored] = useState({ items: [], dir: '' })
      const [opened, setOpened] = useState(null)
      const [opening, setOpening] = useState('')
      const [error, setError] = useState('')
      const [copied, setCopied] = useState(false)

      const loadStored = useCallback(() => {
        api('/ops/api/reports')
          .then((data) => setStored(data))
          .catch((problem) => reportError('reports.list', problem))
      }, [])

      useEffect(() => { loadStored() }, [loadStored])

      const openStored = useCallback((date) => {
        setOpening(date)
        setError('')
        api('/ops/api/report/file', { date })
          .then((data) => {
            setOpened(data)
            setOpening('')
          })
          .catch((problem) => {
            setOpening('')
            setError(`读不到 ${date} 的日报：${problem.message}`)
            reportError('reports.open', problem, { date })
          })
      }, [])

      // 新生成的那份优先：把历史那份放掉，不然点过日期后会一直停在旧日报上
      useEffect(() => {
        if (report) setOpened(null)
      }, [report])

      // 一进页面先自动打开最新一份，省得还得先点一下日期才看得到东西
      const autoOpened = useRef(false)
      useEffect(() => {
        if (autoOpened.current || report || stored.items.length === 0) return
        autoOpened.current = true
        openStored(stored.items[0].date)
      }, [stored, report, openStored])

      const doc = useMemo(() => {
        if (opened) return { ...opened, kind: 'file' }
        if (report) {
          return { kind: 'live', title: report.title, markdown: report.markdown, blocks: report.blocks ?? [] }
        }
        return null
      }, [opened, report])

      const copyDoc = () => {
        if (!doc) return
        copyText(doc.markdown)
          .then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1600)
          })
          .catch((problem) => reportError('report.copy', problem))
      }

      return h('div', null,
        h('div', { className: 'ow-report-bar' },
          h(Btn, { kind: 'primary', onClick: onRun, disabled: running || hosts.length === 0 },
            running ? '生成中…' : '生成今天的日报'),
          doc ? h(Btn, { tiny: true, kind: 'ghost', onClick: copyDoc }, copied ? '已复制' : '复制全文') : null,
          h('span', { className: 'ow-note ow-report-hint' }, '日报只用最后一次巡检的数据；想更准就先巡检一次'),
          h(ExportButton, { doc }),
        ),

        h('div', { className: 'ow-dates' },
          h('span', { className: 'ow-dates-label' }, '历史日报'),
          stored.items.length === 0
            ? h('span', { className: 'ow-note' },
              '还没有自动生成的日报 —— 到「巡检 → 定时任务」里设的时间会自动生成，也可以点上面「生成今天的日报」立刻出一份。')
            : stored.items.slice(0, 14).map((item) => h(Btn, {
              key: item.date,
              tiny: true,
              kind: opened?.date === item.date ? 'primary' : 'ghost',
              disabled: opening === item.date,
              onClick: () => openStored(item.date),
            }, item.date)),
        ),

        error ? h('div', { className: 'ow-banner', style: { color: '#d1453b' } }, error) : null,

        doc
          ? h(DocView, { doc })
          : h('div', { className: 'ow-empty' },
            h('b', null, '日报长什么样？'),
            h('div', null, '一句话结论 + 一张总览表 + 需要处理的问题（含怎么处理）+ 明天先做三件事。'),
            h('div', { className: 'ow-note', style: { marginTop: 8 } },
              '适合直接贴到群里，也能导出成 .md / .html 存下来当交接记录。'),
          ),
      )
    }

    /* -------------------------------------------------------------- 指南 */

    const GUIDE = [
      {
        title: '先记住：运维每天只有三件事',
        items: [
          ['看', '机器还活着吗？资源够不够用？—— 对应本页「总览」。'],
          ['查', '有没有东西已经在报错了，只是没人发现？—— 对应「巡检」和「排障」。'],
          ['备', '真出事能不能恢复？—— 备份是不是真能还原、改动能不能回滚。'],
        ],
      },
      {
        title: '按周期该做什么',
        items: [
          ['每天 3 分钟', '点一次巡检，把红色项处理掉；看一眼磁盘使用率的走势。'],
          ['每周一次', '验证一次备份能恢复（不是「看备份任务成功」，是真去还原一个文件）；看日志有没有暴涨；确认没有多余的定时任务。'],
          ['每月一次', '系统与依赖的安全更新；清理不再用的账号和密钥；复核对外开的端口；估算磁盘还能撑多久。'],
          ['出事的时候', '先止血（重启/回滚/扩容），再定位（服务→端口→日志→磁盘→时间），最后写一句「改了什么」，下次别再踩。'],
        ],
      },
      {
        title: '新手最容易忽略的 5 件事',
        items: [
          ['磁盘满', '最常见的「网站突然挂了」。日志和数据库增长是最主要来源。'],
          ['备份没人验证', '备份任务成功 ≠ 能恢复。没验证过的备份等于没有备份。'],
          ['失败的服务不会自己喊', 'systemd 里 failed 的服务只会在你查的时候才知道，所以要每天看一眼。'],
          ['时间不同步', '证书报错、日志时间错乱、集群认证失败，很多怪问题根源是时钟。'],
          ['端口开太多', '对外只放行真正要用的端口，其余在安全组/防火墙里关掉。'],
        ],
      },
    ]

    function Guide() {
      return h('div', null,
        h('div', { className: 'ow-banner' },
          h('div', null,
            h('b', null, '这个工作台是只读的'),
            h('div', { className: 'ow-note' }, '它只采数据、不下命令。你要改机器，还是自己去终端 —— 这样不会因为点错一个按钮把生产搞挂。等你看熟了，我们再加「确认后执行」。'),
          ),
        ),
        h('div', { className: 'ow-guide' },
          GUIDE.map((section) => h('div', { key: section.title, className: 'ow-card' },
            h('div', { className: 'ow-card-h' }, h('b', null, section.title)),
            h('ul', null, section.items.map(([key, text]) => h('li', { key }, h('b', null, `${key}：`), text))),
          )),
        ),
        h('div', { className: 'ow-h2' }, '遇到具体报错时，从这里查'),
        h('div', { className: 'ow-card' },
          h('ul', null,
            h('li', null, h('b', null, '502 / 网站打不开'), '：先看服务在不在（排障「失败的服务」），再看端口通不通。'),
            h('li', null, h('b', null, 'SSH 连不上'), '：看安全组是否放行 22、密码是否被改、机器是否还在运行。'),
            h('li', null, h('b', null, '机器很卡'), '：看「谁在吃 CPU/内存」，再看磁盘 IO 是否打满。'),
            h('li', null, h('b', null, '磁盘满'), '：先删日志和大文件止血，再查是谁在写。'),
          ),
        ),
      )
    }

    /* -------------------------------------------------------------- 外壳 */

    const TABS = [
      ['overview', '总览'],
      ['hosts', '主机'],
      ['inspect', '巡检'],
      ['diag', '排障'],
      ['report', '日报'],
      ['guide', '该做什么'],
    ]

    // 轮询间隔；这个值只影响「自动巡检结果多久出现在页面上」，不影响巡检本身
    const POLL_MS = 20000

    // 这份 bundle 是什么时候被浏览器执行的。热更新生效会重新执行整份文件，
    // 所以这个时间一跳，就说明页面换上了新代码——不用猜，也不用重启 DSH。
    const LOADED_AT = Date.now()

    function clockSec(ts) {
      const date = new Date(ts)
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
    }

    // 绝对时间：今天的只给时分秒，隔天的带上月日。相对时间会「冻住」——
    // 轮询只在巡检结果变了才重画，所以顶部以绝对时间为准，相对时间只作辅助。
    function stampOf(ts, now = Date.now()) {
      if (!ts) return ''
      const date = new Date(ts)
      const ref = new Date(now)
      const sameDay = date.getFullYear() === ref.getFullYear() && date.getMonth() === ref.getMonth() && date.getDate() === ref.getDate()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return sameDay ? clockSec(ts) : `${month}-${day} ${clockSec(ts)}`
    }

    /** 「17:11:16（13 分钟前）」：绝对时间为主、相对时间为辅，一起随时钟走（跨天时也会补上月日）。 */
    function InspectedAt({ at }) {
      const now = useNow()
      return at ? `${stampOf(at, now)}（${fmtAgo(at, now)}）` : '还没巡检过'
    }

    // 桌面端没有 F5（菜单里的「重新加载页面」只在开发版出现），所以自己给一个入口。
    // location.reload 会让页面重新走一遍引导，拿到最新的插件版本号。
    function reloadPage() {
      try {
        if (typeof location !== 'undefined' && typeof location.reload === 'function') location.reload()
      } catch (error) {
        reportError('page.reload', error)
      }
    }

    // 一次 state 里「值得重画」的部分：主机增删、每台最近一次巡检的时间与级别、
    // 定时器的上次自动巡检时间、日报最近生成日期。其它字段（阈值草稿等）变了也重画，但这里不做区分。
    function signatureOf(next) {
      if (!next) return ''
      const hosts = (next.hosts ?? []).map((host) => host.id).join(',')
      const inspects = Object.keys(next.lastInspect ?? {})
        .sort()
        .map((id) => {
          const record = next.lastInspect[id] ?? {}
          return `${id}@${record.at ?? 0}/${record.level ?? ''}`
        })
        .join(',')
      const sched = next.scheduler ?? {}
      return [
        hosts,
        inspects,
        sched.auto?.lastAutoAt ?? 0,
        sched.daily?.lastReportDate ?? '',
      ].join('|')
    }

    function Main() {
      const [state, setState] = useState(null)
      const [tab, setTab] = useState('overview')
      const [error, setError] = useState('')
      const [busyIds, setBusyIds] = useState(() => new Set())
      const [results, setResults] = useState([])
      const [diagHost, setDiagHost] = useState('')
      const [diagOut, setDiagOut] = useState(null)
      const [diagBusy, setDiagBusy] = useState(false)
      const [report, setReport] = useState(null)
      const [reportBusy, setReportBusy] = useState(false)
      const [testing, setTesting] = useState({})

      // 自动巡检在宿主侧跑，页面不主动问就永远是旧数据 —— 所以这里轮询。
      const diagHostRef = useRef('')
      diagHostRef.current = diagHost
      const seenRef = useRef('')
      const busyRef = useRef(busyIds)
      busyRef.current = busyIds

      const load = useCallback(async () => {
        try {
          const next = await api('/ops/api/state')
          setState(next)
          seenRef.current = signatureOf(next)
          setError('')
          if (!diagHostRef.current && next.hosts?.[0]) setDiagHost(next.hosts[0].id)
        } catch (err) {
          setError(String(err?.message ?? err))
          reportError('load.failed', err, { path: '/ops/api/state' })
        }
      }, [])

      useEffect(() => { ensureStyle() }, [])
      useEffect(() => { load() }, [load])

      // 每 20 秒问一次；只有「巡检结果/主机列表/日报日期」真变了才重画，避免无意义闪烁。
      // 标签页切走时不问，切回来立刻问一次。
      useEffect(() => {
        let stopped = false
        const poll = async () => {
          if (stopped) return
          if (busyRef.current.size > 0) return
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          try {
            const next = await api('/ops/api/state')
            const signature = signatureOf(next)
            if (signature === seenRef.current) return
            seenRef.current = signature
            setState(next)
            setError('')
          } catch (err) {
            // 轮询失败不打扰用户：静默，下一次还会再试
          }
        }
        const onBack = () => { poll() }
        const id = setInterval(poll, POLL_MS)
        // 浏览器里 id 是数字，没有 unref；无头环境（离线测试）里是 Timeout，要 unref 才不会让进程挂住
        if (id && typeof id.unref === 'function') id.unref()
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
          document.addEventListener('visibilitychange', onBack)
        }
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
          window.addEventListener('focus', onBack)
        }
        return () => {
          stopped = true
          clearInterval(id)
          if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
            document.removeEventListener('visibilitychange', onBack)
          }
          if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
            window.removeEventListener('focus', onBack)
          }
        }
      }, [])

      const inspectOne = async (id) => {
        setBusyIds((prev) => new Set([...prev, id]))
        try {
          const data = await api('/ops/api/inspect', { ids: [id] })
          setResults(data.results ?? [])
          setState((prev) => ({ ...prev, lastInspect: data.lastInspect }))
        } catch (err) {
          setError(String(err?.message ?? err))
        } finally {
          setBusyIds((prev) => { const next = new Set(prev); next.delete(id); return next })
        }
      }

      const inspectAll = async () => {
        const ids = (state?.hosts ?? []).map((host) => host.id)
        setBusyIds(new Set(ids))
        setTab('inspect')
        try {
          const data = await api('/ops/api/inspect', {})
          setResults(data.results ?? [])
          setState((prev) => ({ ...prev, lastInspect: data.lastInspect }))
        } catch (err) {
          setError(String(err?.message ?? err))
        } finally {
          setBusyIds(new Set())
        }
      }

      const saveHost = async (draft) => {
        const data = await api('/ops/api/host/save', { host: draft })
        setState((prev) => ({ ...prev, hosts: data.hosts }))
      }

      const deleteHost = async (host) => {
        if (!window.confirm(`删除主机「${host.name || host.host}」？只是从列表移除，不会动服务器。`)) return
        const data = await api('/ops/api/host/delete', { id: host.id })
        setState((prev) => ({ ...prev, hosts: data.hosts }))
      }

      const testHost = async (id) => {
        setTesting((prev) => ({ ...prev, [id]: { pending: true } }))
        try {
          const data = await api('/ops/api/host/test', { id })
          setTesting((prev) => ({ ...prev, [id]: data }))
        } catch (err) {
          setTesting((prev) => ({ ...prev, [id]: { ok: false, error: String(err?.message ?? err) } }))
        }
      }

      const runDiag = async (id, action) => {
        setDiagBusy(true)
        setDiagOut({ action: { id, label: '执行中…' }, output: '', ok: true, durationMs: 0 })
        try {
          const data = await api('/ops/api/diag', { id, action })
          setDiagOut(data)
        } catch (err) {
          setDiagOut({ action: { id, label: '执行失败' }, output: String(err?.message ?? err), ok: false, durationMs: 0 })
        } finally {
          setDiagBusy(false)
        }
      }

      const runReport = async () => {
        setReportBusy(true)
        try {
          const data = await api('/ops/api/report', {})
          setReport(data)
        } catch (err) {
          setError(String(err?.message ?? err))
        } finally {
          setReportBusy(false)
        }
      }

      const saveThresholds = async (thresholds) => {
        const data = await api('/ops/api/settings', { thresholds })
        setState((prev) => ({ ...prev, settings: data.settings, thresholds: data.thresholds, scheduler: data.scheduler ?? prev.scheduler }))
      }

      /** 定时巡检 / 日报时间的开关，改完立刻生效（宿主侧下一次心跳就按新设置走）。 */
      const saveSchedule = async (patch) => {
        const data = await api('/ops/api/settings', { settings: patch })
        setState((prev) => ({ ...prev, settings: data.settings, scheduler: data.scheduler ?? prev.scheduler }))
      }

      const openDiag = (id) => { setDiagHost(id); setTab('diag'); setDiagOut(null) }

      if (!state) {
        return h('div', { className: 'ow-root' },
          h('div', { className: 'ow-head' }, h('div', { className: 'ow-title' }, h('h1', null, '运维工作台'))),
          h('div', { className: 'ow-body' },
            error
              ? h('div', { className: 'ow-empty' }, h('b', null, '页面没连上后台'), h('div', null, error), h('div', { className: 'ow-note', style: { marginTop: 10 } }, '试试刷新页面；如果一直这样，说明插件宿主半边没起来。'))
              : h('div', { className: 'ow-empty' }, h('span', { className: 'ow-spin' }), ' 正在读本机配置…'),
          ),
        )
      }

      const lastAt = Object.values(state.lastInspect ?? {}).map((record) => record.at).filter(Boolean).sort((a, b) => b - a)[0]
      const critCount = Object.values(state.lastInspect ?? {}).filter((record) => record.level === 'crit').length
      const sched = state.scheduler ?? {}
      const auto = sched.auto ?? { enabled: false, everyMinutes: 15 }
      const daily = sched.daily ?? { enabled: false, hour: 9, minute: 0 }
      const autoText = auto.enabled
        ? h('span', null, `自动巡检：每 ${auto.everyMinutes} 分钟`,
          auto.nextAutoAt ? h(In, { at: auto.nextAutoAt, lead: '（下次 ', tail: '）' }) : null)
        : '自动巡检：已关（只在你点的时候跑）'
      const dailyText = daily.enabled
        ? `日报：每天 ${String(daily.hour).padStart(2, '0')}:${String(daily.minute).padStart(2, '0')}${sched.daily?.lastReportDate ? `（今天已生成）` : ''}`
        : '日报：手动生成'

      return h('div', { className: 'ow-root' },
        h('div', { className: 'ow-head' },
          h('div', { className: 'ow-title' },
            h('h1', null, '运维工作台'),
            state.hosts.length > 0 ? h('span', { className: 'ow-pill' }, h(Dot, { level: critCount > 0 ? 'crit' : 'ok' }), `${state.hosts.length} 台 · ${critCount > 0 ? `${critCount} 台要处理` : '暂无紧急'}`) : null,
            h('div', { className: 'ow-spacer' }),
            h(Btn, { tiny: true, kind: 'ghost', onClick: load }, '刷新'),
            h(Btn, {
              tiny: true,
              kind: 'ghost',
              onClick: reloadPage,
              title: '重新加载整个页面：界面代码没换上来时点这里（桌面端没有 F5）',
            }, '重载页面'),
          ),
          h('div', { className: 'ow-sub' },
            h('span', { title: lastAt ? new Date(lastAt).toLocaleString() : '还没有任何一台巡检过' },
              '上次巡检 ', h(InspectedAt, { at: lastAt })),
            h('span', null, autoText),
            h('span', null, dailyText),
            h('span', null, state.transport?.ssh2 ? `SSH ${state.transport.version ?? 'ssh2'}` : '未装 ssh2（密码登录不可用）'),
            h('span', { title: '插件代码每次改完会自己换上来；这行时间变了就说明页面已经是新代码' }, `页面代码 ${clockSec(LOADED_AT)} 载入`),
          ),
          error ? h('div', { className: 'ow-note', style: { color: LEVEL.crit.color, marginTop: 6 } }, error) : null,
        ),
        h('div', { className: 'ow-tabs' },
          TABS.map(([key, label]) => h('button', {
            key,
            type: 'button',
            className: 'ow-tab',
            'data-on': tab === key ? '1' : '0',
            onClick: () => setTab(key),
          }, label,
            key === 'hosts' ? h('span', { className: 'ow-count' }, state.hosts.length) : null,
            key === 'inspect' && results.length > 0 ? h('span', { className: 'ow-count' }, results.length) : null,
          )),
        ),
        h('div', { className: 'ow-body' },
          tab === 'overview' ? h(Overview, {
            state,
            busyIds,
            onInspectAll: inspectAll,
            onInspectOne: inspectOne,
            goTab: setTab,
            goDiag: openDiag,
          }) : null,
          tab === 'hosts' ? h(Hosts, { state, onSave: saveHost, onDelete: deleteHost, onTest: testHost, testing }) : null,
          tab === 'inspect' ? h(InspectView, {
            state, results, running: busyIds.size > 0, onRun: inspectAll, onSaveThresholds: saveThresholds,
            onSchedule: saveSchedule,
          }) : null,
          tab === 'diag' ? h(DiagView, {
            state, hostId: diagHost, setHostId: setDiagHost, output: diagOut, running: diagBusy, onRun: runDiag,
          }) : null,
          tab === 'report' ? h(ReportView, { state, report, running: reportBusy, onRun: runReport }) : null,
          tab === 'guide' ? h(Guide) : null,
        ),
      )
    }

    /* -------------------------------------------------------- 兜底边界 */

    /**
     * 渲染期异常在 React 里会直接吃掉整棵子树 —— 页面就变成「有入口、点开全白」。
     * 这里兜住它：把堆栈画在页面上，同时写回宿主日志。
     */
    const Bottleneck = typeof React.Component === 'function'
      ? class Bottleneck extends React.Component {
        constructor(props) {
          super(props)
          this.state = { error: null }
        }

        static getDerivedStateFromError(error) {
          return { error }
        }

        componentDidCatch(error, info) {
          reportError('render.error', error, { componentStack: info?.componentStack })
        }

        render() {
          if (!this.state.error) return this.props.children
          const error = this.state.error
          return h('div', { style: { padding: '18px 20px', fontSize: 13, lineHeight: 1.7 } },
            h('div', { style: { fontWeight: 600, marginBottom: 6 } }, '运维工作台渲染失败'),
            h('div', { style: { color: 'var(--ow-mute, rgba(127,127,127,.9))', marginBottom: 10 } },
              '把下面这段发给我就能定位；它也已经写进本机日志 ops-workbench/client.log。'),
            h('pre', {
              style: {
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 11.5,
                background: 'rgba(127,127,127,.08)', border: '1px solid rgba(127,127,127,.2)',
                borderRadius: 8, padding: 10, margin: 0, maxHeight: 320, overflow: 'auto',
              },
            }, String(error?.stack || error?.message || error)),
          )
        }
      }
      : null

    function MainSafe(props) {
      if (!Bottleneck) return h(Main, props)
      return h(Bottleneck, null, h(Main, props))
    }

    /* -------------------------------------------------------- 侧栏图标 */
    function SidebarIcon() {
      return h('span', { className: 'ow-sb', title: '运维工作台' },
        h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
          h('rect', { x: 1.75, y: 1.75, width: 12.5, height: 5, rx: 1.4, stroke: 'currentColor', strokeWidth: 1.3 }),
          h('rect', { x: 1.75, y: 9.25, width: 12.5, height: 5, rx: 1.4, stroke: 'currentColor', strokeWidth: 1.3 }),
          h('circle', { cx: 4.6, cy: 4.25, r: 0.85, fill: 'currentColor' }),
          h('circle', { cx: 4.6, cy: 11.75, r: 0.85, fill: 'currentColor' }),
        ),
      )
    }

    /* ------------------------------------------------------------- apply */

    return {
      inject: ['slots'],
      apply(ctx) {
        try {
        ensureStyle()
        HOST_CTX = ctx

        // 全局兜底：渲染期异常、Promise 未捕获，都留一条痕迹再谈修复
        // 注意：兜底本身绝不能挡住注册流程，所以整体包一层 try
        try {
          if (!globalThis.__DSH_OPS_HOOKED__ && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            globalThis.__DSH_OPS_HOOKED__ = true
            window.addEventListener('error', (event) => {
              reportError('window.error', event.error || event.message, {
                source: event.filename, line: event.lineno, column: event.colno,
              })
            })
            window.addEventListener('unhandledrejection', (event) => {
              reportError('unhandledrejection', event.reason)
            })
          }
        } catch { /* 钩子装不上不影响面板本身 */ }

        const occupy = (options, component) => {
          try {
            return ctx.slots.register(options, component)
          } catch (error) {
            console.warn('[ops-workbench] slot register failed:', options?.name, error)
            return () => {}
          }
        }

        const disposers = [
          ctx.slots.inject('sidebar.panellist', () => occupy({
            name: 'sidebar.panellist',
            id: 'ops',
            order: 30,
            label: () => '运维工作台',
          }, SidebarIcon)),
          ctx.slots.inject('main', () => occupy({
            name: 'main',
            key: 'ops',
          }, MainSafe)),
        ]

        // 离线测试用的把手：不装插件也能验证「问题 → 求助稿 → 送进对话」这条链路
        try {
          globalThis.__DSH_OPS_TEST__ = {
            buildHandoff, openHandoffInChat, metricLine, isQuietTiny, diskLevelOf, signatureOf, POLL_MS,
            smoothPath, trendPoints, trendDomain, hoverIndexAt, xTickIndexes, TrendChart,
            // 相对时间 + 那只共享时钟：验证「数据没变，文案也会自己走」
            fmtAgo, fmtIn, stampOf, retryHint, Ago, In, RetryHint, InspectedAt,
            // 日报预览：验证「页面上画的」和「导出文件里的」是同一份
            DocView, DocBlock, ReportView, EXPORT_TARGETS,
            clock: {
              ms: CLOCK_MS,
              now: () => clockNow,
              beat: clockBeat,
              onBack: clockOnBack,
              size: () => clockSubs.size,
              subscribe: (fn) => { clockSubs.add(fn); return () => clockSubs.delete(fn) },
            },
          }
        } catch { /* 没有 globalThis 就算了 */ }

        return () => {
          for (const dispose of disposers) {
            try { dispose?.() } catch { /* 忽略卸载期异常 */ }
          }
        }
        } catch (error) {
          // 整个请求都失败了也要有痕迹：否则侧栏有按钮、点开全白
          console.error('[ops-workbench] apply failed:', error)
          reportError('apply.failed', error)
          return () => {}
        }
      },
    }
  },
})
