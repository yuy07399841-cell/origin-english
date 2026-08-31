import { describe, expect, it } from 'vitest'
import { extractSentenceAt, normalizeSelectedWord } from '../src/renderer/src/selection'

describe('reading selection helpers', () => {
  it('accepts one English word and rejects phrases', () => {
    expect(normalizeSelectedWord(' subtle ')).toBe('subtle')
    expect(normalizeSelectedWord("reader's")).toBe("reader's")
    expect(normalizeSelectedWord('two words')).toBeNull()
    expect(normalizeSelectedWord('中文')).toBeNull()
  })

  it('extracts the sentence that contains the selection offset', () => {
    const text = 'First thought. A subtle change can matter! Last thought?'
    expect(extractSentenceAt(text, text.indexOf('subtle'))).toBe(
      'A subtle change can matter!'
    )
    expect(extractSentenceAt(text, text.indexOf('Last'))).toBe('Last thought?')
  })

  it('handles a paragraph without terminal punctuation', () => {
    expect(extractSentenceAt('A single unfinished sentence', 10)).toBe(
      'A single unfinished sentence'
    )
  })
})
