/**
 * AI 总结 narrative 的受限标注（0.3.4）：**加粗**（关键事实）、!!红!!（问题/偏差）、
 * ==绿==（执行到位/亮点）。与 Rust ai::sanitize_summary_markup 同语义——Rust 侧
 * 已清洗（未配对/空/跨行/嵌套/超量的标注被剥掉记号），这里按同样的规则解析；
 * 历史总结（无标注）原样通过。前端这层保持宽容：任何残余的野记号当普通文字。
 */

export type SummaryMarkupKind = 'bold' | 'red' | 'green'

export interface SummaryMarkupSegment {
  kind: SummaryMarkupKind | 'plain'
  text: string
}

const MARKERS: Array<{ token: string; kind: SummaryMarkupKind }> = [
  { token: '**', kind: 'bold' },
  { token: '!!', kind: 'red' },
  { token: '==', kind: 'green' },
]

function markerAt(text: string, index: number): SummaryMarkupKind | null {
  for (const { token, kind } of MARKERS) {
    if (text.startsWith(token, index)) return kind
  }
  return null
}

/** 解析为渲染分段；段与段拼接 = 原文（不丢字）。 */
export function parseSummaryMarkup(text: string): SummaryMarkupSegment[] {
  const segments: SummaryMarkupSegment[] = []
  let plain = ''
  let open: SummaryMarkupKind | null = null
  let buf = ''
  const pushPlain = (chunk: string) => {
    if (chunk) plain += chunk
  }
  const flushPlain = () => {
    if (plain) {
      segments.push({ kind: 'plain', text: plain })
      plain = ''
    }
  }
  let i = 0
  while (i < text.length) {
    const kind = markerAt(text, i)
    if (kind == null) {
      if (open) buf += text[i]
      else pushPlain(text[i])
      i += 1
      continue
    }
    if (open == null) {
      flushPlain()
      open = kind
      buf = ''
    } else if (open === kind) {
      if (buf.trim() && !buf.includes('\n')) {
        flushPlain() // 保证分段顺序：先落之前积压的普通文字，再落标注段
        segments.push({ kind, text: buf })
      } else {
        pushPlain(buf)
      }
      buf = ''
      open = null
    } else {
      // 嵌套错误：前段剥记号保留文字，以新记号重开
      pushPlain(buf)
      buf = ''
      open = kind
    }
    i += 2
  }
  if (open) pushPlain(buf) // 未闭合：剥记号保留文字
  flushPlain()
  return segments
}

/** 剥掉全部标注记号（填入复盘备注用——trade.note 是纯文本渲染）。 */
export function stripSummaryMarkup(text: string): string {
  return parseSummaryMarkup(text)
    .map((segment) => segment.text)
    .join('')
}
