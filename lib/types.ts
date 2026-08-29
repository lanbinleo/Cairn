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
  /** 当前权益快照（initialBalance + 已平仓 PnL；派生数据，交易变化后由前端重算） */
  equity?: number
  equityUpdatedAt?: number
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

export type CaseStatus = 'active' | 'closed' | 'archived'
export type CaseProvenance = 'forward' | 'retrospective'
export type CaseCardPhase = 'pre-entry' | 'entry' | 'intermediate' | 'closing' | 'reflection'
export type CaseEntryDecision = 'pending' | 'executed' | 'continue-observing'
export type CaseBindingSource = 'manual' | 'import' | 'api'

export interface CaseTagDef {
  id: string
  name: string
  color: TagColor
  createdAt: number
}

/** 一条 AI 补录建议（管理类动作候选）。落地与否永远由用户确认。 */
export interface CaseExecutionSuggestion {
  id: string
  /** 编辑器规范集：stop | target-moved | order-edit */
  action: 'stop' | 'target-moved' | 'order-edit'
  orderType: OrderType
  /** 明确数字价格；只说了位置时为空，看 anchorText */
  price?: number
  /** 位置描述（如「成本线下方」） */
  anchorText?: string
  /** 简短理由（AI 生成，≤12 字） */
  signal?: string
  /** 证据：来源卡片 + 逐字原话 + 卡片 BAR */
  cardId: string
  quote: string
  barRef?: number
  status: 'pending' | 'accepted' | 'dismissed'
  /** 接受后生成的 Execution id */
  acceptedExecutionId?: string
  dismissedAt?: number
}

/** Case 上的版本化建议派生数据（0.3.0）。重跑按指纹延续 accepted/dismissed。 */
export interface CaseExecutionSuggestions {
  schemaVersion: string
  promptVersion: string
  model: string
  providerId: string
  analyzedAt: number
  suggestions: CaseExecutionSuggestion[]
}

/** 一段围绕潜在或已完成 Trade 的连续决策记录。 */
export interface TradeCase {
  id: string
  accountId: string
  periodId: string
  title: string
  status: CaseStatus
  provenance: CaseProvenance
  tagIds: string[]
  createdAt: number
  updatedAt: number
  /** AI 持仓管理补录建议（绑定 Trade 后生成） */
  aiExecutionSuggestions?: CaseExecutionSuggestions
  /** AI 整单总结（Trade 关闭后自动或手动生成） */
  aiSummary?: CaseSummary
}

/** AI 整单总结：只摆事实与偏差，不打分不下对错结论。 */
export interface CaseSummary {
  schemaVersion: string
  promptVersion: string
  model: string
  providerId: string
  analyzedAt: number
  /** 一句话定性 */
  overview: string
  /** 2-4 段时间线叙述 */
  narrative: string
  /** 3-5 条要点 */
  highlights: string[]
  /** 缺失/未落库的信息 */
  missing: string[]
}

/** AI 秘书对一段原文的 span 引用标签。quote 必须逐字来自原文。 */
export interface CaseCardLabel {
  type: string
  quote: string
}

/** memo 单字段：value 为规范化值，quote 为原文证据。 */
export interface CaseMemoField {
  value: string | number
  quote?: string
}

/** 入场前三分钟 memo：七字段 + 可选情绪。缺省字段代表原文没提到。 */
export interface CaseCardMemo {
  direction?: CaseMemoField
  /** 计划入场价或入场触发方式（schema v2 起提取） */
  entryPrice?: CaseMemoField
  stopLoss?: CaseMemoField
  target?: CaseMemoField
  confidence?: CaseMemoField
  invalidation?: CaseMemoField
  rejectedAlternatives?: CaseMemoField
  emotion?: CaseMemoField
}

