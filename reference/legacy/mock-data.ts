/**
 * Mock 数据：2 个 Account、4 个 Period、20 个 Trade（含 scale in/out、分批止盈、移动止损、未平仓等案例）。
 * 后端就绪后，本文件将被 REST API 调用替换（见 docs/backend-design.md）。
 */

import type { Account, Period, TradingSymbol, Trade, Execution, TradeEvent, Note } from './types'

const T = (iso: string) => Date.parse(iso)

/* ---------- Symbols ---------- */

export const symbols: TradingSymbol[] = [
  { id: 'sym-btc', exchange: 'BINANCE', code: 'BTCUSDT', name: 'Bitcoin / TetherUS', category: 'crypto', pricePrecision: 1 },
  { id: 'sym-eth', exchange: 'BINANCE', code: 'ETHUSDT', name: 'Ethereum / TetherUS', category: 'crypto', pricePrecision: 2 },
  { id: 'sym-es', exchange: 'CME', code: 'ES1!', name: 'E-mini S&P 500 期货', category: 'futures', pricePrecision: 2 },
  { id: 'sym-xau', exchange: 'OANDA', code: 'XAUUSD', name: '黄金 / 美元', category: 'forex', pricePrecision: 2 },
]

/* ---------- Accounts ---------- */

export const accounts: Account[] = [
  {
    id: 'acc-crypto-bt',
    name: 'Crypto 回测',
    kind: 'backtest',
    initialBalance: 100_000,
    currency: 'USD',
    note: '5 分钟级别日内策略，K 线回放训练用。',
    createdAt: T('2025-08-01T00:00:00Z'),
  },
  {
    id: 'acc-es-live',
    name: 'E-mini 实盘',
    kind: 'live',
    initialBalance: 50_000,
    currency: 'USD',
    note: 'CME E-mini S&P 500，小仓位实盘。',
    createdAt: T('2025-12-01T00:00:00Z'),
  },
]

/* ---------- Periods ---------- */

export const periods: Period[] = [
  {
    id: 'per-2601',
    accountId: 'acc-crypto-bt',
    name: '2026年1月',
    chartStart: T('2026-01-01T00:00:00Z'),
    chartEnd: T('2026-01-31T23:59:59Z'),
    realStart: T('2026-01-03T00:00:00Z'),
    realEnd: T('2026-02-02T00:00:00Z'),
    symbolIds: ['sym-btc', 'sym-eth'],
    note: '主做 BTC 日内突破回踩，ETH 辅助。',
    createdAt: T('2026-01-03T09:00:00Z'),
  },
  {
    id: 'per-2508',
    accountId: 'acc-crypto-bt',
    name: '2025年8月（回放）',
    chartStart: T('2025-08-01T00:00:00Z'),
    chartEnd: T('2025-08-31T23:59:59Z'),
    realStart: T('2026-02-10T00:00:00Z'),
    realEnd: T('2026-02-20T00:00:00Z'),
    symbolIds: ['sym-btc'],
    note: '回头补做 2025 年 8 月行情，验证策略在震荡市的表现。',
    createdAt: T('2026-02-10T10:00:00Z'),
  },
  {
    id: 'per-es-2601',
    accountId: 'acc-es-live',
    name: '2026年1月',
    chartStart: T('2026-01-05T00:00:00Z'),
    chartEnd: T('2026-01-30T23:59:59Z'),
    realStart: T('2026-01-05T00:00:00Z'),
    realEnd: T('2026-01-30T23:59:59Z'),
    symbolIds: ['sym-es'],
    createdAt: T('2026-01-05T14:00:00Z'),
  },
  {
    id: 'per-es-2512',
    accountId: 'acc-es-live',
    name: '2025年12月',
    chartStart: T('2025-12-01T00:00:00Z'),
    chartEnd: T('2025-12-31T23:59:59Z'),
    realStart: T('2025-12-01T00:00:00Z'),
    realEnd: T('2025-12-31T23:59:59Z'),
    symbolIds: ['sym-es'],
    note: '实盘第一个月，只做最标准的形态。',
    createdAt: T('2025-12-01T15:00:00Z'),
  },
]

