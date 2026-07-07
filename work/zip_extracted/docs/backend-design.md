# Cairn 后端设计文档

> 版本：v0.1 草案 · 目标形态：本地软件（Tauri / Electron / 本地 Node 服务均可适配）
> 存储：SQLite · 接口：REST API · 时间基准：统一 UTC（ISO 8601，`Z` 后缀）

---

## 1. 系统概览

Cairn 是一个个人交易记录与复盘系统。核心域模型为四层：

```
Account（账本/交易环境）
  └── Period（一段复盘/交易阶段 = a collection of trades）
        └── Trade（一个仓位的完整生命周期）
              └── Execution（原子成交：进场/加仓/减仓/离场）
```

补充实体：

- **Symbol（品种）**：`交易所:代码` 唯一标识（如 `BINANCE:BTCUSDT`、`CME:ES`），全局共享。
- **ChartData（图表数据）**：某品种某时间段的 OHLC + EMA20 序列，供 Trade 复盘页渲染 Lightweight Charts。
- **TradeEvent（交易事件）**：Trade 生命周期内的 SL/TP 移动等事件时间线。
- **Note（笔记）**：独立于 Trade 的复盘笔记，可 `@mention` Trade / Period / Account / 图片附件。
- **Attachment（附件）**：参考图等文件，存本地文件系统，DB 只存相对路径。

设计原则：

1. **Execution 是唯一的成交事实来源**。Trade 的 PnL、持仓量、均价全部由其 Executions 推导（可缓存冗余列，但以 Execution 为准可重算）。
2. **时间一律存 UTC 毫秒时间戳**（INTEGER）。Bar 序号只是前端录入的换算辅助，不入库。
3. **导入不覆盖**：TradingView 的行号每次从 1 开始，导入时生成本系统自己的 ID；原始行号存 `source_ref` 供溯源。
4. **软删除**：`deleted_at` 列，默认查询过滤。

---

## 2. SQLite 数据库设计（DDL）

