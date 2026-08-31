import { describe, expect, it } from 'vitest'
import {
  validateDefinitionRequest,
  validateSentenceAudioRequest,
  validateSaveWordInput,
  validateSetLookupOutcomeInput,
  validateUiLanguage
} from '../src/main/validation'

describe('main-process input validation', () => {
  it('normalizes the minimum definition payload', () => {
    expect(
      validateDefinitionRequest({ word: ' context ', sentence: ' Context makes meaning clear. ' })
    ).toEqual({ word: 'context', sentence: 'Context makes meaning clear.' })
  })

  it('rejects multi-word selections and oversized context', () => {
    expect(() =>
      validateDefinitionRequest({ word: 'two words', sentence: 'A sentence.' })
    ).toThrow('Select one English word')
    expect(() =>
      validateDefinitionRequest({ word: 'word', sentence: 'x'.repeat(1_001) })
    ).toThrow('Sentence')
  })

  it('does not accept arbitrary lookup outcomes', () => {
    expect(() =>
      validateSetLookupOutcomeInput({ lookupId: 'one', outcome: 'great' })
    ).toThrow('invalid')
  })

  it('normalizes a bounded English sentence audio request', () => {
    expect(
      validateSentenceAudioRequest({ sentence: '  A natural\n sentence should stay readable.  ' })
    ).toEqual({ sentence: 'A natural sentence should stay readable.' })
    expect(() => validateSentenceAudioRequest({ sentence: '。' })).toThrow('readable English')
    expect(() => validateSentenceAudioRequest({ sentence: 'x'.repeat(1_001) })).toThrow(
      'Sentence'
    )
  })

  it('requires all saved-word learning fields', () => {
    expect(() =>
      validateSaveWordInput({ word: 'context', sentence: 'A sentence.', articleId: null })
    ).toThrow('Part of speech')
  })

  it('accepts only the two supported interface languages', () => {
    expect(validateUiLanguage('zh')).toBe('zh')
    expect(validateUiLanguage('en')).toBe('en')
    expect(() => validateUiLanguage('fr')).toThrow('invalid')
  })
})
