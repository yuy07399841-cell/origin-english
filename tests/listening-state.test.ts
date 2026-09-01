import { describe, expect, it } from 'vitest'
import { deleteListeningItemFromState } from '../src/main/listening-state'
import type { AppState } from '../src/shared/types'

function createState(): AppState {
  return {
    schemaVersion: 4,
    uiLanguage: 'zh',
    articles: [],
    listeningItems: [
      {
        id: 'abc-111',
        title: 'Audio one',
        fileName: 'one.mp3',
        storedFileName: 'audio-abc-111.mp3',
        mimeType: 'audio/mpeg',
        bytes: 12,
        importedAt: '2026-09-01T00:00:00.000Z',
        transcript: {
          model: 'small.en',
          createdAt: '2026-09-01T00:01:00.000Z',
          durationMs: 1_000,
          sentences: [{ id: 'sentence-one', text: 'Hello.', startMs: 0, endMs: 1_000 }]
        }
      },
      {
        id: 'def-222',
        title: 'Audio two',
        fileName: 'two.wav',
        storedFileName: 'audio-def-222.wav',
        mimeType: 'audio/wav',
        bytes: 16,
        importedAt: '2026-09-01T00:02:00.000Z',
        transcript: null
      }
    ],
    savedWords: [
      {
        id: 'word-one',
        word: 'hello',
        sentence: 'Hello.',
        partOfSpeech: 'interjection',
        definition: 'used as a greeting',
        usage: 'Hello, everyone.',
        articleId: null,
        savedAt: '2026-09-01T00:03:00.000Z'
      }
    ],
    lookupEvents: [
      {
        id: 'lookup-one',
        word: 'hello',
        sentence: 'Hello.',
        articleId: null,
        outcome: 'helpful',
        createdAt: '2026-09-01T00:03:00.000Z'
      }
    ]
  }
}

describe('listening item deletion', () => {
  it('deletes only the requested audio record and its embedded transcript', () => {
    const original = createState()
    const updated = deleteListeningItemFromState(original, 'abc-111')

    expect(updated.listeningItems.map((item) => item.id)).toEqual(['def-222'])
    expect(updated.savedWords).toBe(original.savedWords)
    expect(updated.lookupEvents).toBe(original.lookupEvents)
    expect(original.listeningItems).toHaveLength(2)
  })

  it('returns the original state when the audio record no longer exists', () => {
    const original = createState()
    expect(deleteListeningItemFromState(original, 'missing-audio')).toBe(original)
  })
})