```sql
PRAGMA foreign_keys = ON;

-- 品种
CREATE TABLE symbols (
  id            TEXT PRIMARY KEY,              -- 如 'sym_01J...' (ULID)
  exchange      TEXT NOT NULL,                 -- 'BINANCE' / 'CME' / 'NASDAQ'
  code          TEXT NOT NULL,                 -- 'BTCUSDT' / 'ES' / 'AAPL'
  display_name  TEXT,                          -- '比特币/USDT 永续'
  asset_class   TEXT NOT NULL CHECK (asset_class IN ('crypto','forex','futures','stock')),
  tick_size     REAL NOT NULL DEFAULT 0.01,    -- 最小价格变动
  point_value   REAL NOT NULL DEFAULT 1,       -- 1 点的货币价值（期货合约乘数；现货=1）
  qty_step      REAL NOT NULL DEFAULT 1,       -- 数量最小步长（crypto 可为 0.001）
  created_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  UNIQUE (exchange, code)
);

-- 账户（交易环境/账本）
CREATE TABLE accounts (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,              -- '加密货币回测' / 'E-mini 实盘'
  kind             TEXT NOT NULL CHECK (kind IN ('backtest','live','paper')),
  base_currency    TEXT NOT NULL DEFAULT 'USD',
  initial_balance  REAL NOT NULL,              -- 初始虚拟资金
  default_timeframe TEXT NOT NULL DEFAULT '5m',-- 录入换算的默认周期
  description      TEXT,
  created_at       INTEGER NOT NULL,
  deleted_at       INTEGER
);

-- Period（trades collection）
CREATE TABLE periods (
  id               TEXT PRIMARY KEY,
  account_id       TEXT NOT NULL REFERENCES accounts(id),
  name             TEXT NOT NULL,              -- '2026年1月'
  -- 图表时间：这批交易在 K 线上发生的时间范围
  chart_start_at   INTEGER,
  chart_end_at     INTEGER,
  -- 真实时间：Leo 实际做回放/做单的时间范围（可为空、手动填写）
  real_start_at    INTEGER,
  real_end_at      INTEGER,
  description      TEXT,
  created_at       INTEGER NOT NULL,           -- 录入时间（系统决定）
  deleted_at       INTEGER
);
CREATE INDEX idx_periods_account ON periods(account_id);

-- Trade（仓位生命周期）
CREATE TABLE trades (
  id             TEXT PRIMARY KEY,
  period_id      TEXT NOT NULL REFERENCES periods(id),
  symbol_id      TEXT NOT NULL REFERENCES symbols(id),
  direction      TEXT NOT NULL CHECK (direction IN ('long','short')),
  status         TEXT NOT NULL CHECK (status IN ('open','closed')) DEFAULT 'closed',
  -- 冗余缓存列（由 executions 推导，导入/编辑后重算）
  opened_at      INTEGER NOT NULL,             -- 首个 execution 时间
  closed_at      INTEGER,                      -- 末个 execution 时间
  avg_entry      REAL,                         -- 加权入场均价
  avg_exit       REAL,                         -- 加权出场均价
  max_qty        REAL,                         -- 峰值仓位
  realized_pnl   REAL NOT NULL DEFAULT 0,      -- 已实现盈亏（货币）
  fees           REAL NOT NULL DEFAULT 0,
  -- R 值支持：初始止损（可由导入信号识别，也可事后补录）
  initial_sl     REAL,
  risk_amount    REAL,                         -- |avg_entry - initial_sl| * qty * point_value
  r_multiple     REAL,                         -- realized_pnl / risk_amount（risk 缺失则 NULL）
  strategy_tag   TEXT,                         -- 策略标签
  mistake_tags   TEXT,                         -- JSON 数组：错误标签
  review_note    TEXT,                         -- 简短复盘备注（长文用 notes 表 mention）
  chart_data_id  TEXT REFERENCES chart_data(id),
  source         TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','tradingview_import','api')),
  created_at     INTEGER NOT NULL,
  deleted_at     INTEGER
);
CREATE INDEX idx_trades_period ON trades(period_id);
CREATE INDEX idx_trades_symbol ON trades(symbol_id);
CREATE INDEX idx_trades_opened ON trades(opened_at);

-- Execution（原子成交）
CREATE TABLE executions (
  id           TEXT PRIMARY KEY,
  trade_id     TEXT NOT NULL REFERENCES trades(id),
  seq          INTEGER NOT NULL,               -- Trade 内顺序号，从 1 开始
  kind         TEXT NOT NULL CHECK (kind IN ('entry','scale_in','scale_out','exit')),
  order_type   TEXT CHECK (order_type IN ('market','limit','stop','stop_limit')),
  signal       TEXT,                           -- TradingView 信号原文：'TP'/'SL'/自定义
  executed_at  INTEGER NOT NULL,               -- UTC
  price        REAL NOT NULL,
  qty          REAL NOT NULL,                  -- 恒为正；方向由 trade.direction + kind 决定
  fee          REAL NOT NULL DEFAULT 0,
  source_ref   TEXT,                           -- 溯源：'tv:<import_id>:row:<n>'
  created_at   INTEGER NOT NULL,
  UNIQUE (trade_id, seq)
);
CREATE INDEX idx_executions_trade ON executions(trade_id);

-- 交易事件（SL/TP 移动时间线）
CREATE TABLE trade_events (
  id          TEXT PRIMARY KEY,
  trade_id    TEXT NOT NULL REFERENCES trades(id),
  event_type  TEXT NOT NULL CHECK (event_type IN ('sl_set','sl_moved','tp_set','tp_moved','note')),
  occurred_at INTEGER NOT NULL,
  price       REAL,                            -- 事件对应价格（sl/tp 位）
  detail      TEXT,                            -- 备注
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_trade_events_trade ON trade_events(trade_id);

-- 图表数据（OHLC + EMA20 序列，一段连续时间）
CREATE TABLE chart_data (
  id          TEXT PRIMARY KEY,
  symbol_id   TEXT NOT NULL REFERENCES symbols(id),
  timeframe   TEXT NOT NULL,                   -- '5m' 等
  start_at    INTEGER NOT NULL,
  end_at      INTEGER NOT NULL,
  bar_count   INTEGER NOT NULL,
  source      TEXT NOT NULL DEFAULT 'tradingview_export',
  created_at  INTEGER NOT NULL
);

-- 图表 K 线（大数据量，独立表 + 复合索引）
CREATE TABLE chart_bars (
  chart_data_id TEXT NOT NULL REFERENCES chart_data(id),
  ts            INTEGER NOT NULL,              -- bar 开盘 UTC 时间
  open  REAL NOT NULL, high REAL NOT NULL,
  low   REAL NOT NULL, close REAL NOT NULL,
  ema20 REAL,
  PRIMARY KEY (chart_data_id, ts)
) WITHOUT ROWID;

-- 附件（参考图等）
CREATE TABLE attachments (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('reference_image','screenshot','file')),
  file_path   TEXT NOT NULL,                   -- 相对 app data 目录路径
  mime_type   TEXT,
  trade_id    TEXT REFERENCES trades(id),      -- 可选归属
  period_id   TEXT REFERENCES periods(id),
  created_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);

-- 笔记（独立系统，内容内嵌 mention 语法）
CREATE TABLE notes (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,                   -- Markdown；mention 语法见 §5
  tags        TEXT,                            -- JSON 数组
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);

-- 笔记 mention 关系（冗余索引表，便于反查「哪些笔记提到了这个 trade」）
CREATE TABLE note_mentions (
  note_id     TEXT NOT NULL REFERENCES notes(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('trade','period','account','attachment')),
  target_id   TEXT NOT NULL,
  PRIMARY KEY (note_id, target_type, target_id)
);

-- 导入记录（溯源与回滚单位）
CREATE TABLE imports (
  id           TEXT PRIMARY KEY,
  period_id    TEXT NOT NULL REFERENCES periods(id),
  symbol_id    TEXT NOT NULL REFERENCES symbols(id),
  trades_file  TEXT,                           -- 原始文件保存路径
  chart_file   TEXT,
  ref_image_id TEXT REFERENCES attachments(id),
  status       TEXT NOT NULL CHECK (status IN ('pending','confirmed','rolled_back')),
  summary      TEXT,                           -- JSON：{rows, trades, executions, warnings[]}
  created_at   INTEGER NOT NULL
);
```

