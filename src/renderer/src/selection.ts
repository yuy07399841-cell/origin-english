import type { DefinitionRequest } from '../../shared/types'

const ENGLISH_WORD = /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/
const SENTENCE_END = /[.!?]/

export function normalizeSelectedWord(value: string): string | null {
  const word = value.trim()
  return word.length <= 80 && ENGLISH_WORD.test(word) ? word : null
}

export function extractSentenceAt(text: string, offset: number): string {
  const safeOffset = Math.max(0, Math.min(offset, text.length))
  let start = 0
  for (let index = safeOffset - 1; index >= 0; index -= 1) {
    if (SENTENCE_END.test(text[index])) {
      start = index + 1
      break
    }
  }

  let end = text.length
  for (let index = safeOffset; index < text.length; index += 1) {
    if (SENTENCE_END.test(text[index])) {
      end = index + 1
      break
    }
  }

  return text.slice(start, end).replace(/\s+/g, ' ').trim()
}

export function getDefinitionRequestFromSelection(
  container: HTMLElement,
  selection: Selection | null
): DefinitionRequest | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const word = normalizeSelectedWord(selection.toString())
  if (!word) return null

  const range = selection.getRangeAt(0)
  if (!container.contains(range.commonAncestorContainer)) return null

  const startElement =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as Element)
      : range.startContainer.parentElement
  const block = startElement?.closest('p, li, blockquote, h1, h2, h3, h4')
  if (!block || !container.contains(block)) return null

  const sentenceText = block.textContent?.trim()
  if (!sentenceText) return null

  const prefixRange = document.createRange()
  prefixRange.selectNodeContents(block)
  prefixRange.setEnd(range.startContainer, range.startOffset)
  const offset = prefixRange.toString().length
  const sentence = extractSentenceAt(sentenceText, offset)
  return sentence ? { word, sentence } : null
}