/** Card 的版本化 AI 派生结果。绝不改写 rawText；重跑整体替换。 */
export interface CaseCardAnalysis {
  schemaVersion: string
  promptVersion: string
  model: string
  providerId: string
  analyzedAt: number
  /** 一句话提炼（0.3.0 schema-3 起）；旧分析无此字段，UI 回退原文截断 */
  digest?: string | null
  barRef: { bar: number; quote?: string } | null
  labels: CaseCardLabel[]
  memo: CaseCardMemo | null
  missingFields: string[]
  /** 用户手动修正过标签/memo；重新识别前会提示覆盖 */
  userAdjusted?: boolean
  /** 用户忽略了最近一次过期（= 当时 rawTextEditedAt）；原文再改则重新出现 */
  staleDismissedAt?: number
}

/** Case 内的一条原始记录。rawText 可修正错字，旧值自动进 rawTextHistory。 */
export interface CaseCard {
  id: string
  caseId: string
  phase: CaseCardPhase
  rawText: string
  entryDecision?: CaseEntryDecision
  /** Card 对应的唯一 BAR。机械提取或 AI 回填，允许缺失。 */
  barRef?: number
  /** 0.2.0 早期数据兼容字段；读取时只采用第一项。 */
  barRefs?: number[]
  /** 每次修改 rawText 前的旧值，按时间顺序累积。 */
  rawTextHistory?: string[]
  /** 最近一次 rawText 修改时间；晚于此的分析视为过期。 */
  rawTextEditedAt?: number
  createdAt: number
  aiAnalysis?: CaseCardAnalysis
}

/** Case 与 Trade 的有效关系为一对一。 */
export interface CaseTradeBinding {
  id: string
  caseId: string
  tradeId: string
  source: CaseBindingSource
  boundAt: number
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

/** 过程分：人评字段 + 判断覆盖；memo 完整、止损只收紧等机械项实时推导，保存时快照 computed。 */
export interface TradeProcessScore {
  /** 结构成立（判断项，0-2，人评，建议对着入场 BAR 冻结图打分） */
  structureValid?: number
  /** 计划盈亏比过线（0/1；缺省时按推导 plannedRR ≥ 阈值判定） */
  riskRewardPass?: number
  /** 入场纪律（0/1，人评：计划区域内非追单） */
  entryDiscipline?: number
  /** 持仓期间计划外动作次数（得分 = max(0, 2 - n)） */
  unplannedActions?: number
  /** 出场按计划（0/1，人评） */
  exitPerPlan?: number
  /** 保存时的推导快照（价格、RR、memo 缺失、止损序列） */
  computed?: {
    entryPrice?: number | null
    exitPrice?: number | null
    stopPrice?: number | null
    targetPrice?: number | null
    plannedRR?: number | null
    memoMissing?: string[] | null
    stopOnlyTightened?: boolean
  }
  updatedAt?: number
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
  /** 计划入场价（区别于成交均价；可后补） */
  initialEntryPrice?: number
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
  processScore?: TradeProcessScore
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
  ownerType: 'trade' | 'note' | 'import-batch' | 'case' | 'case-card'
  ownerId: string
  kind: 'reference-image' | 'raw-export' | 'note-image' | 'case-image'
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
  /** R 倍数（实际 PnL ÷ 初始风险；需 initialStopLoss，否则为 null） */
  rMultiple: number | null
  /** 实际 R（实际 PnL ÷ 实际风险分段累加；需 initialStopLoss，否则为 null） */
  rActual: number | null
  /** 初始风险：|首笔入场价 − 初始止损| × 首笔数量（计划的 1R）；缺初始止损为 null */
  initialRisk: number | null
  /** 实际风险：Σ 每笔入场 fill × |fill 价 − 当时生效止损| × 数量；缺初始止损为 null */
  actualRisk: number | null
  /** 首笔入场价（初始风险与 R 的基准；无成交为 0） */
  firstEntryPrice: number
  /** 最终止损：出场时生效的止损价（从未动过则等于 initialStopLoss）；无止损记录为 null */
  finalStop: number | null
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