/* ---------- Trade 构建辅助 ---------- */

type ExecSpec = [action: Execution['action'], orderType: Execution['orderType'], iso: string, price: number, qty: number, signal?: string]
type EventSpec = [type: TradeEvent['type'], iso: string, price: number, note?: string]

interface TradeSpec {
  id: string
  seq: number
  accountId: string
  periodId: string
  symbolId: string
  direction: Trade['direction']
  status?: Trade['status']
  initialStopLoss?: number
  execs: ExecSpec[]
  events?: EventSpec[]
  tags?: string[]
  note?: string
  referenceImages?: string[]
}

function makeTrade(s: TradeSpec): Trade {
  return {
    id: s.id,
    seq: s.seq,
    accountId: s.accountId,
    periodId: s.periodId,
    symbolId: s.symbolId,
    direction: s.direction,
    status: s.status ?? 'closed',
    initialStopLoss: s.initialStopLoss,
    executions: s.execs.map(([action, orderType, iso, price, quantity, signal], i) => ({
      id: `${s.id}-e${i + 1}`,
      tradeId: s.id,
      action,
      orderType,
      time: T(iso),
      price,
      quantity,
      signal,
    })),
    events: (s.events ?? []).map(([type, iso, price, note], i) => ({
      id: `${s.id}-ev${i + 1}`,
      tradeId: s.id,
      type,
      time: T(iso),
      price,
      note,
    })),
    referenceImages: s.referenceImages ?? [],
    tags: s.tags ?? [],
    note: s.note,
    createdAt: T(s.execs[0][2]),
  }
}

/* ---------- Trades ---------- */