---

## 3. REST API 规范

Base URL：`http://127.0.0.1:<port>/api/v1` · 格式：JSON · 时间：ISO 8601 UTC 字符串。

错误响应统一：`{ "error": { "code": "NOT_FOUND", "message": "..." } }`

### 3.1 Symbols

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/symbols` | 列表，`?asset_class=&q=` |
| POST | `/symbols` | 创建 `{exchange, code, assetClass, tickSize, pointValue, qtyStep, displayName?}` |
| PATCH | `/symbols/:id` | 更新 |
| DELETE | `/symbols/:id` | 软删除（有关联 trade 时返回 409） |

### 3.2 Accounts & Periods

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/accounts` | 列表 + 汇总统计（`?include=stats`） |
| POST | `/accounts` | `{name, kind, initialBalance, baseCurrency?, defaultTimeframe?}` |
| GET | `/accounts/:id` | 详情 + stats + equity curve（`?include=equity`） |
| PATCH / DELETE | `/accounts/:id` | 更新 / 软删除 |
| GET | `/accounts/:id/periods` | 该账户下 Period 列表（含每个 period 的 PnL、胜率、真实时间） |
| POST | `/accounts/:id/periods` | `{name, chartStartAt?, chartEndAt?, realStartAt?, realEndAt?, description?}` |
| GET | `/periods/:id` | Period 详情 + stats + 按品种分组统计 |
| PATCH / DELETE | `/periods/:id` | 更新 / 软删除 |

