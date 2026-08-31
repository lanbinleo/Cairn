import { describe, expect, it } from 'vitest'

import { tagsWithAdditions } from './tags'

describe('tagsWithAdditions（AI 标签建议批量应用）', () => {
  it('一次并入全部新增名字——updateTrade 的 patch.tags 是整体替换，逐条提交会互相覆盖', () => {
    expect(tagsWithAdditions(['左侧做单'], ['突破', 'FOMO', '仓位过重'])).toEqual([
      '左侧做单',
      '突破',
      'FOMO',
      '仓位过重',
    ])
  })

  it('忽略大小写与空白差异去重，已存在的名字不重复追加', () => {
    expect(tagsWithAdditions(['突破', 'fomo'], ['FOMO', ' 突破 ', '仓位过重'])).toEqual([
      '突破',
      'fomo',
      '仓位过重',
    ])
  })

  it('空名字跳过；不改入参数组', () => {
    const current = ['A']
    expect(tagsWithAdditions(current, ['', '   '])).toEqual(['A'])
    expect(current).toEqual(['A'])
  })
})
