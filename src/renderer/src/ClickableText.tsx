import type { DefinitionRequest } from '../../shared/types'
import { extractSentenceAt } from './selection'

const ENGLISH_WORD = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g

interface ClickableTextProps {
  text: string
  onSelectWord: (request: DefinitionRequest) => void
}

export function ClickableText({ text, onSelectWord }: ClickableTextProps): React.JSX.Element {
  const parts: React.ReactNode[] = []
  let cursor = 0

  for (const match of text.matchAll(ENGLISH_WORD)) {
    const start = match.index
    const word = match[0]
    if (start > cursor) parts.push(text.slice(cursor, start))
    parts.push(
      <span
        className="lookup-word"
        data-lookup-word={word}
        key={`${start}-${word}`}
        onClick={(event) => {
          event.stopPropagation()
          const selection = window.getSelection()
          if (selection && !selection.isCollapsed) return
          const target = event.currentTarget
          const block = target.closest('p, li, blockquote, h1, h2, h3, h4')
          const sentenceText = block?.textContent?.trim() ?? text
          let offset = start
          if (block) {
            const prefix = document.createRange()
            prefix.selectNodeContents(block)
            prefix.setEnd(target.firstChild ?? target, 0)
            offset = prefix.toString().length
          }
          onSelectWord({ word, sentence: extractSentenceAt(sentenceText, offset) })
        }}
      >
        {word}
      </span>
    )
    cursor = start + word.length
  }
  if (cursor < text.length) parts.push(text.slice(cursor))

  return <>{parts}</>
}