export const trades: Trade[] = [
  // ===== per-2601：Crypto 回测 2026年1月（BTC + ETH）=====
  makeTrade({
    id: 'tr-001', seq: 1, accountId: 'acc-crypto-bt', periodId: 'per-2601', symbolId: 'sym-btc',
    direction: 'long', initialStopLoss: 96850,
    execs: [
      ['entry', 'stop', '2026-01-05T08:35:00Z', 97420, 0.5, 'Breakout Entry'],
      ['exit', 'take-profit', '2026-01-05T13:10:00Z', 98960, 0.5, 'TP1'],
    ],
    events: [
      ['sl-set', '2026-01-05T08:35:00Z', 96850, '初始止损放在回踩低点下方'],
      ['sl-moved', '2026-01-05T11:20:00Z', 97500, '价格站稳前高，止损上移至成本上方'],
    ],
    tags: ['突破回踩', 'A+ 形态'],
    note: '标准的日内突破回踩，入场后走势顺畅。',
    referenceImages: ['/images/ref-chart-1.png'],
  }),
  makeTrade({
    id: 'tr-002', seq: 2, accountId: 'acc-crypto-bt', periodId: 'per-2601', symbolId: 'sym-btc',
    direction: 'long', initialStopLoss: 98100,
    execs: [
      ['entry', 'limit', '2026-01-07T02:15:00Z', 98620, 0.4, 'Pullback Entry'],
      ['scale-in', 'limit', '2026-01-07T03:40:00Z', 98450, 0.3, 'Add'],
      ['scale-out', 'take-profit', '2026-01-07T07:05:00Z', 99680, 0.35, 'TP1'],
      ['exit', 'take-profit', '2026-01-07T09:30:00Z', 100420, 0.35, 'TP2'],
    ],
    events: [
      ['sl-set', '2026-01-07T02:15:00Z', 98100],
      ['sl-moved', '2026-01-07T06:00:00Z', 98700, 'TP1 前止损上移到保本'],
      ['tp-set', '2026-01-07T02:15:00Z', 99680, 'TP1'],
      ['tp-moved', '2026-01-07T07:10:00Z', 100420, '剩余仓位目标上移至整数关口'],
    ],
    tags: ['分批止盈', '加仓'],
    note: '典型的 scale in + 分批止盈案例：回踩加仓后分两批离场。',
    referenceImages: ['/images/ref-chart-1.png', '/images/ref-chart-2.png'],
  }),
  makeTrade({
    id: 'tr-003', seq: 3, accountId: 'acc-crypto-bt', periodId: 'per-2601', symbolId: 'sym-btc',
    direction: 'short', initialStopLoss: 101350,
    execs: [
      ['entry', 'stop', '2026-01-09T14:20:00Z', 100780, 0.6, 'Breakdown Entry'],
      ['exit', 'stop-loss', '2026-01-09T15:45:00Z', 101360, 0.6, 'SL'],
    ],
    events: [['sl-set', '2026-01-09T14:20:00Z', 101350]],
    tags: ['假突破', '止损'],
    note: '跌破颈线做空被扫，事后看是假突破。教训：14:00 后流动性差，慎做突破。',
  }),
  makeTrade({
    id: 'tr-004', seq: 4, accountId: 'acc-crypto-bt', periodId: 'per-2601', symbolId: 'sym-eth',
    direction: 'long', initialStopLoss: 3282,
    execs: [
      ['entry', 'market', '2026-01-12T06:50:00Z', 3318.5, 8, 'Manual Entry'],
      ['scale-out', 'take-profit', '2026-01-12T10:15:00Z', 3376, 4, 'TP1'],
      ['exit', 'market', '2026-01-12T12:40:00Z', 3401.5, 4, 'Manual Exit'],
    ],
    events: [
      ['sl-set', '2026-01-12T06:50:00Z', 3282],
      ['sl-moved', '2026-01-12T10:20:00Z', 3320, 'TP1 后推保本'],
    ],
    tags: ['趋势跟随', '分批止盈'],
    referenceImages: ['/images/ref-chart-2.png'],
  }),
  makeTrade({
    id: 'tr-005', seq: 5, accountId: 'acc-crypto-bt', periodId: 'per-2601', symbolId: 'sym-btc',
    direction: 'long', initialStopLoss: 99400,
    execs: [
      ['entry', 'limit', '2026-01-14T04:05:00Z', 99880, 0.5, 'Pullback Entry'],
      ['exit', 'stop-loss', '2026-01-14T05:30:00Z', 99410, 0.5, 'SL'],
    ],
    events: [['sl-set', '2026-01-14T04:05:00Z', 99400]],
    tags: ['止损'],
    note: '回踩买入直接被打损，趋势已转弱仍勉强做多。',
  }),
  makeTrade({
    id: 'tr-006', seq: 6, accountId: 'acc-crypto-bt', periodId: 'per-2601', symbolId: 'sym-btc',
    direction: 'short', initialStopLoss: 99950,
    execs: [
      ['entry', 'stop', '2026-01-14T08:45:00Z', 99320, 0.5, 'Breakdown Entry'],
      ['scale-out', 'take-profit', '2026-01-14T11:10:00Z', 98510, 0.25, 'TP1'],
      ['exit', 'take-profit', '2026-01-14T14:55:00Z', 97840, 0.25, 'TP2'],
    ],
    events: [
      ['sl-set', '2026-01-14T08:45:00Z', 99950],
      ['sl-moved', '2026-01-14T11:15:00Z', 99320, 'TP1 后推保本'],
      ['sl-moved', '2026-01-14T13:30:00Z', 98700, '跟随 EMA20 下移'],
    ],
    tags: ['趋势跟随', '分批止盈', 'A+ 形态'],
    note: '上午止损后耐心等到趋势反转确认再入场，执行满分。',
    referenceImages: ['/images/ref-chart-1.png'],
  }),
  makeTrade({
    id: 'tr-007', seq: 7, accountId: 'acc-crypto-bt', periodId: 'per-2601', symbolId: 'sym-eth',
    direction: 'short',
    execs: [
      ['entry', 'market', '2026-01-16T09:25:00Z', 3455, 6, 'Manual Entry'],
      ['exit', 'market', '2026-01-16T10:05:00Z', 3462.5, 6, 'Manual Exit'],
    ],
    tags: ['情绪单'],
    note: '看 BTC 走弱顺手空 ETH，没有计划、没有止损，很快认错离场。R 无法计算（未设初始止损），需要引以为戒。',
  }),
  makeTrade({
    id: 'tr-008', seq: 8, accountId: 'acc-crypto-bt', periodId: 'per-2601', symbolId: 'sym-btc',
    direction: 'long', initialStopLoss: 96200,
    execs: [
      ['entry', 'limit', '2026-01-20T03:30:00Z', 96780, 0.4, 'Pullback Entry'],
      ['scale-in', 'stop', '2026-01-20T05:55:00Z', 97350, 0.4, 'Breakout Add'],
      ['scale-out', 'take-profit', '2026-01-20T09:20:00Z', 98240, 0.4, 'TP1'],
      ['exit', 'stop-loss', '2026-01-20T12:45:00Z', 97620, 0.4, 'Trailing SL'],
    ],
    events: [
      ['sl-set', '2026-01-20T03:30:00Z', 96200],
      ['sl-moved', '2026-01-20T06:00:00Z', 96800, '突破加仓后整体止损上移'],
      ['sl-moved', '2026-01-20T09:25:00Z', 97620, 'TP1 后改为移动止损'],
    ],
    tags: ['加仓', '移动止损'],
    note: '两段式建仓，尾仓被移动止损带走，整体盈利。',
    referenceImages: ['/images/ref-chart-2.png'],
  }),
  makeTrade({
    id: 'tr-009', seq: 9, accountId: 'acc-crypto-bt', periodId: 'per-2601', symbolId: 'sym-btc',
    direction: 'long', initialStopLoss: 97900,
    execs: [
      ['entry', 'stop', '2026-01-26T07:40:00Z', 98460, 0.5, 'Breakout Entry'],
      ['exit', 'take-profit', '2026-01-26T16:20:00Z', 100150, 0.5, 'TP1'],
    ],
    events: [
      ['sl-set', '2026-01-26T07:40:00Z', 97900],
      ['sl-moved', '2026-01-26T12:00:00Z', 98460, '推保本'],
    ],
    tags: ['突破回踩', 'A+ 形态'],
  }),
  makeTrade({
    id: 'tr-010', seq: 10, accountId: 'acc-crypto-bt', periodId: 'per-2601', symbolId: 'sym-eth',
    direction: 'long', status: 'open', initialStopLoss: 3395,
    execs: [
      ['entry', 'limit', '2026-01-29T05:10:00Z', 3428, 6, 'Pullback Entry'],
      ['scale-out', 'take-profit', '2026-01-29T11:35:00Z', 3491, 3, 'TP1'],
    ],
    events: [
      ['sl-set', '2026-01-29T05:10:00Z', 3395],
      ['sl-moved', '2026-01-29T11:40:00Z', 3430, 'TP1 后推保本'],
    ],
    tags: ['分批止盈'],
    note: '剩余半仓持有中，跟随 4H EMA20 移动止损。',
  }),

  // ===== per-2508：Crypto 回测 2025年8月（回放，乱序导入案例）=====
  makeTrade({
    id: 'tr-011', seq: 11, accountId: 'acc-crypto-bt', periodId: 'per-2508', symbolId: 'sym-btc',
    direction: 'long', initialStopLoss: 61250,
    execs: [
      ['entry', 'stop', '2025-08-04T09:15:00Z', 61780, 0.8, 'Breakout Entry'],
      ['exit', 'stop-loss', '2025-08-04T10:40:00Z', 61260, 0.8, 'SL'],
    ],
    events: [['sl-set', '2025-08-04T09:15:00Z', 61250]],
    tags: ['止损', '震荡市'],
    note: '8 月是典型震荡市，突破策略胜率明显下降。',
  }),
  makeTrade({
    id: 'tr-012', seq: 12, accountId: 'acc-crypto-bt', periodId: 'per-2508', symbolId: 'sym-btc',
    direction: 'short', initialStopLoss: 62480,
    execs: [
      ['entry', 'limit', '2025-08-07T13:50:00Z', 62150, 0.8, 'Range High Fade'],
      ['exit', 'take-profit', '2025-08-08T02:25:00Z', 60890, 0.8, 'TP1'],
    ],
    events: [
      ['sl-set', '2025-08-07T13:50:00Z', 62480],
      ['sl-moved', '2025-08-07T20:00:00Z', 62150, '推保本过夜'],
    ],
    tags: ['区间交易', 'A+ 形态'],
    note: '震荡市改用区间高抛低吸，效果好很多。',
    referenceImages: ['/images/ref-chart-1.png'],
  }),
  makeTrade({
    id: 'tr-013', seq: 13, accountId: 'acc-crypto-bt', periodId: 'per-2508', symbolId: 'sym-btc',
    direction: 'long', initialStopLoss: 59850,
    execs: [
      ['entry', 'limit', '2025-08-12T06:30:00Z', 60240, 0.8, 'Range Low Entry'],
      ['scale-out', 'take-profit', '2025-08-12T14:05:00Z', 61120, 0.4, 'TP1'],
      ['exit', 'take-profit', '2025-08-13T01:50:00Z', 61780, 0.4, 'TP2'],
    ],
    events: [
      ['sl-set', '2025-08-12T06:30:00Z', 59850],
      ['sl-moved', '2025-08-12T14:10:00Z', 60240, 'TP1 后推保本'],
    ],
    tags: ['区间交易', '分批止盈'],
  }),
  makeTrade({
    id: 'tr-014', seq: 14, accountId: 'acc-crypto-bt', periodId: 'per-2508', symbolId: 'sym-btc',
    direction: 'short', initialStopLoss: 61980,
    execs: [
      ['entry', 'limit', '2025-08-18T15:10:00Z', 61650, 0.8, 'Range High Fade'],
      ['exit', 'stop-loss', '2025-08-18T18:35:00Z', 61990, 0.8, 'SL'],
    ],
    events: [['sl-set', '2025-08-18T15:10:00Z', 61980]],
    tags: ['区间交易', '止损'],
  }),
  makeTrade({
    id: 'tr-015', seq: 15, accountId: 'acc-crypto-bt', periodId: 'per-2508', symbolId: 'sym-btc',
    direction: 'long', initialStopLoss: 62100,
    execs: [
      ['entry', 'stop', '2025-08-22T08:00:00Z', 62680, 1.0, 'Breakout Entry'],
      ['scale-out', 'take-profit', '2025-08-22T13:25:00Z', 63840, 0.5, 'TP1'],
      ['exit', 'take-profit', '2025-08-23T04:15:00Z', 65120, 0.5, 'TP2'],
    ],
    events: [
      ['sl-set', '2025-08-22T08:00:00Z', 62100],
      ['sl-moved', '2025-08-22T13:30:00Z', 62680, 'TP1 后推保本'],
      ['sl-moved', '2025-08-22T22:00:00Z', 63500, '跟随结构低点上移'],
    ],
    tags: ['突破回踩', '分批止盈', 'A+ 形态'],
    note: '月底区间突破转趋势，本月最大盈利单。',
    referenceImages: ['/images/ref-chart-2.png'],
  }),
  makeTrade({
    id: 'tr-016', seq: 16, accountId: 'acc-crypto-bt', periodId: 'per-2508', symbolId: 'sym-btc',
    direction: 'long',
    execs: [
      ['entry', 'market', '2025-08-28T11:45:00Z', 64850, 0.5, 'Manual Entry'],
      ['exit', 'market', '2025-08-28T13:20:00Z', 64620, 0.5, 'Manual Exit'],
    ],
    tags: ['追高', '情绪单'],
    note: '追高失败，未设止损手动认错。之后补录初始止损用于 R 统计。',
  }),

  // ===== per-es-2601：E-mini 实盘 2026年1月 =====
  makeTrade({
    id: 'tr-017', seq: 17, accountId: 'acc-es-live', periodId: 'per-es-2601', symbolId: 'sym-es',
    direction: 'long', initialStopLoss: 6082,
    execs: [
      ['entry', 'stop', '2026-01-06T14:45:00Z', 6094.5, 2, 'ORB Long'],
      ['exit', 'take-profit', '2026-01-06T17:30:00Z', 6112.25, 2, 'TP1'],
    ],
    events: [
      ['sl-set', '2026-01-06T14:45:00Z', 6082],
      ['sl-moved', '2026-01-06T16:00:00Z', 6095, '推保本'],
    ],
    tags: ['开盘区间突破'],
    note: '开盘区间突破（ORB），美股开盘后第一小时执行。',
  }),
  makeTrade({
    id: 'tr-018', seq: 18, accountId: 'acc-es-live', periodId: 'per-es-2601', symbolId: 'sym-es',
    direction: 'short', initialStopLoss: 6128.5,
    execs: [
      ['entry', 'stop', '2026-01-13T15:10:00Z', 6117.75, 2, 'Breakdown Entry'],
      ['exit', 'stop-loss', '2026-01-13T15:55:00Z', 6128.75, 2, 'SL'],
    ],
    events: [['sl-set', '2026-01-13T15:10:00Z', 6128.5]],
    tags: ['止损'],
    note: 'CPI 数据日不该做突破，被 V 型反转扫损。',
  }),
  makeTrade({
    id: 'tr-019', seq: 19, accountId: 'acc-es-live', periodId: 'per-es-2601', symbolId: 'sym-es',
    direction: 'long', initialStopLoss: 6135,
    execs: [
      ['entry', 'limit', '2026-01-21T15:35:00Z', 6147.25, 1, 'Pullback Entry'],
      ['scale-in', 'limit', '2026-01-21T16:20:00Z', 6142.5, 1, 'Add'],
      ['exit', 'take-profit', '2026-01-21T19:45:00Z', 6171, 2, 'TP1'],
    ],
    events: [
      ['sl-set', '2026-01-21T15:35:00Z', 6135],
      ['sl-moved', '2026-01-21T17:30:00Z', 6145, '整体推至成本附近'],
    ],
    tags: ['趋势跟随', '加仓'],
    referenceImages: ['/images/ref-chart-1.png'],
  }),

  // ===== per-es-2512：E-mini 实盘 2025年12月 =====
  makeTrade({
    id: 'tr-020', seq: 20, accountId: 'acc-es-live', periodId: 'per-es-2512', symbolId: 'sym-es',
    direction: 'long', initialStopLoss: 6018,
    execs: [
      ['entry', 'stop', '2025-12-10T14:50:00Z', 6027.5, 1, 'ORB Long'],
      ['exit', 'take-profit', '2025-12-10T18:05:00Z', 6046.25, 1, 'TP1'],
    ],
    events: [
      ['sl-set', '2025-12-10T14:50:00Z', 6018],
    ],
    tags: ['开盘区间突破', 'A+ 形态'],
    note: '实盘第一笔，严格按计划执行。',
  }),
]

