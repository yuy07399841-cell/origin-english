import { describe, expect, it } from 'vitest'
import { configureSentenceAudioPlayback } from '../src/renderer/src/speech'

describe('sentence audio playback', () => {
  it('uses the selected sentence rate while preserving pitch', () => {
    const audio = { playbackRate: 1, preservesPitch: false }
    configureSentenceAudioPlayback(audio, 0.9)
    expect(audio).toEqual({ playbackRate: 0.9, preservesPitch: true })
    configureSentenceAudioPlayback(audio, 1)
    expect(audio).toEqual({ playbackRate: 1, preservesPitch: true })
  })
})
