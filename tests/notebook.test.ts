import { describe, expect, it } from 'vitest'
import type { SavedWord } from '../src/shared/types'
import {
  filterSavedWords,
  resolveNotebookAudioTargets,
  resolveSelectedWord
} from '../src/renderer/src/notebook'

const words: SavedWord[] = [
  {
    id: 'one',
    word: 'noticing',
    sentence: 'Noticing a pattern takes time.',
    partOfSpeech: 'noun',
    definition: 'the act of paying attention to something',
    usage: 'Noticing small changes can improve understanding.',
    articleId: null,
    savedAt: '2026-08-29T00:00:00.000Z'
  },
  {
    id: 'two',
    word: 'context',
    sentence: 'Context gives a word its local shape.',
    partOfSpeech: 'noun',
    definition: 'surrounding information that gives meaning',
    usage: 'Read the sentence for context.',
    articleId: null,
    savedAt: '2026-08-29T00:01:00.000Z'
  }
]

describe('notebook list behavior', () => {
  it('filters by word, definition and original sentence without changing order', () => {
    expect(filterSavedWords(words, 'CONTEXT')).toEqual([words[1]])
    expect(filterSavedWords(words, 'paying attention')).toEqual([words[0]])
    expect(filterSavedWords(words, 'local shape')).toEqual([words[1]])
    expect(filterSavedWords(words, '')).toEqual(words)
  })

  it('keeps the selected word when visible and otherwise falls back to the first result', () => {
    expect(resolveSelectedWord(words, 'two')).toEqual(words[1])
    expect(resolveSelectedWord(words, 'missing')).toEqual(words[0])
    expect(resolveSelectedWord([], 'one')).toBeNull()
  })

  it('keeps dictionary word audio separate from system sentence speech', () => {
    expect(resolveNotebookAudioTargets(words[0])).toEqual({
      dictionaryWord: 'noticing',
      systemSentence: 'Noticing a pattern takes time.'
    })
  })
})
