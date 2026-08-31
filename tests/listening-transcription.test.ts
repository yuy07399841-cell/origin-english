import { describe, expect, it } from 'vitest'
import {
  parseWhisperTranscript,
  splitEnglishSentenceRanges
} from '../src/main/listening-transcription'

function token(text: string, from: number, to: number): object {
  return { text, offsets: { from, to } }
}

describe('local listening transcript parsing', () => {
  it('keeps abbreviations and decimals inside a sentence', () => {
    const text = 'Dr. Lee paid 3.50 dollars. Did it work? Yes!'
    expect(splitEnglishSentenceRanges(text).map((range) => text.slice(range.from, range.to))).toEqual([
      'Dr. Lee paid 3.50 dollars.',
      'Did it work?',
      'Yes!'
    ])
  })

  it('turns Whisper token timing into padded playable sentences', () => {
    const transcript = parseWhisperTranscript(
      {
        transcription: [
          {
            text: ' [BLANK_AUDIO]',
            offsets: { from: 0, to: 900 },
            tokens: [token('[_BEG_]', 0, 0), token(' [', 0, 100), token('BLANK_AUDIO]', 100, 900)]
          },
          {
            text: ' >> Good morning, Dr. Lee. Did it work?',
            offsets: { from: 1000, to: 4200 },
            tokens: [
              token(' >>', 1000, 1000),
              token(' Good', 1000, 1300),
              token(' morning', 1300, 1800),
              token(',', 1800, 1840),
              token(' Dr', 1900, 2100),
              token('.', 2100, 2140),
              token(' Lee', 2200, 2500),
              token('.', 2500, 2600),
              token(' Did', 3000, 3200),
              token(' it', 3200, 3350),
              token(' work', 3350, 3800),
              token('?', 3800, 3900),
              token('[_TT_210]', 4200, 4200)
            ]
          }
        ]
      },
      '2026-08-30T12:30:00.000Z'
    )

    expect(transcript).toMatchObject({
      model: 'small.en',
      createdAt: '2026-08-30T12:30:00.000Z',
      durationMs: 4200
    })
    expect(transcript.sentences).toEqual([
      {
        id: 'sentence-1',
        text: 'Good morning, Dr. Lee.',
        startMs: 800,
        endMs: 2860
      },
      {
        id: 'sentence-2',
        text: 'Did it work?',
        startMs: 2800,
        endMs: 4160
      }
    ])
  })

  it('rejects malformed or non-speech-only output', () => {
    expect(() => parseWhisperTranscript({})).toThrow('timed segments')
    expect(() =>
      parseWhisperTranscript({
        transcription: [
          {
            text: '[BLANK_AUDIO]',
            offsets: { from: 0, to: 1000 },
            tokens: [token(' [BLANK_AUDIO]', 0, 1000)]
          }
        ]
      })
    ).toThrow('No playable English sentences')
  })
})
