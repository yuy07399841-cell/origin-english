import type { WordAudioResult } from '../../shared/types'

const DEFAULT_SESSION_ENTRY_LIMIT = 8

function normalizedWord(word: string): string {
  return word.trim().toLowerCase()
}

export function usesHeadwordAudio(requestedWord: string, sourceWord: string): boolean {
  return normalizedWord(requestedWord) !== normalizedWord(sourceWord)
}

export class WordAudioSessionCache {
  private readonly requests = new Map<string, Promise<WordAudioResult>>()

  constructor(private readonly entryLimit = DEFAULT_SESSION_ENTRY_LIMIT) {}

  get(word: string, load: () => Promise<WordAudioResult>): Promise<WordAudioResult> {
    const key = normalizedWord(word)
    const cached = this.requests.get(key)
    if (cached) {
      this.requests.delete(key)
      this.requests.set(key, cached)
      return cached
    }

    const request = Promise.resolve()
      .then(load)
      .catch((error: unknown) => {
        if (this.requests.get(key) === request) this.requests.delete(key)
        throw error
      })
    this.requests.set(key, request)

    while (this.requests.size > this.entryLimit) {
      const oldestKey = this.requests.keys().next().value as string | undefined
      if (!oldestKey) break
      this.requests.delete(oldestKey)
    }

    return request
  }

  prefetch(word: string, load: () => Promise<WordAudioResult>): void {
    void this.get(word, load).catch(() => {
      // Prefetch stays silent. An explicit click retries and reports any error.
    })
  }
}
