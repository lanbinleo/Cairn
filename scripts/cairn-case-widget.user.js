// ==UserScript==
// @name         Cairn 记一笔
// @namespace    cairn
// @version      0.2.0
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

  const state = {
    token: store.get('token', ''),
    port: store.get('port', 8787),
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
  host.id = 'cairn-case-widget-host';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; margin: 0; padding: 0; scrollbar-width: thin; scrollbar-color: #363a45 transparent; }
  *::-webkit-scrollbar { width: 8px; height: 8px; }
  *::-webkit-scrollbar-track { background: transparent; }
  *::-webkit-scrollbar-thumb { background: #363a45; border-radius: 4px; }
  *::-webkit-scrollbar-thumb:hover { background: #4a4f5c; }
  *::-webkit-scrollbar-corner { background: transparent; }

  .cw-root {
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
    --radius: 12px;
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif;
    font-size: 14px;
    color: var(--text);
    user-select: none;
  }

  /* ---------- Dock：悬浮球 + 面板一体化 ---------- */
  #dock {
    position: fixed;
    right: 28px; bottom: 96px;
    z-index: 2147483000;
    touch-action: none;
  }

  #float-ball {
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
  #float-ball:hover { transform: scale(1.07); }
  #float-ball:active { cursor: grabbing; }
  #float-ball .fb-icon { font-size: 17px; line-height: 1; }
  #float-ball .fb-label { font-size: 10px; line-height: 1; opacity: .9; }
  #float-ball .fb-dot {
    position: absolute; top: 2px; right: 2px;
    width: 11px; height: 11px; border-radius: 50%;
    background: var(--green); border: 2px solid var(--bg);
    display: none;
  }
  #dock.unread #float-ball .fb-dot { display: block; }
  #dock.open #float-ball {
    background: var(--panel-2);
    box-shadow: 0 4px 14px rgba(0,0,0,.45);
    border: 1px solid var(--border);
    color: var(--text);
  }

  /* ---------- 面板 ---------- */
  #widget {
    position: absolute;
    bottom: 64px; right: 0;
    width: 340px;
    max-height: calc(100vh - 180px);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
    display: none;
    flex-direction: column;
    overflow: hidden;
  }
  #dock.open #widget { display: flex; animation: pop .16s ease; }
  @keyframes pop { from { opacity: 0; transform: translateY(8px) scale(.97); } }

  #widget-header {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 12px 8px;
    cursor: grab;
    border-bottom: 1px solid var(--border);
  }
  #widget-header:active { cursor: grabbing; }
  #widget-header .grip { color: var(--text-dim); font-size: 14px; letter-spacing: -1px; }
  .case-current {
    flex: 1; min-width: 0;
    display: flex; align-items: center; gap: 6px;
    background: var(--panel-2);
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 5px 8px;
    font-size: 13px;
    font-family: inherit;
    color: var(--text);
    cursor: pointer;
    text-align: left;
  }
  .case-current:hover, .case-current:focus { border-color: var(--border); outline: none; }
  .case-current #case-current-name {
    flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .case-current .chev { color: var(--text-dim); font-size: 10px; flex-shrink: 0; }
  #case-menu {
    position: absolute;
    top: 44px; left: 8px; right: 8px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 10px 28px rgba(0,0,0,.5);
    display: none;
    flex-direction: column;
    max-height: 224px;
    overflow-y: auto;
    padding: 4px;
    z-index: 5;
  }
  #case-menu.show { display: flex; animation: pop .14s ease; }
  .case-menu-item {
    padding: 7px 10px;
    border-radius: 7px;
    font-size: 12.5px;
    color: var(--text);
    cursor: pointer;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    background: none; border: none; font-family: inherit; text-align: left;
  }
  .case-menu-item:hover { background: var(--panel-2); }
  .case-menu-item.active { color: var(--accent); background: rgba(41,98,255,.12); }
  .case-menu-item.empty { color: var(--text-dim); cursor: default; }
  .case-menu-item.empty:hover { background: none; }
  .cw-select {
    background: var(--panel-2);
    color: var(--text);
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 5px 8px;
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    min-width: 0;
  }
  .cw-select:hover, .cw-select:focus { border-color: var(--border); outline: none; }
  .icon-btn {
    background: var(--panel-2); border: none; color: var(--text-dim);
    width: 26px; height: 26px; border-radius: 7px;
    cursor: pointer; font-size: 13px;
    display: inline-flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .icon-btn:hover { color: var(--text); }

  /* ---------- 新建 Case 行内表单 ---------- */
  #new-case-form {
    display: none;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    flex-direction: column; gap: 8px;
  }
  #new-case-form.show { display: flex; }
  #new-case-form input, .cw-input {
    background: var(--bg); border: 1px solid var(--border); color: var(--text);
    border-radius: 8px; padding: 7px 10px; font-size: 13px; font-family: inherit;
    width: 100%;
  }
  #new-case-form input:focus, .cw-input:focus { outline: none; border-color: var(--accent); }
  .nc-selects { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .nc-selects .cw-select { font-size: 12.5px; }
  .nc-row { display: flex; gap: 6px; justify-content: flex-end; align-items: center; }
  .nc-create {
    background: var(--accent); border: none; color: #fff;
    border-radius: 7px; padding: 5px 12px; font-size: 12px; cursor: pointer;
  }
  .nc-create:hover { filter: brightness(1.12); }

  /* ---------- 设置视图 ---------- */
  #cw-settings {
    display: none;
    padding: 12px;
    flex-direction: column; gap: 10px;
    overflow-y: auto;
  }
  #dock.settings #cw-settings { display: flex; }
  #dock.settings #widget-context,
  #dock.settings #widget-body,
  #dock.settings #cards-section { display: none; }
  #cw-settings .set-title { font-size: 13px; font-weight: 600; }
  #cw-settings label { font-size: 11px; color: var(--text-dim); display: block; margin-bottom: 4px; }
  #cw-settings .set-row + .set-row { margin-top: 2px; }
  #set-token { font-family: Consolas, monospace; font-size: 12px; }
  #set-port { width: 90px; }
  #set-status { font-size: 12px; line-height: 1.5; min-height: 18px; }
  #set-status.ok { color: var(--green); }
  #set-status.err { color: var(--red); }

  #widget-context {
    padding: 6px 12px;
    font-size: 11px;
    color: var(--text-dim);
    border-bottom: 1px solid var(--border);
    display: flex; gap: 6px; align-items: center;
    white-space: nowrap; overflow: hidden;
  }
  #widget-context .live { color: var(--green); }

  #widget-body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }

  .phase-row { display: flex; gap: 4px; }
  .phase-pill {
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
  .phase-pill:hover { color: var(--text); }
  .phase-pill.active { background: rgba(41,98,255,.18); border-color: var(--accent); color: #fff; }

  #entry-decision { display: none; flex-direction: column; gap: 6px; }
  #entry-decision.show { display: flex; }
  #entry-decision .ed-title { font-size: 11px; color: var(--text-dim); }
  .ed-row { display: flex; gap: 4px; }
  .ed-btn {
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
  .ed-btn:hover { color: var(--text); }
  .ed-btn.active[data-v="executed"] { background: rgba(38,166,154,.16); border-color: var(--green); color: var(--green); }
  .ed-btn.active[data-v="continue-observing"] { background: rgba(255,152,0,.14); border-color: var(--bar-num); color: var(--bar-num); }
  .ed-btn.active[data-v="pending"] { background: rgba(41,98,255,.16); border-color: var(--accent); color: #fff; }

  #card-input {
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
  #card-input:focus { outline: none; border-color: var(--accent); }
  #card-input::placeholder { color: var(--text-dim); }

  #input-row { display: flex; gap: 6px; align-items: center; }
  #bar-input {
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
  #bar-input:focus { outline: none; border-color: var(--bar-num); }
  #bar-input::placeholder { color: var(--text-dim); opacity: .7; }
  #submit-btn {
    margin-left: auto;
    background: var(--accent); color: #fff; border: none;
    border-radius: 8px; padding: 7px 14px;
    font-size: 12.5px; font-family: inherit; cursor: pointer; white-space: nowrap;
  }
  #submit-btn:hover { filter: brightness(1.12); }
  #submit-btn:disabled { opacity: .55; cursor: default; filter: none; }

  #completeness-tip {
    display: none;
    background: rgba(255,182,72,.1);
    border: 1px solid rgba(255,182,72,.4);
    border-radius: 10px;
    padding: 8px 11px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--warn);
  }
  #completeness-tip.show { display: block; animation: pop .2s ease; }
  #completeness-tip button {
    background: none; border: none; color: var(--text-dim);
    cursor: pointer; font-size: 12px; padding: 0; float: right;
  }
  #completeness-tip button:hover { color: var(--text); }

  #cards-section { border-top: 1px solid var(--border); padding: 10px 12px 12px; }
  #cards-section .cs-head {
    display: flex; align-items: center; justify-content: space-between;
    font-size: 11px; color: var(--text-dim); margin-bottom: 8px;
  }
  #cards-section .cs-head button {
    background: none; border: none; color: var(--text-dim);
    font-size: 11px; cursor: pointer; padding: 0; font-family: inherit;
  }
  #cards-section .cs-head button:hover { color: var(--text); }
  #card-list { display: flex; flex-direction: column; gap: 6px; overflow-y: auto; max-height: 168px; }
  .cw-card {
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
  .cw-card .mc-meta { display: flex; gap: 8px; margin-bottom: 3px; align-items: baseline; }
  .cw-card .mc-phase { color: var(--pc, var(--text-dim)); font-size: 11px; }
  .cw-card .mc-bar { font-family: Consolas, monospace; color: var(--bar-num); font-size: 11px; }
  .cw-card .mc-time { color: var(--text-dim); font-size: 10.5px; margin-left: auto; }
  .cw-card .mc-text {
    color: var(--text);
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden;
  }
  #card-list.expanded .cw-card .mc-text { -webkit-line-clamp: unset; }
  .cw-card.fresh { animation: fresh .5s ease; }
  @keyframes fresh { from { background: rgba(38,166,154,.14); } }

  #toast {
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
  #toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  #toast.err { background: var(--red); color: #2b0a09; }
</style>

<div class="cw-root">
  <div id="dock">
    <div id="widget">
      <div id="widget-header">
        <span class="grip">⠿</span>
        <button id="case-current" type="button" title="切换 Case">
          <span id="case-current-name">—</span>
          <span class="chev">▾</span>
        </button>
        <div id="case-menu"></div>
        <button class="icon-btn" id="new-case-btn" title="开新 Case">＋</button>
        <button class="icon-btn" id="settings-btn" title="连接设置">⚙</button>
      </div>

      <div id="new-case-form">
        <input id="new-case-title" placeholder="新 Case 标题（可留空）" spellcheck="false">
        <div class="nc-selects">
          <select id="nc-account" class="cw-select"></select>
          <select id="nc-period" class="cw-select"></select>
        </div>
        <div class="nc-row">
          <button class="icon-btn" id="nc-cancel" title="取消">✕</button>
          <button class="nc-create" id="nc-create">创建并切换</button>
        </div>
      </div>

      <div id="cw-settings">
        <div class="set-title">连接 Cairn</div>
        <div class="set-row">
          <label for="set-token">API Token</label>
          <input id="set-token" class="cw-input" placeholder="Cairn 设置 → 本地 API → 复制" spellcheck="false" autocomplete="off">
        </div>
        <div class="set-row">
          <label for="set-port">端口</label>
          <input id="set-port" class="cw-input" inputmode="numeric" placeholder="8787">
        </div>
        <div class="nc-row" style="justify-content:flex-start">
          <button class="nc-create" id="set-save">保存并连接</button>
        </div>
        <div id="set-status"></div>
      </div>

      <div id="widget-context">
        <span id="ctx-text">—</span>
        <span class="live">● forward（盘中）</span>
      </div>

      <div id="widget-body">
        <div class="phase-row" id="phase-row">
          <button class="phase-pill" data-phase="pre-entry">观察</button>
          <button class="phase-pill" data-phase="entry">入场</button>
          <button class="phase-pill" data-phase="intermediate">过程</button>
          <button class="phase-pill" data-phase="closing">离场</button>
          <button class="phase-pill" data-phase="reflection">复盘</button>
        </div>

        <div id="entry-decision">
          <div class="ed-title">这张入场卡的实际执行情况：</div>
          <div class="ed-row">
            <button class="ed-btn" data-v="pending">待确认</button>
            <button class="ed-btn" data-v="executed">已执行</button>
            <button class="ed-btn" data-v="continue-observing">未执行·继续观察</button>
          </div>
        </div>

        <textarea id="card-input" placeholder="想到什么说什么……" spellcheck="false"></textarea>

        <div id="input-row">
          <input id="bar-input" inputmode="numeric" placeholder="BAR №">
          <button id="submit-btn">提交 ⌘↵</button>
        </div>

        <div id="completeness-tip">
          <button id="ct-close" title="知道了">✕</button>
          <div id="ct-body"></div>
        </div>
      </div>

      <div id="cards-section">
        <div class="cs-head">
          <span id="cs-count">本次 Case 已有 0 张卡</span>
          <button id="cards-expand">展开全部</button>
        </div>
        <div id="card-list"></div>
      </div>
    </div>

    <div id="float-ball">
      <span class="fb-dot"></span>
      <span class="fb-icon">✎</span>
      <span class="fb-label">记一笔</span>
    </div>
  </div>

  <div id="toast"></div>
</div>
`;

  const $ = (id) => root.getElementById(id);
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
    store.set('caseId', id)
    renderCaseOptions()
    renderContext()
    refreshCards()
  }

  function renderContext() {
    const c = state.cases.find((x) => x.id === state.caseId);
    if (!c) {
      $('ctx-text').textContent = '—';
      return;
    }
    const account = state.accounts.find((a) => a.id === c.accountId);
    const period = account && (account.periods || []).find((p) => p.id === c.periodId);
    $('ctx-text').textContent = [account && account.name, period && period.name].filter(Boolean).join(' · ') || '—';
  }

  function renderCards() {
    const list = $('card-list');
    list.textContent = '';
    for (const card of state.cards) {
      const meta = PHASE_META[card.phase] || { label: card.phase, color: 'var(--text-dim)' };
      const el = document.createElement('div');
      el.className = 'cw-card';
      el.style.setProperty('--pc', meta.color);
      const barHtml = card.barRef != null
        ? '<span class="mc-bar">BAR ' + card.barRef + '</span>'
        : '';
      el.innerHTML = `
        <div class="mc-meta">
          <span class="mc-phase"></span>
          ${barHtml}
          <span class="mc-time"></span>
        </div>
        <div class="mc-text"></div>`;
      el.querySelector('.mc-phase').textContent = meta.label;
      el.querySelector('.mc-time').textContent = card.createdAt ? fmtTime(card.createdAt) : '';
      el.querySelector('.mc-text').textContent = card.rawText || '';
      list.appendChild(el);
    }
    $('cs-count').textContent = '本次 Case 已有 ' + state.cards.length + ' 张卡';
  }

  function renderPhasePills() {
    root.querySelectorAll('.phase-pill').forEach((pill) => {
      pill.classList.toggle('active', pill.dataset.phase === state.phase);
    });
    $('entry-decision').classList.toggle('show', state.phase === 'entry');
    root.querySelectorAll('.ed-btn').forEach((btn) => {
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

    root.querySelector('.ed-row').addEventListener('click', (e) => {
      const b = e.target.closest('.ed-btn');
      if (!b) return;
      state.entryDecision = b.dataset.v;
      store.set('entryDecision', state.entryDecision);
      renderPhasePills();
    });

    $('submit-btn').addEventListener('click', submitCard);
    $('card-input').addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submitCard(); }
    });
    $('bar-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submitCard(); }
    });
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
    $('set-token').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveSettings(); }
    });
    $('set-port').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveSettings(); }
    });

    // Esc：先收 Case 菜单，再收面板（事件源自浮窗内部时不影响 TradingView 自身快捷键）
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !dock().classList.contains('open')) return;
      e.stopPropagation();
      if ($('case-menu').classList.contains('show')) closeCaseMenu();
      else collapseWidget();
    });

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
    (document.documentElement || document.body).appendChild(host);
    renderPhasePills();
    renderCaseOptions();
    renderCards();
    bindEvents();
    restoreDockPos();

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