/* ---------- Notes ---------- */

export const notes: Note[] = [
  {
    id: 'note-001',
    title: '一月复盘：突破策略在趋势日的执行',
    content:
      '这个月最好的两笔单子 [[trade:tr-002]] 和 [[trade:tr-006]] 有一个共同点：**都是在第一次信号失败后等来的第二次机会**。\n\n' +
      '尤其是 [[trade:tr-006]]，上午做多被打损（[[trade:tr-005]]），说明趋势已经转弱。没有急着报复性交易，而是等到跌破关键位再反手做空——这才是这套系统该有的样子。\n\n' +
      '参考图：[[image:/images/ref-chart-1.png]]\n\n' +
      '### 需要改进\n\n- 14:00 之后流动性变差，突破单胜率低（见 [[trade:tr-003]]），下月开始 14:00 后只做区间。\n- [[trade:tr-007]] 这种没有止损的情绪单必须杜绝，哪怕亏得少。',
    tags: ['月度复盘', '策略'],
    mentions: [
      { type: 'trade', ref: 'tr-002' },
      { type: 'trade', ref: 'tr-006' },
      { type: 'trade', ref: 'tr-005' },
      { type: 'trade', ref: 'tr-003' },
      { type: 'trade', ref: 'tr-007' },
      { type: 'image', ref: '/images/ref-chart-1.png' },
    ],
    createdAt: T('2026-02-01T09:30:00Z'),
    updatedAt: T('2026-02-02T14:10:00Z'),
  },
  {
    id: 'note-002',
    title: '震荡市 vs 趋势市：8 月回放的启发',
    content:
      '回放 2025 年 8 月的行情验证了一个假设：**突破策略在震荡市会持续失血**。\n\n' +
      '前两周硬做突破连续止损（[[trade:tr-011]]），切换到区间高抛低吸后立刻好转（[[trade:tr-012]]、[[trade:tr-013]]）。\n\n' +
      '月底区间突破转趋势的那笔 [[trade:tr-015]] 是本月最大盈利，说明**区间末端的突破才值得做**。\n\n' +
      '下一步：整理一个「市场状态判断清单」，开盘前先定性今天是趋势日还是震荡日。',
    tags: ['回放', '策略', '市场状态'],
    mentions: [
      { type: 'trade', ref: 'tr-011' },
      { type: 'trade', ref: 'tr-012' },
      { type: 'trade', ref: 'tr-013' },
      { type: 'trade', ref: 'tr-015' },
    ],
    createdAt: T('2026-02-20T16:00:00Z'),
    updatedAt: T('2026-02-20T16:00:00Z'),
  },
  {
    id: 'note-003',
    title: '实盘手记：数据日纪律',
    content:
      'CPI 日被扫损（[[trade:tr-018]]）之后定的规矩：\n\n1. 重要数据公布前后 30 分钟不进场\n2. 数据日仓位减半\n3. 数据日只做数据方向确认后的回踩，不做第一波\n\n参考图：[[image:/images/ref-chart-2.png]]',
    tags: ['实盘', '纪律'],
    mentions: [
      { type: 'trade', ref: 'tr-018' },
      { type: 'image', ref: '/images/ref-chart-2.png' },
    ],
    createdAt: T('2026-01-14T21:00:00Z'),
    updatedAt: T('2026-01-14T21:00:00Z'),
  },
]

/* ---------- 查询辅助 ---------- */

export function getAccount(id: string) {
  return accounts.find((a) => a.id === id)
}

export function getPeriod(id: string) {
  return periods.find((p) => p.id === id)
}

export function getSymbol(id: string) {
  return symbols.find((s) => s.id === id)
}

export function getTrade(id: string) {
  return trades.find((t) => t.id === id)
}

export function getPeriodsByAccount(accountId: string) {
  return periods.filter((p) => p.accountId === accountId)
}

export function getTradesByAccount(accountId: string) {
  return trades.filter((t) => t.accountId === accountId)
}

export function getTradesByPeriod(periodId: string) {
  return trades.filter((t) => t.periodId === periodId)
}

export function getNotesMentioningTrade(tradeId: string) {
  return notes.filter((n) => n.mentions.some((m) => m.type === 'trade' && m.ref === tradeId))
}

export function symbolLabel(symbolId: string) {
  const s = getSymbol(symbolId)
  return s ? `${s.exchange}:${s.code}` : symbolId
}
