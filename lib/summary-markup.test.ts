import { describe, expect, it } from 'vitest'

import { parseSummaryMarkup, stripSummaryMarkup } from './summary-markup'

describe('parseSummaryMarkup', () => {
  it('纯文本原样通过（历史总结无标注）', () => {
    expect(parseSummaryMarkup('今天按计划入场，按计划离场。')).toEqual([
      { kind: 'plain', text: '今天按计划入场，按计划离场。' },
    ])
    expect(stripSummaryMarkup('今天按计划入场。')).toBe('今天按计划入场。')
  })

  it('三种标注各自成段：加粗 / 红 / 绿', () => {
    const segments = parseSummaryMarkup('前置**关键事实**中置!!问题偏差!!后置==执行到位==')
    expect(segments).toEqual([
      { kind: 'plain', text: '前置' },
      { kind: 'bold', text: '关键事实' },
      { kind: 'plain', text: '中置' },
      { kind: 'red', text: '问题偏差' },
      { kind: 'plain', text: '后置' },
      { kind: 'green', text: '执行到位' },
    ])
  })

  it('未闭合的记号剥掉、文字保留（与 Rust 清洗同语义，永不丢内容）', () => {
    expect(parseSummaryMarkup('说了**没关').map((s) => s.text).join('')).toBe('说了没关')
    expect(parseSummaryMarkup('说了**没关').every((s) => s.kind === 'plain')).toBe(true)
    expect(parseSummaryMarkup('==开头没关，继续写').map((s) => s.text).join('')).toBe('开头没关，继续写')
  })

  it('空内容与跨行（换行）的标注剥记号保留文字', () => {
    expect(parseSummaryMarkup('前****后')).toEqual([
      { kind: 'plain', text: '前' },
      { kind: 'plain', text: '后' },
    ])
    const segments = parseSummaryMarkup('**第一段\n\n第二段**结尾')
    expect(segments.map((s) => s.text).join('')).toBe('第一段\n\n第二段结尾')
    expect(segments.every((s) => s.kind === 'plain')).toBe(true)
  })

  it('嵌套错误可预测地降级：外层剥记号，内层如法完整则保留', () => {
    const segments = parseSummaryMarkup('**外层==内层==收尾**')
    expect(segments.map((s) => s.text).join('')).toBe('外层内层收尾')
    expect(segments).toContainEqual({ kind: 'green', text: '内层' })
  })

  it('stripSummaryMarkup 剥掉全部记号', () => {
    expect(stripSummaryMarkup('**加粗**与!!红!!与==绿==')).toBe('加粗与红与绿')
  })
})
