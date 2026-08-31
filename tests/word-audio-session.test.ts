import { describe, expect, it, vi } from 'vitest'
import type { WordAudioResult } from '../src/shared/types'
import {
  usesHeadwordAudio,
  WordAudioSessionCache
} from '../src/renderer/src/word-audio-session'

function audioResult(sourceWord: string): WordAudioResult {
  return {
    dataUrl: 'data:audio/ogg;base64,T2dnUw==',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:test.ogg',
    license: 'CC0',
    artist: 'Test speaker',
    sourceWord
  }
}

describe('word audio session cache', () => {
  it('reuses an in-flight prefetch when the user clicks the same word', async () => {
    let resolveLoad!: (result: WordAudioResult) => void
    const load = vi.fn(
      () =>
        new Promise<WordAudioResult>((resolve) => {
          resolveLoad = resolve
        })
    )
    const cache = new WordAudioSessionCache()

    cache.prefetch('Noticing', load)
    const clicked = cache.get('noticing', load)
    await Promise.resolve()
    expect(load).toHaveBeenCalledOnce()

    resolveLoad(audioResult('noticing'))
    await expect(clicked).resolves.toMatchObject({ sourceWord: 'noticing' })
  })

  it('drops a failed prefetch so an explicit click can retry', async () => {
    const load = vi
      .fn<() => Promise<WordAudioResult>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(audioResult('notice'))
    const cache = new WordAudioSessionCache()

    cache.prefetch('notices', load)
    await expect(cache.get('notices', load)).rejects.toThrow('offline')
    await expect(cache.get('notices', load)).resolves.toMatchObject({ sourceWord: 'notice' })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('distinguishes exact-form recordings from headword fallbacks', () => {
    expect(usesHeadwordAudio('Noticing', 'noticing')).toBe(false)
    expect(usesHeadwordAudio('notices', 'notice')).toBe(true)
  })
})
