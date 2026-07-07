'use client'

import type { ReactNode } from 'react'

import { TradeTitle } from '@/components/trade-title'
import { useCairn } from '@/lib/store'

/** 行内 trade mention：Trade #编号（hover 显示品种与盈亏详情） */
function TradeMention({ tradeId }: { tradeId: string }) {
  const { getTrade } = useCairn()
  const trade = getTrade(tradeId)
  if (!trade) return <span className="text-muted-foreground">[交易 {tradeId} 不存在]</span>
  return (
    <span className="inline-flex items-center rounded-md border bg-muted/50 px-1.5 py-0.5 text-[0.85em]">
      <TradeTitle trade={trade} />
    </span>
  )
}

/** 解析行内元素：[[trade:ID]] / [[image:URL]] / **bold** */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  // 先按 mention 切分
  const parts = text.split(/(\[\[(?:trade|image):[^\]]+\]\])/g)
  parts.forEach((part, i) => {
    const mention = part.match(/^\[\[(trade|image):([^\]]+)\]\]$/)
    if (mention) {
      if (mention[1] === 'trade') {
        out.push(<TradeMention key={`${keyPrefix}-m${i}`} tradeId={mention[2]} />)
      } else {
        out.push(
          <img
            key={`${keyPrefix}-m${i}`}
            src={mention[2] || "/placeholder.svg"}
            alt="笔记引用图片"
            className="my-2 w-full max-w-xl rounded-lg border"
          />,
        )
      }
      return
    }
    // bold 切分
    const boldParts = part.split(/(\*\*[^*]+\*\*)/g)
    boldParts.forEach((bp, j) => {
      const bold = bp.match(/^\*\*([^*]+)\*\*$/)
      if (bold) {
        out.push(
          <strong key={`${keyPrefix}-b${i}-${j}`} className="font-semibold text-foreground">
            {bold[1]}
          </strong>,
        )
      } else if (bp) {
        out.push(bp)
      }
    })
  })
  return out
}

/** 极简 Markdown 渲染：段落 / ### 标题 / - 与 1. 列表 / mention / bold */
export function NoteContent({ content }: { content: string }) {
  const blocks = content.split(/\n\n+/)
  return (
    <div className="flex flex-col gap-4 text-sm leading-relaxed">
      {blocks.map((block, bi) => {
        const lines = block.split('\n').filter((l) => l.trim() !== '')
        if (lines.length === 0) return null

        if (lines[0].startsWith('### ')) {
          return (
            <h3 key={bi} className="mt-2 text-base font-semibold">
              {renderInline(lines[0].slice(4), `h-${bi}`)}
            </h3>
          )
        }

        const isUl = lines.every((l) => l.trimStart().startsWith('- '))
        if (isUl) {
          return (
            <ul key={bi} className="flex list-disc flex-col gap-1.5 pl-5">
              {lines.map((l, li) => (
                <li key={li}>{renderInline(l.trimStart().slice(2), `ul-${bi}-${li}`)}</li>
              ))}
            </ul>
          )
        }

        const isOl = lines.every((l) => /^\d+\.\s/.test(l.trimStart()))
        if (isOl) {
          return (
            <ol key={bi} className="flex list-decimal flex-col gap-1.5 pl-5">
              {lines.map((l, li) => (
                <li key={li}>{renderInline(l.trimStart().replace(/^\d+\.\s/, ''), `ol-${bi}-${li}`)}</li>
              ))}
            </ol>
          )
        }

        return (
          <p key={bi} className="text-pretty">
            {lines.map((l, li) => (
              <span key={li}>
                {renderInline(l, `p-${bi}-${li}`)}
                {li < lines.length - 1 && <br />}
              </span>
            ))}
          </p>
        )
      })}
    </div>
  )
}
