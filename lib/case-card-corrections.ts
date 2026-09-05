/**
 * AI 校对替换对的机械套用（0.3.7）：把 oldText→newText 按顺序应用到原文。
 * 套用与否永远由用户逐条勾选决定——这里只做机械替换与失败标注，不静默跳过。
 */

export interface CorrectionPair {
  oldText: string
  newText: string
}

export interface AppliedCorrection {
  pair: CorrectionPair
  ok: boolean
}

export function applyCorrectionPairs(text: string, pairs: CorrectionPair[]): { text: string; results: AppliedCorrection[] } {
  let out = text
  let cursor = 0
  const results: AppliedCorrection[] = []
  for (const pair of pairs) {
    const oldText = pair.oldText.trim()
    const newText = pair.newText.trim()
    if (!oldText || !newText || oldText === newText) {
      results.push({ pair, ok: false })
      continue
    }
    // 从上一处替换点之后找（prompt 要求 oldText 带上下文唯一）；找不到再从头找一次
    // （前面的替换可能挪动了位置），仍找不到才是真正的失败（被前一对消耗/改写）
    let at = out.indexOf(oldText, cursor)
    if (at === -1) at = out.indexOf(oldText)
    if (at === -1) {
      results.push({ pair, ok: false })
      continue
    }
    out = out.slice(0, at) + newText + out.slice(at + oldText.length)
    cursor = at + newText.length
    results.push({ pair, ok: true })
  }
  return { text: out, results }
}
