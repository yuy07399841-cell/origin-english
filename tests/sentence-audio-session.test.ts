import { describe, expect, it, vi } from 'vitest'
import { SentenceAudioSessionCache } from '../src/renderer/src/sentence-audio'

const sentenceAudio = {
  dataUrl: 'data:audio/wav;base64,UklGRg==',
  provider: 'mimo' as const,
  model: 'mimo-v2.5-tts',
  voice: 'Mia',
  cached: false
}

describe('sentence audio session cache', () => {
  it('loads one audio result once and reuses it for later playback speeds', async () => {
    const loader = vi.fn(async () => sentenceAudio)
    const cache = new SentenceAudioSessionCache()

    expect(await cache.get('A sentence.', loader)).toEqual({
      result: sentenceAudio,
      loaded: true
    })
    expect(await cache.get('A sentence.', loader)).toEqual({
      result: sentenceAudio,
      loaded: false
    })
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('coalesces simultaneous requests for the same sentence', async () => {
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const loader = vi.fn(async () => {
      await gate
      return sentenceAudio
    })
    const cache = new SentenceAudioSessionCache()

    const first = cache.get('A sentence.', loader)
    const second = cache.get('A sentence.', loader)
    release()

    expect(await first).toEqual({ result: sentenceAudio, loaded: true })
    expect(await second).toEqual({ result: sentenceAudio, loaded: false })
    expect(loader).toHaveBeenCalledTimes(1)
  })
})
