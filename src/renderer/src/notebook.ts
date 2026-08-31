import type { SavedWord } from '../../shared/types'

export function filterSavedWords(words: SavedWord[], query: string): SavedWord[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return words

  return words.filter((word) =>
    [word.word, word.definition, word.sentence].some((value) =>
      value.toLowerCase().includes(normalizedQuery)
    )
  )
}

export function resolveSelectedWord(
  words: SavedWord[],
  selectedWordId: string | null
): SavedWord | null {
  return words.find((word) => word.id === selectedWordId) ?? words[0] ?? null
}

export function resolveNotebookAudioTargets(word: SavedWord): {
  dictionaryWord: string
  systemSentence: string
} {
  return {
    dictionaryWord: word.word,
    systemSentence: word.sentence
  }
}