### 3.3 Trades & Executions

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/trades` | 过滤：`?accountId=&periodId=&symbolId=&direction=&status=&from=&to=&sort=` |
| POST | `/trades` | 手动创建（含首个 entry execution） |
| GET | `/trades/:id` | 详情：executions、events、chartData 元信息、mentions 反查 |
| PATCH | `/trades/:id` | 补录 `initialSl`、strategy/mistake tags、reviewNote 等；改 initialSl 触发 R 重算 |
| DELETE | `/trades/:id` | 软删除（级联软删 executions/events） |
| POST | `/trades/:id/executions` | 追加成交 `{kind, orderType?, executedAt \| barInput, price, qty, fee?}` |
| PATCH / DELETE | `/executions/:id` | 修改 / 删除单笔成交（触发 Trade 缓存列重算） |
| POST | `/trades/:id/events` | 记录 SL/TP 移动 `{eventType, occurredAt, price?, detail?}` |
| POST | `/trades/merge` | `{tradeIds: [...]}` 将多个 trade 合并为一个（导入归组修正用） |
| POST | `/trades/:id/split` | `{executionIds: [...]}` 拆出新 trade |

**Bar 快速录入**：`barInput: { date: '2026-01-15', timeframe: '5m', barIndex: 130 }` → 服务端换算 `executedAt = date UTC 00:00 + barIndex * tf`（barIndex 从 0 开始）。响应中回显换算后的时间供前端确认。

### 3.4 Chart Data

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/chart-data/:id/bars` | `?from=&to=` 返回 OHLC+EMA20 数组（Lightweight Charts 直接可用格式） |
| POST | `/chart-data` | 通常由导入管线创建；也可单独上传 CSV |

### 3.5 Import（三文件导入管线）

```
POST /imports              -- multipart: tradesFile(csv/xlsx), chartFile(csv), refImage(png/jpg)?
                           -- fields: periodId, symbolId, timeframe
  → 202 { importId, preview: { rows, proposedTrades: [...], warnings: [...] } }

GET  /imports/:id/preview  -- 归组预览：每个 proposed trade 及其 executions、识别出的 SL/TP
PATCH /imports/:id/preview -- 手动调整归组（移动某行到另一组 / 合并 / 拆分）
POST /imports/:id/confirm  -- 落库；创建 trades + executions + chart_data + attachment
POST /imports/:id/rollback -- 整批回滚（按 source_ref 删除）
```

### 3.6 Notes & Attachments

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/notes` | `?q=&tag=&mentionType=&mentionId=` |
| POST / PATCH / DELETE | `/notes(/:id)` | 保存时服务端解析 mention 语法，重建 `note_mentions` |
| POST | `/attachments` | multipart 上传，存本地 `attachments/` 目录 |
| GET | `/attachments/:id/file` | 返回文件流 |

### 3.7 Analytics

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/analytics/equity` | `?accountId=&periodId=&tradeIds=` → 资金曲线点集 + maxDrawdown |
| GET | `/analytics/stats` | 同过滤 → 胜率、profitFactor、期望值、平均盈/亏、R 分布、连亏 |
| GET | `/analytics/by-symbol` | 按品种分组表现 |
| GET | `/analytics/by-time` | 按星期/UTC 时段热力数据 |

---

## 4. TradingView 导入管线与归组算法

### 4.1 输入

1. **交易记录文件**（TradingView 策略/回放导出）：列包括 `Trade #`（每次从 1 开始，仅作 source_ref）、`Type`（多头进场/多头出场/空头进场/空头出场）、`Signal`（TP/SL/自定义）、`Date/Time`、`Price`、`Qty`。
2. **图表数据文件**：`time, open, high, low, close, EMA20` 的 CSV。
3. **参考图**（可选）：整段行情含订单标记的截图，作为最后 backup。

### 4.2 解析与规范化

- 所有时间解析为 UTC；若文件带时区偏移则换算。
- `Type` 映射：`多头进场→(long, entry/scale_in)`、`多头出场→(long, scale_out/exit)`，空头同理。
- `Signal` 含 `SL/Stop` → 推断该出场为止损单，且该 SL 价可回填 `initial_sl`（若为首个 SL）。

### 4.3 归组算法（Execution → Trade）

对同一品种按时间排序后维护「净持仓」状态机：

