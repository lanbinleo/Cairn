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
export type ChartTimeframe = '5m' | '15m' | '1h' | '4h' | '1d'

export interface TimeRange {
  start: number
  end: number
}

/** 标签七色：红橙黄绿青蓝紫 */
export type TagColor = 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'blue' | 'purple'

export interface TagDef {
  id: string
  /** 标签名（trade.tags 中引用的即为此名称） */
  name: string
  color: TagColor
  createdAt: number
}

export type ExecutionAction =
  | 'undecided'
  | 'entry'
  | 'scale-in'
  | 'scale-out'
  | 'exit'
  | 'stop'
  | 'stop-set'
  | 'stop-moved'
  | 'target-set'
  | 'target-moved'
  | 'order-edit'
export type OrderType = 'market' | 'limit' | 'stop' | 'stop-limit' | 'stop-loss' | 'take-profit' | 'trailing-stop'

export interface Execution {
  id: string
  tradeId: string
  action: ExecutionAction
  orderType: OrderType
  /** UTC epoch ms */
  time: number
  /** 成交价，或 stop/target/order edit 的目标价 */
  price?: number
  /** 仓位类 action 的数量；管理类 action 可为空 */
  quantity?: number
  /** 管理类 action 的手动锚点价，用于风险/目标区域绘制 */
  anchorPrice?: number
  /** TradingView 原始信号文本，如 "TP1" / "SL" */
  signal?: string
  /** 原始导入行引用，如 tv:trade:7:row:14 */
  sourceRef?: string
  note?: string
}

export type TradeEventType = 'sl-set' | 'sl-moved' | 'tp-set' | 'tp-moved' | 'note'

export interface TradeEvent {
  id: string
  tradeId: string
  type: TradeEventType
  time: number
  price?: number
  sourceRef?: string
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
  importBatchId?: string
  sourceRef?: string
  /** 初始止损价（R 计算基准；可后补） */
  initialStopLoss?: number
  /** 初始止盈价（复盘图表参考；可后补） */
  initialTakeProfit?: number
  executions: Execution[]
  events: TradeEvent[]
  /** 参考图（备份截图）attachment id；旧数据可能是 URL/data URL */
  referenceImages: string[]
  /** 兼容旧数据：导入时附带的 5m K 线数据 */
  chartBars?: ChartBar[]
  /** 按周期保存的 K 线数据 */
  chartData?: Partial<Record<ChartTimeframe, ChartBar[]>>
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

export interface ChartCandle extends ChartBar {
  id: string
  symbolId: string
  timeframe: ChartTimeframe
  importIds: string[]
}

export interface ChartImport {
  id: string
  symbolId: string
  timeframe: ChartTimeframe
  fileName: string
  sourcePath?: string
  status: 'parsed' | 'failed'
  rowCount: number
  insertedCount: number
  duplicateCount: number
  conflictCount: number
  startTime?: number
  endTime?: number
  detectedIntervalMs?: number
  error?: string
  createdAt: number
}

export interface NoteMention {
  type: 'trade' | 'image'
  /** trade id 或 attachment id；旧数据可能是图片 URL/data URL */
  ref: string
}

export interface Note {
  id: string
  title: string
  /** Markdown 内容，@mention 以 [[trade:ID]] / [[image:attachmentId]] 形式内嵌 */
  content: string
  tags: string[]
  mentions: NoteMention[]
  createdAt: number
  updatedAt: number
}

export interface Attachment {
  id: string
  ownerType: 'trade' | 'note' | 'import-batch'
  ownerId: string
  kind: 'reference-image' | 'raw-export' | 'note-image'
  fileName: string
  relativePath: string
  mimeType?: string
  sourceRef?: string
  createdAt: number
}

export interface ImportBatch {
  id: string
  accountId: string
  periodId: string
  symbolId: string
  source: 'tradingview' | 'manual'
  status: 'active' | 'rolled-back'
  tradeIds: string[]
  attachmentIds: string[]
  createdAt: number
  rolledBackAt?: number
  note?: string
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
