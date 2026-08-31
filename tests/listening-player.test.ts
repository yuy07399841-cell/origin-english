import { describe, expect, it } from 'vitest'
import {
  clampSeekTime,
  findActiveSentenceId,
  formatPlaybackTime,
  getListeningShortcutAction,
  LISTENING_PLAYBACK_RATES,
  resolveActiveSentenceId
} from '../src/renderer/src/listening-player'

describe('listening player helpers', () => {
  it('exposes the three frozen playback rates', () => {
    expect(LISTENING_PLAYBACK_RATES).toEqual([0.75, 1, 1.25])
  })

  it('formats time and clamps ten-second seeking', () => {
    expect(formatPlaybackTime(0)).toBe('0:00')
    expect(formatPlaybackTime(65_999)).toBe('1:05')
    expect(clampSeekTime(5_000, -10_000, 60_000)).toBe(0)
    expect(clampSeekTime(55_000, 10_000, 60_000)).toBe(60_000)
  })

  it('finds the sentence whose playable interval contains the current time', () => {
    const sentences = [
      { id: 'one', text: 'One.', startMs: 800, endMs: 1600 },
      { id: 'two', text: 'Two.', startMs: 1500, endMs: 2300 }
    ]
    expect(findActiveSentenceId(sentences, 900)).toBe('one')
    expect(findActiveSentenceId(sentences, 1700)).toBe('two')
    expect(findActiveSentenceId(sentences, 2500)).toBeNull()
  })

  it('keeps the explicitly played sentence active when padded intervals overlap', () => {
    const sentences = [
      { id: 'one', text: 'One.', startMs: 800, endMs: 1600 },
      { id: 'two', text: 'Two.', startMs: 1500, endMs: 2300 }
    ]
    expect(findActiveSentenceId(sentences, 1500)).toBe('one')
    expect(resolveActiveSentenceId(sentences, 1500, 'two')).toBe('two')
    expect(resolveActiveSentenceId(sentences, 1700, null)).toBe('two')
  })

  it('maps player shortcuts without repeating the space toggle', () => {
    expect(getListeningShortcutAction({ key: ' ', code: 'Space' })).toBe('toggle-playback')
    expect(getListeningShortcutAction({ key: ' ', code: 'Space', repeat: true })).toBeNull()
    expect(getListeningShortcutAction({ key: 'ArrowLeft', repeat: true })).toBe('seek-backward')
    expect(getListeningShortcutAction({ key: 'ArrowRight' })).toBe('seek-forward')
    expect(getListeningShortcutAction({ key: 'ArrowRight', ctrlKey: true })).toBeNull()
  })
})
