import type { SentenceAudioResult } from '../../shared/types'

export interface SentenceAudioSessionResult {
  result: SentenceAudioResult
  loaded: boolean
}

export class SentenceAudioSessionCache {
  private readonly values = new Map<string, SentenceAudioResult>()
  private readonly inFlight = new Map<string, Promise<SentenceAudioResult>>()

  async get(
    sentence: string,
    loader: () => Promise<SentenceAudioResult>
  ): Promise<SentenceAudioSessionResult> {
    const existing = this.values.get(sentence)
    if (existing) return { result: existing, loaded: false }

    const pending = this.inFlight.get(sentence)
    if (pending) return { result: await pending, loaded: false }

    const request = loader()
      .then((result) => {
        this.values.set(sentence, result)
        return result
      })
      .finally(() => {
        this.inFlight.delete(sentence)
      })

    this.inFlight.set(sentence, request)
    return { result: await request, loaded: true }
  }
}