```
position = 0
for row in rows (按时间升序):
  delta = row.qty * (进场 ? +1 : -1) * (多头 ? +1 : -1 视方向规范化)
  if position == 0 and delta != 0:
      开新 Trade（direction 由 delta 符号决定）
  当前行归入当前 Trade 作为 execution:
      position == 0 时为 entry；同向增加为 scale_in；
      反向减少且 position 仍非 0 为 scale_out；归零为 exit
  position += delta
  if position == 0: 关闭当前 Trade
```

边界处理：

- **同 bar 双向**（先平后开）：按行序处理，归零即切分。
- **数据缺口**（首行即出场）：产生 warning，允许用户在预览中丢弃或手动补入场。
- **预览可修正**：UI 中可将任意 execution 拖到相邻组、合并组、拆分组，确认后才落库。

### 4.4 缓存列重算（任何 execution 变化后）

```
avg_entry = Σ(entry/scale_in: price*qty) / Σ(qty)
avg_exit  = Σ(scale_out/exit: price*qty) / Σ(qty)
realized_pnl = (avg_exit - avg_entry) * closed_qty * point_value * (long ? +1 : -1) - fees
max_qty   = 持仓状态机过程中的峰值
r_multiple = initial_sl 存在时：realized_pnl / (|avg_entry - initial_sl| * max_qty * point_value)
```

---

## 5. 笔记 mention 语法

Markdown 内嵌；服务端保存时用正则解析并重建 `note_mentions`：

```
@[trade:tr_01J8...]        → 渲染为 Trade 卡片链接（品种/方向/PnL）
@[period:per_01J8...]      → Period 链接
@[account:acc_01J8...]     → Account 链接
@[img:att_01J8...]         → 内联图片
```

---

## 6. 指标计算公式

设过滤后的已平仓交易集合为 T，初始资金 B₀（取 Account 的 `initial_balance`）：

- **资金曲线**：按 `closed_at` 升序，$$E_k = B_0 + \sum_{i \le k} pnl_i$$
- **最大回撤**：$$MDD = \max_k \left( \frac{\max_{j \le k} E_j - E_k}{\max_{j \le k} E_j} \right)$$
- **胜率**：win / (win + loss)，`pnl == 0` 记为 breakeven 不计入分母（可配置）
- **Profit Factor**：$$PF = \frac{\sum pnl^+}{\left| \sum pnl^- \right|}$$
- **期望值**：$$EV = winRate \times avgWin - lossRate \times |avgLoss|$$
- **R 统计**：仅对 `r_multiple IS NOT NULL` 的交易统计（均值、分布直方图）；未补录初始止损的交易不参与，避免污染。
- **连续亏损**：按时间序最长连亏计数。

---

## 7. 未来扩展预留

- **API 自动同步**：`trades.source = 'api'` 已预留；新增 `sync_connections` 表（交易所密钥、游标）即可接入，归组算法复用 §4.3。
- **多指标图表数据**：`chart_bars` 可加列或改为 `chart_indicators(chart_data_id, ts, name, value)` 长表。
- **仓位单位规范**：期货以「手」为 qty，`point_value` 承担换算；crypto 以币数量为 qty。若未来要支持杠杆/保证金视角，增加 `accounts.margin_mode` 与快照表。
- **全文搜索**：notes 可加 FTS5 虚表 `notes_fts`。

---

## 8. 前端现状与后端对接说明

当前前端使用 `lib/mock-data.ts` 作为数据源，`lib/types.ts` 中的 TypeScript 类型与本文档的表结构一一对应（camelCase ↔ snake_case）。对接真实后端时：

1. 用 SWR 将各页面数据源替换为 §3 的 REST 端点。
2. `lib/metrics.ts` 的计算逻辑与 §6 公式一致，可直接移植到后端（Node/Rust）。
3. `lib/bar-time.ts` 的 bar ↔ UTC 换算即 §3.3 `barInput` 的参考实现。
4. `lib/chart-data.ts` 的合成数据替换为 `GET /chart-data/:id/bars`。
