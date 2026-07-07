/**
 * Cairn 核心数据模型
 * 层级：Account → Period → Trade → Execution
 * 所有时间统一为 UTC epoch 毫秒；bar 序号仅作录入辅助，不入库。
 */

export type AccountKind = 'backtest' | 'live'

export interface Account {
  id: string
  name: string
  kind: AccountKind
  /** 初始资金（账户货币单位） */
  initialBalance: number
  currency: string
  note?: string
  createdAt: number
}

export interface Period {
  id: string
  accountId: string
  /** 例如「2026年1月」 */
  name: string
  /** 图表时间范围（chart time，UTC ms） */
  chartStart: number
  chartEnd: number
  /** 真实操作时间（real trading time，可选，UTC ms） */
  realStart?: number
  realEnd?: number
  /** 本 Period 涉及的品种 */
  symbolIds: string[]
  note?: string
  createdAt: number
}

export type SymbolCategory = 'crypto' | 'forex' | 'futures' | 'stock'

export interface TradingSymbol {
  id: string
  /** 交易所/来源，如 BINANCE、CME、NASDAQ */
  exchange: string
  /** 代码，如 BTCUSDT、ES1!、AAPL */
  code: string
  name: string
  category: SymbolCategory
  /** 价格小数位 */
  pricePrecision: number
}

export type TradeDirection = 'long' | 'short'
export type TradeStatus = 'open' | 'closed'

/** 标签七色：红橙黄绿青蓝紫 */
export type TagColor = 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'blue' | 'purple'

export interface TagDef {
  id: string
  /** 标签名（trade.tags 中引用的即为此名称） */
  name: string
  color: TagColor
  createdAt: number
}

export type ExecutionAction = 'entry' | 'scale-in' | 'scale-out' | 'exit'
export type OrderType = 'market' | 'limit' | 'stop' | 'stop-loss' | 'take-profit'

export interface Execution {
  id: string
  tradeId: string
  action: ExecutionAction
  orderType: OrderType
  /** UTC epoch ms */
  time: number
  price: number
  /** 数量（正数；方向由 trade + action 决定） */
  quantity: number
  /** TradingView 原始信号文本，如 "TP1" / "SL" */
  signal?: string
  note?: string
}

export type TradeEventType = 'sl-move' | 'tp-move' | 'sl-set' | 'tp-set'

export interface TradeEvent {
  id: string
  tradeId: string
  type: TradeEventType
  time: number
  price: number
  note?: string
}

export interface Trade {
  id: string
  /** 全局自增编号（解决 TradingView 每次从 1 开始的问题） */
  seq: number
  accountId: string
  periodId: string
  symbolId: string
  direction: TradeDirection
  status: TradeStatus
  /** 初始止损价（R 计算基准；可后补） */
  initialStopLoss?: number
  executions: Execution[]
  events: TradeEvent[]
  /** 参考图（备份截图）地址 */
  referenceImages: string[]
  tags: string[]
  note?: string
  createdAt: number
}

/** 单根 K 线（含 EMA20），来自导入的图表数据 */
export interface ChartBar {
  /** UTC epoch ms（bar 开盘时间） */
  time: number
  open: number
  high: number
  low: number
  close: number
  ema20?: number
}

export interface NoteMention {
  type: 'trade' | 'image'
  /** trade id 或图片 url */
  ref: string
}

export interface Note {
  id: string
  title: string
  /** Markdown 内容，@mention 以 [[trade:ID]] / [[image:URL]] 形式内嵌 */
  content: string
  tags: string[]
  mentions: NoteMention[]
  createdAt: number
  updatedAt: number
}

/* ---------- 派生计算结果 ---------- */

export interface TradeMetrics {
  /** 已实现盈亏（账户货币） */
  pnl: number
  /** 平均进场价 / 平均出场价 */
  avgEntry: number
  avgExit: number
  /** 总仓位数量 */
  totalQuantity: number
  /** R 倍数（需 initialStopLoss，否则为 null） */
  rMultiple: number | null
  /** 持仓时长 ms */
  durationMs: number
  entryTime: number
  exitTime: number
}

export interface EquityPoint {
  time: number
  equity: number
}

export interface StatsSummary {
  tradeCount: number
  wins: number
  losses: number
  breakeven: number
  winRate: number
  totalPnl: number
  profitFactor: number | null
  avgWin: number
  avgLoss: number
  /** 期望值（每笔平均盈亏） */
  expectancy: number
  avgR: number | null
  maxDrawdown: number
  maxDrawdownPct: number
}
