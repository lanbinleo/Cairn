// ==UserScript==
// @name         Cairn 记一笔
// @namespace    cairn
// @version      0.2.4
// @description  TradingView 悬浮记录浮窗：口述或打字记录交易思考，实时写入本地 Cairn（127.0.0.1 本地 API）
// @author       Cairn
// @match        https://*.tradingview.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  /* ================= 存储（GM 优先，localStorage 兜底，便于本地测试页复用） ================= */

  const store = {
    get(key, fallback) {
      try {
        const raw = typeof GM_getValue === 'function'
          ? GM_getValue(key)
          : localStorage.getItem('cairn.widget.' + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch { return fallback; }
    },
    set(key, value) {
      const raw = JSON.stringify(value);
      if (typeof GM_setValue === 'function') GM_setValue(key, raw);
      else localStorage.setItem('cairn.widget.' + key, raw);
    },
  };

  /* ================= 状态 ================= */

  // 仓位提示百分比：0 < n <= 100，最多三档；旧数据兜底回 1%/2%。
  function normalizePercents(list) {
    if (!Array.isArray(list)) return [1, 2];
    const out = [];
    for (const v of list.slice(0, 3)) {
      const n = typeof v === 'number' ? v : parseFloat(v);
      if (Number.isFinite(n) && n > 0 && n <= 100 && !out.includes(n)) out.push(n);
    }
    return out;
  }

  const state = {
    token: store.get('token', ''),
    port: store.get('port', 8787),
    themeMode: store.get('theme', 'auto'),
    riskPercents: normalizePercents(store.get('riskPercents', [1, 2])),
    editingCardId: '',
    connected: false,
    busy: false,
    accounts: [],   // [{ id, name, periods: [{ id, name }] }]
    cases: [],      // createdAt 倒序
    cards: [],      // 当前 Case，createdAt 倒序
    caseId: store.get('caseId', ''),
    phase: store.get('phase', 'pre-entry'),
    entryDecision: store.get('entryDecision', 'pending'),
    lastAccountId: store.get('ncAccount', ''),
    lastPeriodId: store.get('ncPeriod', ''),
  };

  const PHASE_META = {
    'pre-entry': { label: '观察', color: '#787b86' },
    'entry': { label: '入场', color: '#2962ff' },
    'intermediate': { label: '过程', color: '#26a69a' },
    'closing': { label: '离场', color: '#ff9800' },
    'reflection': { label: '复盘', color: '#ab47bc' },
  };

  // 阶段检查单：提示这张卡可以 cover 什么（entry 与主程序六字段 memo 对齐）
  const PHASE_PROMPTS = {
    'pre-entry': '这张卡可以覆盖：现在什么市场状态 · 值得观察的位置/结构 · 出现什么条件才考虑入场',
    'entry': '这张卡可以覆盖：方向 · 入场计划 · 止损 · 目标 · 信心（胜率）· 失效条件 · 放弃的备选',
    'intermediate': '这张卡可以覆盖：现在是哪根 BAR · 新出现的结构 · 对持仓计划的改变',
    'closing': '这张卡可以覆盖：哪根 BAR 触发离场 · 市场发生了什么变化 · 是否符合原计划',
    'reflection': '这张卡可以覆盖：实际发生了什么 · 哪些判断有依据 · 哪些动作符合计划',
  };

  /* ================= API ================= */

  function baseUrl() {
    return 'http://127.0.0.1:' + state.port + '/api/v1';
  }

  function api(method, path, body) {
    const payload = body == null ? null : JSON.stringify(body);
    const headers = { Authorization: 'Bearer ' + state.token };
    if (payload != null) headers['Content-Type'] = 'application/json';

    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method,
          url: baseUrl() + path,
          headers,
          data: payload,
          timeout: 8000,
          onload: (res) => resolve({ status: res.status, json: parseJson(res.responseText) }),
          onerror: () => reject(new Error('network')),
          ontimeout: () => reject(new Error('timeout')),
        });
      });
    }
    return fetch(baseUrl() + path, { method, headers, body: payload })
      .then(async (res) => ({ status: res.status, json: parseJson(await res.text()) }))
      .catch(() => { throw new Error('network'); });
  }

  function parseJson(text) {
    try { return JSON.parse(text); } catch { return null; }
  }

  /* ================= Shadow DOM 骨架 ================= */

  const host = document.createElement('div');
  host.id = 'cairn-cw-wrap';
  host.innerHTML = `
<style>
  #cairn-cw-wrap { all: initial; }
  #cairn-cw-wrap * { box-sizing: border-box; margin: 0; padding: 0; scrollbar-width: thin; scrollbar-color: var(--scroll, #363a45) transparent; }
  #cairn-cw-wrap *::-webkit-scrollbar { width: 8px; height: 8px; }
  #cairn-cw-wrap *::-webkit-scrollbar-track { background: transparent; }
  #cairn-cw-wrap *::-webkit-scrollbar-thumb { background: var(--scroll, #363a45); border-radius: 4px; }
  #cairn-cw-wrap *::-webkit-scrollbar-thumb:hover { background: var(--scroll-hover, #4a4f5c); }
  #cairn-cw-wrap *::-webkit-scrollbar-corner { background: transparent; }

  #cairn-cw-wrap .cw-root {
    --bg: #131722;
    --panel: #1e222d;
    --panel-2: #2a2e39;
    --border: #363a45;
    --text: #d1d4dc;
    --text-dim: #787b86;
    --accent: #2962ff;
    --green: #26a69a;
    --red: #ef5350;
    --warn: #ffb648;
    --bar-num: #ff9800;
    --scroll: #363a45;
    --scroll-hover: #4a4f5c;
    --shadow-panel: 0 16px 48px rgba(0, 0, 0, 0.55);
    --shadow-pop: 0 10px 28px rgba(0, 0, 0, 0.5);
    --chev: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23787b86' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    --radius: 12px;
    color-scheme: dark;
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif;
    font-size: 14px;
    color: var(--text);
    user-select: none;
  }

  /* 输入控件必须可选中文本：.cw-root 的 user-select:none 会吞掉全选/拖选 */
  #cairn-cw-wrap .cw-root input, #cairn-cw-wrap .cw-root textarea { user-select: text; }

  /* 浅色主题：TradingView light 色板。主题由 .cw-root.light 类切换。 */
  #cairn-cw-wrap .cw-root.light {    --bg: #ffffff;
    --panel: #f0f3fa;
    --panel-2: #e0e3eb;
    --border: #d1d4dc;
    --text: #131722;
    --text-dim: #6a6d78;
    --green: #089981;
    --red: #f23645;
    --warn: #ad6800;
    --bar-num: #c96a00;
    --scroll: #c9cfd9;
    --scroll-hover: #aeb6c2;
    --shadow-panel: 0 16px 48px rgba(24, 34, 51, 0.16);
    --shadow-pop: 0 10px 28px rgba(24, 34, 51, 0.18);
    color-scheme: light;
  }
  /* 白字压浅色底读不清的几处，浅色下改用主色文字 */
  #cairn-cw-wrap .cw-root.light .phase-pill.active { color: var(--accent); }
  #cairn-cw-wrap .cw-root.light .ed-btn.active[data-v="pending"] { color: var(--accent); }

  /* ---------- Dock：悬浮球 + 面板一体化 ---------- */
  #cairn-cw-wrap #cw-dock {
    position: fixed;
    right: 28px; bottom: 96px;
    z-index: 2147483000;
    touch-action: none;
  }

  #cairn-cw-wrap #cw-float-ball {
    width: 52px; height: 52px;
    border-radius: 50%;
    background: var(--accent);
    color: #fff;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 1px;
    cursor: grab;
    box-shadow: 0 6px 20px rgba(41, 98, 255, 0.45);
    transition: transform .12s ease, background .15s ease;
  }
  #cairn-cw-wrap #cw-float-ball:hover { transform: scale(1.07); }
  #cairn-cw-wrap #cw-float-ball:active { cursor: grabbing; }
  #cairn-cw-wrap #cw-float-ball .fb-icon { font-size: 17px; line-height: 1; }
  #cairn-cw-wrap #cw-float-ball .fb-label { font-size: 10px; line-height: 1; opacity: .9; }
  #cairn-cw-wrap #cw-float-ball .fb-dot {
    position: absolute; top: 2px; right: 2px;
    width: 11px; height: 11px; border-radius: 50%;
    background: var(--green); border: 2px solid var(--bg);
    display: none;
  }
  #cairn-cw-wrap #cw-dock.unread #cw-float-ball .fb-dot { display: block; }
  #cairn-cw-wrap #cw-dock.open #cw-float-ball {
    background: var(--panel-2);
    box-shadow: 0 4px 14px rgba(0,0,0,.45);
    border: 1px solid var(--border);
    color: var(--text);
  }

  /* ---------- 面板 ---------- */
  #cairn-cw-wrap #cw-widget {
    position: absolute;
    bottom: 64px; right: 0;
    width: 340px;
    max-height: calc(100vh - 180px);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-panel);
    display: none;
    flex-direction: column;
    /* 不能 overflow:hidden：会把 header 里绝对定位的 Case 下拉菜单裁掉。
       各滚动区自己负责裁切与底部圆角。 */
    overflow: visible;
  }
  #cairn-cw-wrap #cw-dock.open #cw-widget { display: flex; animation: cw-pop .16s ease; }
  @keyframes cw-pop { from { opacity: 0; transform: translateY(8px) scale(.97); } }

  #cairn-cw-wrap #cw-widget-header {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 12px 8px;
    cursor: grab;
    border-bottom: 1px solid var(--border);
  }
  #cairn-cw-wrap #cw-widget-header:active { cursor: grabbing; }
  #cairn-cw-wrap #cw-widget-header .grip { color: var(--text-dim); font-size: 14px; letter-spacing: -1px; }
  /* Case 选择触发框：外观与 .cw-select（主题下拉）一致；弹层用回自定义菜单 */
  #cairn-cw-wrap .case-current {
    flex: 1; min-width: 0;
    background: var(--panel-2);
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 5px 26px 5px 8px;
    font-size: 13px;
    font-family: inherit;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    overflow: hidden;
    background-image: var(--chev);
    background-repeat: no-repeat;
    background-position: right 9px center;
  }
  #cairn-cw-wrap .case-current:hover, #cairn-cw-wrap .case-current:focus { border-color: var(--border); outline: none; }
  #cairn-cw-wrap .case-current #cw-case-current-name {
    display: block;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  #cairn-cw-wrap #cw-case-menu {
    position: absolute;
    top: 48px; left: 8px; right: 8px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: var(--shadow-pop);
    display: none;
    flex-direction: column;
    max-height: 224px;
    overflow-y: auto;
    padding: 4px;
    z-index: 5;
  }
  #cairn-cw-wrap #cw-case-menu.show { display: flex; animation: cw-pop .14s ease; }
  #cairn-cw-wrap .case-menu-item {
    padding: 7px 10px;
    border-radius: 7px;
    font-size: 12.5px;
    color: var(--text);
    cursor: pointer;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    background: none; border: none; font-family: inherit; text-align: left;
  }
  #cairn-cw-wrap .case-menu-item:hover { background: var(--panel-2); }
  #cairn-cw-wrap .case-menu-item.active { color: var(--accent); background: rgba(41,98,255,.12); }
  #cairn-cw-wrap .case-menu-item.empty { color: var(--text-dim); cursor: default; }
  #cairn-cw-wrap .case-menu-item.empty:hover { background: none; }
  #cairn-cw-wrap .cw-select {
    background: var(--panel-2);
    color: var(--text);
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 5px 26px 5px 8px;
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    min-width: 0;
    /* 原生箭头不跟主题（白底块），自绘 chevron 代替；color-scheme 管弹层与光标 */
    appearance: none;
    -webkit-appearance: none;
    background-image: var(--chev);
    background-repeat: no-repeat;
    background-position: right 9px center;
  }
  #cairn-cw-wrap .cw-select:hover, #cairn-cw-wrap .cw-select:focus { border-color: var(--border); outline: none; }
  #cairn-cw-wrap .icon-btn {
    background: var(--panel-2); border: none; color: var(--text-dim);
    width: 26px; height: 26px; border-radius: 7px;
    cursor: pointer; font-size: 13px;
    display: inline-flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  #cairn-cw-wrap .icon-btn:hover { color: var(--text); }

  /* ---------- 新建 Case 行内表单 ---------- */
  #cairn-cw-wrap #cw-new-case-form {
    display: none;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    flex-direction: column; gap: 8px;
  }
  #cairn-cw-wrap #cw-new-case-form.show { display: flex; }
  #cairn-cw-wrap #cw-new-case-form input, #cairn-cw-wrap .cw-input {
    background: var(--bg); border: 1px solid var(--border); color: var(--text);
    border-radius: 8px; padding: 7px 10px; font-size: 13px; font-family: inherit;
    width: 100%;
  }
  #cairn-cw-wrap #cw-new-case-form input:focus, #cairn-cw-wrap .cw-input:focus { outline: none; border-color: var(--accent); }
  #cairn-cw-wrap .nc-selects { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  #cairn-cw-wrap .nc-selects .cw-select { font-size: 12.5px; }
  #cairn-cw-wrap .nc-row { display: flex; gap: 6px; justify-content: flex-end; align-items: center; }
  #cairn-cw-wrap .nc-create {
    background: var(--accent); border: none; color: #fff;
    border-radius: 7px; padding: 5px 12px; font-size: 12px; cursor: pointer;
  }
  #cairn-cw-wrap .nc-create:hover { filter: brightness(1.12); }

  /* ---------- 设置视图 ---------- */
  #cairn-cw-wrap #cw-settings {
    display: none;
    padding: 12px;
    flex: 1 1 auto;
    min-height: 0;
    flex-direction: column; gap: 10px;
    overflow-y: auto;
    border-radius: 0 0 var(--radius) var(--radius);
  }
  #cairn-cw-wrap #cw-dock.settings #cw-settings { display: flex; }
  #cairn-cw-wrap #cw-dock.settings #cw-widget-context,
  #cairn-cw-wrap #cw-dock.settings #cw-risk-strip,
  #cairn-cw-wrap #cw-dock.settings #cw-widget-body,
  #cairn-cw-wrap #cw-dock.settings #cw-cards-section { display: none; }
  #cairn-cw-wrap #cw-settings .set-title { font-size: 13px; font-weight: 600; }
  #cairn-cw-wrap #cw-settings .set-title:not(:first-child) {
    margin-top: 4px; padding-top: 10px;
    border-top: 1px solid var(--border);
  }
  #cairn-cw-wrap #cw-settings label { font-size: 11px; color: var(--text-dim); display: block; margin-bottom: 4px; }
  #cairn-cw-wrap #cw-settings .set-row + .set-row { margin-top: 2px; }
  #cairn-cw-wrap #cw-settings .pct-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
  #cairn-cw-wrap #cw-settings .set-hint { font-size: 10.5px; line-height: 1.5; color: var(--text-dim); margin-top: 5px; }
  #cairn-cw-wrap #cw-set-token { font-family: Consolas, monospace; font-size: 12px; }
  #cairn-cw-wrap #cw-set-port { width: 90px; }
  #cairn-cw-wrap #cw-set-status { font-size: 12px; line-height: 1.5; min-height: 18px; }
  #cairn-cw-wrap #cw-set-status.ok { color: var(--green); }
  #cairn-cw-wrap #cw-set-status.err { color: var(--red); }

  #cairn-cw-wrap #cw-widget-context {
    padding: 6px 12px;
    font-size: 11px;
    color: var(--text-dim);
    border-bottom: 1px solid var(--border);
    display: flex; gap: 6px; align-items: center;
    white-space: nowrap; overflow: hidden;
  }
  #cairn-cw-wrap #cw-widget-context .live { color: var(--green); }
  #cairn-cw-wrap #cw-risk-strip {
    padding: 5px 12px;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--text-dim);
    border-bottom: 1px solid var(--border);
    white-space: nowrap; overflow: hidden;
    display: none;
  }
  #cairn-cw-wrap #cw-risk-strip.show { display: block; }
  #cairn-cw-wrap #cw-risk-strip b { color: var(--text); font-weight: 600; }
  #cairn-cw-wrap #cw-risk-strip .rs-sep { margin: 0 6px; opacity: .45; }

  #cairn-cw-wrap #cw-widget-body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; flex: 1 1 auto; min-height: 0; }

  #cairn-cw-wrap .phase-row { display: flex; gap: 4px; }
  #cairn-cw-wrap .phase-pill {
    flex: 1;
    background: var(--panel-2);
    border: 1px solid transparent;
    color: var(--text-dim);
    border-radius: 999px;
    padding: 4px 0;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    text-align: center;
    transition: all .1s ease;
  }
  #cairn-cw-wrap .phase-pill:hover { color: var(--text); }
  #cairn-cw-wrap .phase-pill.active { background: rgba(41,98,255,.18); border-color: var(--accent); color: #fff; }

  #cairn-cw-wrap #cw-phase-checklist { font-size: 11px; line-height: 1.55; color: var(--text-dim); padding: 0 2px; margin-top: -4px; }

  #cairn-cw-wrap #cw-entry-decision { display: none; flex-direction: column; gap: 6px; }
  #cairn-cw-wrap #cw-entry-decision.show { display: flex; }
  #cairn-cw-wrap #cw-entry-decision .ed-title { font-size: 11px; color: var(--text-dim); }
  #cairn-cw-wrap .ed-row { display: flex; gap: 4px; }
  #cairn-cw-wrap .ed-btn {
    flex: 1;
    background: var(--panel-2);
    border: 1px solid transparent;
    color: var(--text-dim);
    border-radius: 8px;
    padding: 5px 4px;
    font-size: 11.5px;
    font-family: inherit;
    cursor: pointer;
  }
  #cairn-cw-wrap .ed-btn:hover { color: var(--text); }
  #cairn-cw-wrap .ed-btn.active[data-v="executed"] { background: rgba(38,166,154,.16); border-color: var(--green); color: var(--green); }
  #cairn-cw-wrap .ed-btn.active[data-v="continue-observing"] { background: rgba(255,152,0,.14); border-color: var(--bar-num); color: var(--bar-num); }
  #cairn-cw-wrap .ed-btn.active[data-v="pending"] { background: rgba(41,98,255,.16); border-color: var(--accent); color: #fff; }

  #cairn-cw-wrap #cw-card-input {
    width: 100%;
    min-height: 96px;
    resize: vertical;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 10px 12px;
    font-size: 13.5px;
    line-height: 1.55;
    font-family: inherit;
    user-select: text;
  }
  #cairn-cw-wrap #cw-card-input:focus { outline: none; border-color: var(--accent); }
  #cairn-cw-wrap #cw-card-input::placeholder { color: var(--text-dim); }

  #cairn-cw-wrap #cw-input-row { display: flex; gap: 6px; align-items: center; }
  #cairn-cw-wrap #cw-bar-input {
    width: 82px;
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--bar-num);
    font-family: Consolas, monospace;
    font-size: 13px;
    border-radius: 8px;
    padding: 7px 9px;
    text-align: center;
  }
  #cairn-cw-wrap #cw-bar-input:focus { outline: none; border-color: var(--bar-num); }
  #cairn-cw-wrap #cw-bar-input::placeholder { color: var(--text-dim); opacity: .7; }
  #cairn-cw-wrap #cw-submit-btn {
    margin-left: auto;
    background: var(--accent); color: #fff; border: none;
    border-radius: 8px; padding: 7px 14px;
    font-size: 12.5px; font-family: inherit; cursor: pointer; white-space: nowrap;
  }
  #cairn-cw-wrap #cw-submit-btn:hover { filter: brightness(1.12); }
  #cairn-cw-wrap #cw-submit-btn:disabled { opacity: .55; cursor: default; filter: none; }

  #cairn-cw-wrap #cw-completeness-tip {
    display: none;
    background: rgba(255,182,72,.1);
    border: 1px solid rgba(255,182,72,.4);
    border-radius: 10px;
    padding: 8px 11px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--warn);
  }
  #cairn-cw-wrap #cw-completeness-tip.show { display: block; animation: cw-pop .2s ease; }
  #cairn-cw-wrap #cw-completeness-tip button {
    background: none; border: none; color: var(--text-dim);
    cursor: pointer; font-size: 12px; padding: 0; float: right;
  }
  #cairn-cw-wrap #cw-completeness-tip button:hover { color: var(--text); }

  #cairn-cw-wrap #cw-cards-section { border-top: 1px solid var(--border); padding: 10px 12px 12px; border-radius: 0 0 var(--radius) var(--radius); overflow: hidden; }
  #cairn-cw-wrap #cw-cards-section .cs-head {
    display: flex; align-items: center; justify-content: space-between;
    font-size: 11px; color: var(--text-dim); margin-bottom: 8px;
  }
  #cairn-cw-wrap #cw-cards-section .cs-head button {
    background: none; border: none; color: var(--text-dim);
    font-size: 11px; cursor: pointer; padding: 0; font-family: inherit;
  }
  #cairn-cw-wrap #cw-cards-section .cs-head button:hover { color: var(--text); }
  #cairn-cw-wrap #cw-card-list { display: flex; flex-direction: column; gap: 6px; overflow-y: auto; max-height: 168px; }
  #cairn-cw-wrap .cw-card {
    background: var(--bg);
    border: 1px solid var(--border);
    border-left: 3px solid var(--pc, var(--text-dim));
    border-radius: 8px;
    padding: 7px 10px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text);
    user-select: text;
  }
  #cairn-cw-wrap .cw-card .mc-meta { display: flex; gap: 8px; margin-bottom: 3px; align-items: baseline; }
  #cairn-cw-wrap .cw-card .mc-phase { color: var(--pc, var(--text-dim)); font-size: 11px; }
  #cairn-cw-wrap .cw-card .mc-bar { font-family: Consolas, monospace; color: var(--bar-num); font-size: 11px; }
  #cairn-cw-wrap .cw-card .mc-time { color: var(--text-dim); font-size: 10.5px; margin-left: auto; }
  #cairn-cw-wrap .cw-card .mc-text {
    color: var(--text);
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden;
  }
  #cairn-cw-wrap #cw-card-list.expanded .cw-card .mc-text { -webkit-line-clamp: unset; }
  #cairn-cw-wrap .cw-card.fresh { animation: cw-fresh .5s ease; }
  @keyframes cw-fresh { from { background: rgba(38,166,154,.14); } }

  /* 卡片行内编辑：常驻 ✎ 进入，改 rawText（错字修正，原文进历史）与 barRef（留空清除） */
  #cairn-cw-wrap .cw-card .mc-edit {
    background: none; border: none;
    color: var(--text-dim);
    cursor: pointer; font-size: 11px;
    padding: 1px 3px; border-radius: 4px;
    flex-shrink: 0; margin-left: 4px;
  }
  #cairn-cw-wrap .cw-card .mc-edit:hover { color: var(--text); }
  #cairn-cw-wrap .cw-card.editing { display: flex; flex-direction: column; gap: 6px; }
  #cairn-cw-wrap .cw-card.editing .ec-text {
    width: 100%;
    min-height: 72px;
    resize: vertical;
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 8px;
    font-size: 12px;
    line-height: 1.5;
    font-family: inherit;
    user-select: text;
  }
  #cairn-cw-wrap .cw-card.editing .ec-text:focus { outline: none; border-color: var(--accent); }
  #cairn-cw-wrap .ec-row { display: flex; gap: 6px; align-items: center; }
  #cairn-cw-wrap .ec-bar {
    width: 76px;
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--bar-num);
    font-family: Consolas, monospace;
    font-size: 12px;
    border-radius: 6px;
    padding: 4px 6px;
    text-align: center;
  }
  #cairn-cw-wrap .ec-bar:focus { outline: none; border-color: var(--bar-num); }
  #cairn-cw-wrap .ec-bar::placeholder { color: var(--text-dim); opacity: .7; }
  #cairn-cw-wrap .ec-cancel {
    margin-left: auto;
    background: none; border: none;
    color: var(--text-dim);
    font-size: 12px; font-family: inherit;
    cursor: pointer; padding: 4px 6px;
  }
  #cairn-cw-wrap .ec-cancel:hover { color: var(--text); }
  #cairn-cw-wrap .ec-save {
    background: var(--accent); border: none; color: #fff;
    border-radius: 6px; padding: 4px 12px;
    font-size: 12px; font-family: inherit; cursor: pointer;
  }
  #cairn-cw-wrap .ec-save:hover { filter: brightness(1.12); }
  #cairn-cw-wrap .ec-save:disabled { opacity: .55; cursor: default; filter: none; }

  #cairn-cw-wrap #cw-toast {
    position: fixed;
    left: 50%; bottom: 36px;
    transform: translateX(-50%) translateY(16px);
    background: var(--green);
    color: #06251f;
    font-size: 13px;
    font-weight: 600;
    padding: 9px 18px;
    border-radius: 999px;
    box-shadow: 0 8px 24px rgba(0,0,0,.4);
    opacity: 0;
    pointer-events: none;
    transition: all .22s ease;
    z-index: 2147483100;
  }
  #cairn-cw-wrap #cw-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  #cairn-cw-wrap #cw-toast.err { background: var(--red); color: #2b0a09; }
</style>

<div class="cw-root">
  <div id="cw-dock">
    <div id="cw-widget">
      <div id="cw-widget-header">
        <span class="grip">⠿</span>
        <button id="cw-case-current" class="case-current" type="button" title="切换 Case">
          <span id="cw-case-current-name">—</span>
        </button>
        <div id="cw-case-menu"></div>
        <button class="icon-btn" id="cw-new-case-btn" title="开新 Case">＋</button>
        <button class="icon-btn" id="cw-settings-btn" title="连接设置">⚙</button>
      </div>

      <div id="cw-new-case-form">
        <input id="cw-new-case-title" placeholder="新 Case 标题（可留空）" spellcheck="false">
        <div class="nc-selects">
          <select id="cw-nc-account" class="cw-select"></select>
          <select id="cw-nc-period" class="cw-select"></select>
        </div>
        <div class="nc-row">
          <button class="icon-btn" id="cw-nc-cancel" title="取消">✕</button>
          <button class="nc-create" id="cw-nc-create">创建并切换</button>
        </div>
      </div>

      <div id="cw-settings">
        <div class="set-title">连接 Cairn</div>
        <div class="set-row">
          <label for="cw-set-token">API Token</label>
          <input id="cw-set-token" class="cw-input" placeholder="Cairn 设置 → 本地 API → 复制" spellcheck="false" autocomplete="off">
        </div>
        <div class="set-row">
          <label for="cw-set-port">端口</label>
          <input id="cw-set-port" class="cw-input" inputmode="numeric" placeholder="8787">
        </div>
        <div class="nc-row" style="justify-content:flex-start">
          <button class="nc-create" id="cw-set-save">保存并连接</button>
        </div>
        <div id="cw-set-status"></div>

        <div class="set-title">外观</div>
        <div class="set-row">
          <label for="cw-set-theme">主题</label>
          <select id="cw-set-theme" class="cw-select" style="width:100%">
            <option value="auto">跟随 TradingView</option>
            <option value="dark">深色</option>
            <option value="light">浅色</option>
          </select>
        </div>

        <div class="set-title">仓位提示</div>
        <div class="set-row">
          <label>开仓风险百分比（最多 3 个，可留空）</label>
          <div class="pct-row">
            <input id="cw-set-pct-1" class="cw-input" inputmode="decimal" placeholder="%">
            <input id="cw-set-pct-2" class="cw-input" inputmode="decimal" placeholder="%">
            <input id="cw-set-pct-3" class="cw-input" inputmode="decimal" placeholder="%">
          </div>
          <div class="set-hint">按当前 Case 账户的权益显示对应风险金额，显示在面板顶部；全部留空则不显示。</div>
        </div>
      </div>

      <div id="cw-widget-context">
        <span id="cw-ctx-text">—</span>
        <span class="live">● forward（盘中）</span>
      </div>

      <div id="cw-risk-strip"></div>

      <div id="cw-widget-body">
        <div class="phase-row" id="cw-phase-row">
          <button class="phase-pill" data-phase="pre-entry">观察</button>
          <button class="phase-pill" data-phase="entry">入场</button>
          <button class="phase-pill" data-phase="intermediate">过程</button>
          <button class="phase-pill" data-phase="closing">离场</button>
          <button class="phase-pill" data-phase="reflection">复盘</button>
        </div>

        <div id="cw-phase-checklist"></div>

        <div id="cw-entry-decision">
          <div class="ed-title">这张入场卡的实际执行情况：</div>
          <div class="ed-row">
            <button class="ed-btn" data-v="pending">待确认</button>
            <button class="ed-btn" data-v="executed">已执行</button>
            <button class="ed-btn" data-v="continue-observing">未执行·继续观察</button>
          </div>
        </div>

        <textarea id="cw-card-input" placeholder="想到什么说什么……" spellcheck="false"></textarea>

        <div id="cw-input-row">
          <input id="cw-bar-input" inputmode="numeric" placeholder="BAR №">
          <button id="cw-submit-btn">提交 ⌘↵</button>
        </div>

        <div id="cw-completeness-tip">
          <button id="cw-ct-close" title="知道了">✕</button>
          <div id="cw-ct-body"></div>
        </div>
      </div>

      <div id="cw-cards-section">
        <div class="cs-head">
          <span id="cw-cs-count">本次 Case 已有 0 张卡</span>
          <button id="cw-cards-expand">展开全部</button>
        </div>
        <div id="cw-card-list"></div>
      </div>
    </div>

    <div id="cw-float-ball">
      <span class="fb-dot"></span>
      <span class="fb-icon">✎</span>
      <span class="fb-label">记一笔</span>
    </div>
  </div>

  <div id="cw-toast"></div>
</div>
`;
  document.head.appendChild(host.querySelector('style'));

  const $ = (id) => host.querySelector('#' + (id.startsWith('cw-') ? id : 'cw-' + id));
  const dock = () => $('dock');

  /* ================= 工具 ================= */

  let toastTimer;
  function showToast(msg, kind) {
    const el = $('toast');
    el.textContent = msg;
    el.className = kind === 'err' ? 'err' : '';
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function fmtTime(ms) {
    const d = new Date(ms);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  /* ================= 主题（auto 跟随 TradingView） ================= */

  function detectTvTheme() {
    const html = document.documentElement.classList;
    const body = document.body ? document.body.classList : html;
    if (html.contains('theme-dark') || body.contains('theme-dark')) return 'dark';
    if (html.contains('theme-light') || body.contains('theme-light')) return 'light';
    try {
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    } catch { /* 无 matchMedia 环境按浅色处理 */ }
    return 'light';
  }

  function effectiveTheme() {
    if (state.themeMode === 'dark' || state.themeMode === 'light') return state.themeMode;
    return detectTvTheme();
  }

  function applyTheme() {
    host.querySelector('.cw-root').classList.toggle('light', effectiveTheme() === 'light');
  }

  function watchTheme() {
    const reapply = () => { if (state.themeMode === 'auto') applyTheme(); };
    const mo = new MutationObserver(reapply);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    if (document.body) mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', reapply);
    } catch { /* 老浏览器没有 addEventListener 版媒询 */ }
  }

  /* ================= 展开 / 收起 ================= */

  function setBallMode(open) {
    $('float-ball').querySelector('.fb-icon').textContent = open ? '⌄' : '✎';
    $('float-ball').querySelector('.fb-label').textContent = open ? '收起' : '记一笔';
  }

  function openWidget() {
    const d = dock();
    d.classList.add('open');
    d.classList.remove('unread');
    setBallMode(true);
    if (!state.connected && state.token) connect({ silent: true });
    if (!state.token) {
      showSettings(true);
    } else if (!d.classList.contains('settings')) {
      setTimeout(() => $('card-input').focus(), 30);
      if (state.connected) refreshCases();
    }
  }

  function collapseWidget() {
    const d = dock();
    d.classList.remove('open');
    d.classList.add('unread');
    setBallMode(false);
    closeCaseMenu();
  }

  function toggleWidget() {
    dock().classList.contains('open') ? collapseWidget() : openWidget();
  }

  /* ================= 设置视图 ================= */

  function showSettings(show) {
    const d = dock();
    d.classList.toggle('settings', show);
    if (show) {
      $('set-token').value = state.token;
      $('set-port').value = String(state.port);
      $('set-theme').value = state.themeMode;
      for (let i = 1; i <= 3; i++) {
        $('set-pct-' + i).value = state.riskPercents[i - 1] != null ? String(state.riskPercents[i - 1]) : '';
      }
      renderSetStatus(state.connected ? { ok: true, text: '✓ 已连接' } : null);
    }
  }

  function renderSetStatus(result) {
    const el = $('set-status');
    if (!result) { el.textContent = ''; el.className = ''; return; }
    el.textContent = result.text;
    el.className = result.ok ? 'ok' : 'err';
  }

  async function saveSettings() {
    state.token = $('set-token').value.trim();
    const port = parseInt($('set-port').value, 10);
    state.port = Number.isInteger(port) && port > 0 && port < 65536 ? port : 8787;
    store.set('token', state.token);
    store.set('port', state.port);
    if (!state.token) {
      renderSetStatus({ ok: false, text: '请先填入 Token' });
      return;
    }
    renderSetStatus({ ok: false, text: '连接中…' });
    const err = await connect({ silent: true });
    if (err == null) {
      showSettings(false);
      showToast('✓ 已连接 Cairn');
      setTimeout(() => $('card-input').focus(), 30);
    } else if (err.kind === 'auth') {
      renderSetStatus({ ok: false, text: 'Token 无效' });
    } else {
      renderSetStatus({ ok: false, text: '无法连接 127.0.0.1:' + state.port + '，确认 Cairn 正在运行' });
    }
  }

  function saveTheme() {
    state.themeMode = $('set-theme').value;
    store.set('theme', state.themeMode);
    applyTheme();
  }

  // 三个百分比输入 change 时即时保存；非法值不动旧配置并提示。
  function saveRiskPercents() {
    const values = [];
    for (let i = 1; i <= 3; i++) {
      const raw = $('set-pct-' + i).value.trim();
      if (!raw) continue;
      const n = parseFloat(raw);
      if (!Number.isFinite(n) || n <= 0 || n > 100) {
        renderSetStatus({ ok: false, text: '百分比需为 0–100 之间的数字' });
        return;
      }
      values.push(n);
    }
    state.riskPercents = values;
    store.set('riskPercents', values);
    renderSetStatus({ ok: true, text: values.length ? '✓ 仓位提示已保存' : '✓ 已保存（不显示仓位提示）' });
    renderContext();
  }

  /* ================= 数据加载 ================= */

  // 返回 null = 成功；否则 { kind: 'auth' | 'network' }
  async function connect({ silent } = {}) {
    if (!state.token) return { kind: 'auth' };
    try {
      const res = await api('GET', '/accounts', null);
      if (res.status === 401) {
        state.connected = false;
        if (!silent && dock().classList.contains('settings')) renderSetStatus({ ok: false, text: 'Token 无效' });
        return { kind: 'auth' };
      }
      if (res.status !== 200) throw new Error('bad status');
      state.connected = true;
      state.accounts = (res.json && res.json.accounts) || [];
      await refreshCases();
      return null;
    } catch {
      state.connected = false;
      if (!silent && dock().classList.contains('settings')) {
        renderSetStatus({ ok: false, text: '无法连接 127.0.0.1:' + state.port + '，确认 Cairn 正在运行' });
      }
      return { kind: 'network' };
    }
  }

  async function refreshCases() {
    try {
      const res = await api('GET', '/cases', null);
      if (res.status !== 200 || !res.json) return;
      state.cases = ((res.json.cases) || [])
        .slice()
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      if (!state.cases.some((c) => c.id === state.caseId)) {
        state.caseId = state.cases.length ? state.cases[0].id : '';
        store.set('caseId', state.caseId);
      }
      renderCaseOptions();
      renderContext();
      await refreshCards();
    } catch { /* 面板打开时再试 */ }
  }

  async function refreshCards() {
    if (!state.caseId) {
      state.cards = [];
      renderCards();
      return;
    }
    try {
      const res = await api('GET', '/cases/' + encodeURIComponent(state.caseId) + '/cards', null);
      if (res.status !== 200 || !res.json) return;
      state.cards = ((res.json.cards) || [])
        .slice()
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      renderCards();
    } catch { /* 保持现有列表 */ }
  }

  /* ================= 渲染 ================= */

  function renderCaseOptions() {
    const current = state.cases.find((c) => c.id === state.caseId)
    $('case-current-name').textContent = current ? (current.title || current.id) : '（无 Case）'

    const menu = $('case-menu')
    menu.textContent = ''
    if (!state.cases.length) {
      const el = document.createElement('button')
      el.type = 'button'
      el.className = 'case-menu-item empty'
      el.textContent = '（无 Case，点 ＋ 开新）'
      menu.appendChild(el)
      return
    }
    for (const c of state.cases.slice(0, 8)) {
      const el = document.createElement('button')
      el.type = 'button'
      el.className = 'case-menu-item' + (c.id === state.caseId ? ' active' : '')
      el.textContent = c.title || c.id
      el.title = c.title || c.id
      el.addEventListener('click', () => pickCase(c.id))
      menu.appendChild(el)
    }
  }

  function openCaseMenu() {
    renderCaseOptions()
    $('case-menu').classList.add('show')
  }

  function closeCaseMenu() {
    $('case-menu').classList.remove('show')
  }

  function pickCase(id) {
    closeCaseMenu()
    if (id === state.caseId) return
    state.caseId = id
    state.editingCardId = ''
    store.set('caseId', id)
    renderCaseOptions()
    renderContext()
    refreshCards()
  }

  function renderContext() {
    const c = state.cases.find((x) => x.id === state.caseId);
    if (!c) {
      $('ctx-text').textContent = '—';
      renderRisk(null);
      return;
    }
    const account = state.accounts.find((a) => a.id === c.accountId);
    const period = account && (account.periods || []).find((p) => p.id === c.periodId);
    $('ctx-text').textContent = [account && account.name, period && period.name].filter(Boolean).join(' · ') || '—';
    renderRisk(account || null);
  }

  /* 余额与自定义百分比风险额：权益快照来自 Cairn 账户记录；无快照退回初始资金。 */
  function renderRisk(account) {
    const strip = $('risk-strip');
    if (!strip) return;
    if (!account) {
      strip.classList.remove('show');
      strip.textContent = '';
      return;
    }
    const hasSnapshot = account.equity != null && Number.isFinite(account.equity);
    const base = hasSnapshot ? account.equity : account.initialBalance;
    if (base == null || !Number.isFinite(base) || !state.riskPercents.length) {
      strip.classList.remove('show');
      return;
    }
    const fmt = (n) => n.toLocaleString('en-US', { maximumFractionDigits: base >= 1000 ? 0 : 2 });
    const sep = '<span class="rs-sep">·</span>';
    const parts = state.riskPercents.map((p) => p + '% <b>' + fmt(base * p / 100) + '</b>');
    strip.innerHTML =
      '余额 <b>' + fmt(base) + '</b>' + (hasSnapshot ? '' : '（初始）') +
      ' ' + sep + ' ' + parts.join(' ' + sep + ' ');
    strip.title = account.currency ? '单位 ' + account.currency : '';
    strip.classList.add('show');
  }

  function renderCards() {
    const list = $('card-list');
    list.textContent = '';
    for (const card of state.cards) {
      const meta = PHASE_META[card.phase] || { label: card.phase, color: 'var(--text-dim)' };
      const el = document.createElement('div');
      el.className = 'cw-card';
      el.style.setProperty('--pc', meta.color);
      if (card.id === state.editingCardId) {
        el.classList.add('editing');
        const ta = document.createElement('textarea');
        ta.className = 'ec-text';
        ta.spellcheck = false;
        ta.value = card.rawText || '';
        const row = document.createElement('div');
        row.className = 'ec-row';
        row.innerHTML =
          '<input class="ec-bar" inputmode="numeric" placeholder="BAR №（留空清除）">' +
          '<button type="button" class="ec-cancel">取消</button>' +
          '<button type="button" class="ec-save">保存</button>';
        row.querySelector('.ec-bar').value = card.barRef != null ? String(card.barRef) : '';
        row.querySelector('.ec-cancel').addEventListener('click', cancelEditCard);
        row.querySelector('.ec-save').addEventListener('click', () => saveCardEdit(card.id, el));
        el.append(ta, row);
      } else {
        const barHtml = card.barRef != null
          ? '<span class="mc-bar">BAR ' + card.barRef + '</span>'
          : '';
        el.innerHTML = `
          <div class="mc-meta">
            <span class="mc-phase"></span>
            ${barHtml}
            <span class="mc-time"></span>
            <button type="button" class="mc-edit" title="修改这张卡">✎</button>
          </div>
          <div class="mc-text"></div>`;
        el.querySelector('.mc-phase').textContent = meta.label;
        el.querySelector('.mc-time').textContent = card.createdAt ? fmtTime(card.createdAt) : '';
        el.querySelector('.mc-text').textContent = card.rawText || '';
        el.querySelector('.mc-edit').addEventListener('click', () => startEditCard(card.id));
      }
      list.appendChild(el);
    }
    $('cs-count').textContent = '本次 Case 已有 ' + state.cards.length + ' 张卡';
  }

  function renderPhasePills() {
    host.querySelectorAll('.phase-pill').forEach((pill) => {
      pill.classList.toggle('active', pill.dataset.phase === state.phase);
    });
    $('phase-checklist').textContent = PHASE_PROMPTS[state.phase] || '';
    $('entry-decision').classList.toggle('show', state.phase === 'entry');
    host.querySelectorAll('.ed-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.v === state.entryDecision);
    });
  }

  function renderAccountSelects() {
    const accSel = $('nc-account');
    const perSel = $('nc-period');
    accSel.textContent = '';
    for (const account of state.accounts) {
      const opt = document.createElement('option');
      opt.value = account.id;
      opt.textContent = account.name || account.id;
      accSel.appendChild(opt);
    }
    if (!state.accounts.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '（无账户）';
      accSel.appendChild(opt);
    }
    if (state.accounts.some((a) => a.id === state.lastAccountId)) {
      accSel.value = state.lastAccountId;
    } else if (state.accounts.length) {
      state.lastAccountId = state.accounts[0].id;
      accSel.value = state.lastAccountId;
    }
    renderPeriodOptions();
  }

  function renderPeriodOptions() {
    const perSel = $('nc-period');
    const account = state.accounts.find((a) => a.id === state.lastAccountId);
    const periods = (account && account.periods) || [];
    perSel.textContent = '';
    if (!periods.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '（无 Period）';
      perSel.appendChild(opt);
      return;
    }
    for (const p of periods) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name || p.id;
      perSel.appendChild(opt);
    }
    if (periods.some((p) => p.id === state.lastPeriodId)) {
      perSel.value = state.lastPeriodId;
    } else if (periods.length) {
      state.lastPeriodId = periods[0].id;
      perSel.value = state.lastPeriodId;
    }
  }

  /* ================= 完整性检查雏形（Stage 5 AI 的占位） ================= */

  function checkCompleteness(phase, text) {
    if (phase !== 'entry') return [];
    const hints = [];
    if (!/止损|失效|放弃|走弱|跌破|如果/.test(text)) hints.push('失效条件（什么情况下认错）');
    if (!/目标|看到|预期|到.*位置/.test(text)) hints.push('目标位或预期路径');
    if (!/方向|做多|做空|多|空/.test(text)) hints.push('方向');
    return hints;
  }

  /* ================= 提交 Card ================= */

  async function submitCard() {
    const ta = $('card-input');
    const text = ta.value.trim();
    if (!text || state.busy) { ta.focus(); return; }
    if (!state.caseId) { showToast('先选择或新建 Case', 'err'); return; }
    if (!state.connected) {
      const err = await connect({ silent: true });
      if (err) { showToast('无法连接 Cairn', 'err'); showSettings(true); return; }
    }

    const payload = { phase: state.phase, rawText: text };
    const manualBar = parseInt($('bar-input').value, 10);
    if (Number.isInteger(manualBar) && manualBar > 0) payload.barRef = manualBar;
    if (state.phase === 'entry') payload.entryDecision = state.entryDecision;

    const btn = $('submit-btn');
    state.busy = true;
    btn.disabled = true;
    btn.textContent = '保存中…';
    try {
      const res = await api('POST', '/cases/' + encodeURIComponent(state.caseId) + '/cards', payload);
      if (res.status === 401) {
        state.connected = false;
        showToast('Token 无效', 'err');
        showSettings(true);
        return;
      }
      if (res.status !== 200 || !res.json || !res.json.id) {
        showToast((res.json && res.json.error) || '保存失败', 'err');
        return;
      }
      state.cards.unshift(res.json);
      renderCards();
      const first = $('card-list').firstElementChild;
      if (first) first.classList.add('fresh');
      ta.value = '';
      $('bar-input').value = '';

      const hints = checkCompleteness(payload.phase, text);
      if (hints.length > 0) {
        $('ct-body').textContent = '还没提到：' + hints.join('、');
        $('completeness-tip').classList.add('show');
      } else {
        $('completeness-tip').classList.remove('show');
      }
      showToast('✓ 已保存');
      ta.focus();
    } catch {
      showToast('无法连接 Cairn', 'err');
    } finally {
      state.busy = false;
      btn.disabled = false;
      btn.textContent = '提交 ⌘↵';
    }
  }

  /* ================= 修改已登记卡片 ================= */

  function startEditCard(id) {
    state.editingCardId = id;
    renderCards();
    const ta = host.querySelector('.cw-card.editing .ec-text');
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }

  function cancelEditCard() {
    state.editingCardId = '';
    renderCards();
  }

  // 卡片修正：rawText 错字修正（后端负责把旧表述压入 rawTextHistory）+ barRef（null = 清除）。
  // 契约：PUT /cases/{caseId}/cards/{cardId}，返回更新后的卡片。
  // 后端 0.2.2 起才提供该路由；旧后端返回 404/immutable 时提示升级，编辑内容保留不丢。
  async function saveCardEdit(id, el) {
    const card = state.cards.find((c) => c.id === id);
    if (!card || state.busy) return;
    const text = el.querySelector('.ec-text').value.trim();
    if (!text) { showToast('内容不能为空', 'err'); return; }
    let barRef = null;
    const barRaw = el.querySelector('.ec-bar').value.trim();
    if (barRaw) {
      const n = parseInt(barRaw, 10);
      if (!Number.isInteger(n) || n < 1) { showToast('BAR 需为正整数', 'err'); return; }
      barRef = n;
    }
    const prevBar = card.barRef == null ? null : card.barRef;
    if (text === card.rawText && barRef === prevBar) { cancelEditCard(); return; }
    if (!state.connected) {
      const err = await connect({ silent: true });
      if (err) { showToast('无法连接 Cairn', 'err'); showSettings(true); return; }
    }

    const btn = el.querySelector('.ec-save');
    state.busy = true;
    btn.disabled = true;
    btn.textContent = '保存中…';
    try {
      const caseId = card.caseId || state.caseId;
      const res = await api('PUT', '/cases/' + encodeURIComponent(caseId) + '/cards/' + encodeURIComponent(id), { rawText: text, barRef });
      if (res.status === 401) {
        state.connected = false;
        showToast('Token 无效', 'err');
        showSettings(true);
        return;
      }
      if (res.status === 200 && res.json && res.json.id) {
        state.cards = state.cards.map((c) => (c.id === id ? res.json : c));
        state.editingCardId = '';
        renderCards();
        showToast('✓ 已修正（原表述已存档）');
      } else if (res.status === 404 || res.status === 405 || /immutable/i.test((res.json && res.json.error) || '')) {
        showToast('当前 Cairn 版本还不支持修改卡片，请更新 Cairn（0.2.2+）后重试', 'err');
      } else {
        showToast((res.json && res.json.error) || '保存失败', 'err');
      }
    } catch {
      showToast('无法连接 Cairn', 'err');
    } finally {
      state.busy = false;
      btn.disabled = false;
      btn.textContent = '保存';
    }
  }

  /* ================= 新建 Case ================= */

  function defaultCaseTitle() {
    const m = document.title.match(/([A-Z0-9]{2,12}:[A-Z0-9.-]+)/);
    const short = m ? m[1].split(':')[1] : '';
    const now = new Date();
    const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    return (short ? short + ' ' : '') + '观察 ' + hhmm;
  }

  async function createCase() {
    if (state.busy) return;
    if (!state.accounts.length) { showToast('先在 ⚙ 里连接 Cairn', 'err'); return; }
    const title = $('new-case-title').value.trim() || defaultCaseTitle();
    const accountId = $('nc-account').value;
    const periodId = $('nc-period').value;
    if (!accountId || !periodId) { showToast('缺少账户或 Period', 'err'); return; }

    state.busy = true;
    $('nc-create').disabled = true;
    try {
      const res = await api('POST', '/cases', { title, accountId, periodId });
      if (res.status === 401) {
        state.connected = false;
        showToast('Token 无效', 'err');
        showSettings(true);
        return;
      }
      if (res.status !== 200 || !res.json || !res.json.id) {
        showToast((res.json && res.json.error) || '创建失败', 'err');
        return;
      }
      state.lastAccountId = accountId;
      state.lastPeriodId = periodId;
      store.set('ncAccount', accountId);
      store.set('ncPeriod', periodId);
      state.cases.unshift(res.json);
      state.caseId = res.json.id;
      store.set('caseId', state.caseId);
      state.cards = [];
      renderCaseOptions();
      renderContext();
      renderCards();
      $('new-case-title').value = '';
      $('new-case-form').classList.remove('show');
      showToast('✓ 已创建 Case');
      $('card-input').focus();
    } catch {
      showToast('无法连接 Cairn', 'err');
    } finally {
      state.busy = false;
      $('nc-create').disabled = false;
    }
  }

  /* ================= 事件绑定 ================= */

  function bindEvents() {
    // 悬浮球：点击切换，拖动移位（拖动不触发点击）
    makeDraggable($('float-ball'), { onClick: toggleWidget });
    makeDraggable($('widget-header'));

    $('phase-row').addEventListener('click', (e) => {
      const pill = e.target.closest('.phase-pill');
      if (!pill) return;
      state.phase = pill.dataset.phase;
      store.set('phase', state.phase);
      renderPhasePills();
      $('card-input').focus();
    });

    host.querySelector('.ed-row').addEventListener('click', (e) => {
      const b = e.target.closest('.ed-btn');
      if (!b) return;
      state.entryDecision = b.dataset.v;
      store.set('entryDecision', state.entryDecision);
      renderPhasePills();
    });

    $('submit-btn').addEventListener('click', submitCard);
    $('ct-close').addEventListener('click', () => $('completeness-tip').classList.remove('show'));

    $('cards-expand').addEventListener('click', function () {
      const expanded = $('card-list').classList.toggle('expanded');
      this.textContent = expanded ? '收起' : '展开全部';
    });

    $('case-current').addEventListener('click', () => {
      $('case-menu').classList.contains('show') ? closeCaseMenu() : openCaseMenu()
    })

    $('new-case-btn').addEventListener('click', () => {
      if (!state.accounts.length) { showToast('先在 ⚙ 里连接 Cairn', 'err'); showSettings(true); return; }
      renderAccountSelects();
      $('new-case-form').classList.toggle('show');
      $('new-case-title').focus();
    });
    $('nc-cancel').addEventListener('click', () => $('new-case-form').classList.remove('show'));
    $('nc-create').addEventListener('click', createCase);
    $('nc-account').addEventListener('change', (e) => {
      state.lastAccountId = e.target.value;
      renderPeriodOptions();
    });

    $('settings-btn').addEventListener('click', () => {
      const d = dock();
      if (d.classList.contains('settings')) showSettings(false);
      else showSettings(true);
    });
    $('set-save').addEventListener('click', saveSettings);
    $('set-theme').addEventListener('change', saveTheme);
    for (let i = 1; i <= 3; i++) {
      $('set-pct-' + i).addEventListener('change', saveRiskPercents);
    }

    // 键盘隔离（双保险）：浮窗 UI 直接挂在页面 DOM 上（非 Shadow DOM），TradingView 对聚焦的
    // input/textarea 会自行跳过快捷键；这里再兜一层——任何源自浮窗内部的按键在 window 捕获
    // 阶段（早于一切 document 监听）截断，浮窗自身的按键行为（提交/保存/Esc）由这一层代答。
    // 只 stopPropagation，除提交/保存键外不 preventDefault：打字/粘贴/IME 组字不受影响。
    function widgetKeydown(e) {
      if (!e.composedPath().includes(host)) return;
      const inner = document.activeElement;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && inner === $('card-input')) {
        e.preventDefault();
        submitCard();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && inner && inner.classList.contains('ec-text')) {
        e.preventDefault();
        saveCardEdit(state.editingCardId, inner.closest('.cw-card'));
      } else if (e.key === 'Enter' && inner && inner.classList.contains('ec-bar')) {
        e.preventDefault();
        saveCardEdit(state.editingCardId, inner.closest('.cw-card'));
      } else if (e.key === 'Enter' && (inner === $('bar-input') || inner === $('set-token') || inner === $('set-port'))) {
        e.preventDefault();
        if (inner === $('bar-input')) submitCard();
        else saveSettings();
      } else if (e.key === 'Enter' && inner && inner.id && inner.id.indexOf('cw-set-pct-') === 0) {
        e.preventDefault();
        saveRiskPercents();
      } else if (e.key === 'Escape' && dock().classList.contains('open')) {
        if (state.editingCardId) cancelEditCard();
        else if ($('case-menu').classList.contains('show')) closeCaseMenu();
        else collapseWidget();
      }
      e.stopPropagation();
    }
    window.addEventListener('keydown', widgetKeydown, true);
    window.addEventListener('keyup', (e) => {
      if (e.composedPath().includes(host)) e.stopPropagation();
    }, true);

    // 点浮窗外部：收起 Case 菜单
    document.addEventListener('pointerdown', (e) => {
      if (!$('case-menu').classList.contains('show')) return;
      if (!e.composedPath().includes(host)) closeCaseMenu();
    }, true);
  }

  /* ================= 拖动（单一 dock 定位） ================= */

  const DRAG_THRESHOLD = 4;

  function makeDraggable(handle, opts = {}) {
    let sx = 0, sy = 0, ox = 0, oy = 0, moved = false, dragging = false;
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('select, button, input, textarea')) return;
      dragging = true;
      moved = false;
      handle.setPointerCapture(e.pointerId);
      sx = e.clientX; sy = e.clientY;
      const r = dock().getBoundingClientRect();
      ox = r.left; oy = r.top;
      // 先锁定 left/top 再清 right/bottom，避免首帧跳位/消失
      const d = dock();
      d.style.left = r.left + 'px';
      d.style.top = r.top + 'px';
      d.style.right = 'auto';
      d.style.bottom = 'auto';
    });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) moved = true;
      if (!moved) return;
      const nx = Math.min(Math.max(8, ox + dx), window.innerWidth - 60);
      const ny = Math.min(Math.max(8, oy + dy), window.innerHeight - 60);
      const d = dock();
      d.style.left = nx + 'px';
      d.style.top = ny + 'px';
    });
    handle.addEventListener('pointerup', () => {
      const wasDrag = moved;
      dragging = false;
      if (wasDrag) {
        const d = dock();
        store.set('dockPos', { left: d.style.left, top: d.style.top });
      } else if (opts.onClick) {
        opts.onClick();
      }
    });
    handle.addEventListener('pointercancel', () => { dragging = false; });
  }

  function restoreDockPos() {
    const saved = store.get('dockPos', null);
    if (!saved || !saved.left || !saved.top) return;
    const left = parseFloat(saved.left);
    const top = parseFloat(saved.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) return;
    const d = dock();
    d.style.left = Math.min(Math.max(8, left), Math.max(8, window.innerWidth - 60)) + 'px';
    d.style.top = Math.min(Math.max(8, top), Math.max(8, window.innerHeight - 60)) + 'px';
    d.style.right = 'auto';
    d.style.bottom = 'auto';
  }

  /* ================= 启动 ================= */

  function start() {
    document.body.appendChild(host);
    renderPhasePills();
    renderCaseOptions();
    renderCards();
    bindEvents();
    restoreDockPos();
    applyTheme();
    watchTheme();

    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('Cairn 连接设置', () => {
        openWidget();
        showSettings(true);
      });
    }

    // 已配置过 token 则后台静默连接，首次打开即有数据
    if (state.token) connect({ silent: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
