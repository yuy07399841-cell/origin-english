import { describe, expect, it } from 'vitest'
import { UI_COPY } from '../src/renderer/src/i18n'

describe('interface translations', () => {
  it('keeps the same complete set of keys in Chinese and English', () => {
    expect(Object.keys(UI_COPY.zh).sort()).toEqual(Object.keys(UI_COPY.en).sort())
  })

  it('provides localized navigation, library guidance and counters', () => {
    expect(UI_COPY.en.reading).toBe('Reading')
    expect(UI_COPY.zh.reading).toBe('阅读')
    expect(UI_COPY.en.listening).toBe('Listening')
    expect(UI_COPY.zh.listening).toBe('听力')
    expect(UI_COPY.en.selectWord).not.toBe(UI_COPY.zh.selectWord)
    expect(UI_COPY.en.articleCount(2)).toBe('2 articles')
    expect(UI_COPY.zh.articleCount(2)).toBe('2 篇文章')
    expect(UI_COPY.en.sentenceCount(2)).toBe('2 sentences')
    expect(UI_COPY.zh.sentenceCount(2)).toBe('2 句话')
    expect(UI_COPY.en.sentenceCountUnit(1)).toBe('sentence')
    expect(UI_COPY.en.sentenceCountUnit(2)).toBe('sentences')
    expect(UI_COPY.zh.sentenceCountUnit(487)).toBe('句话')
    expect(UI_COPY.zh.transcriptionNote).toContain('连续播放')
    expect(UI_COPY.en.continueFromSentence(2)).toBe('Continue from sentence 2')
    expect(UI_COPY.zh.continueFromSentence(2)).toBe('从第 2 句附近继续播放')
    expect(UI_COPY.en.originalSentence).toBe('Original sentence')
    expect(UI_COPY.zh.originalSentence).toBe('原句')
    expect(UI_COPY.en.confirmDeleteArticle('A quiet article')).toContain('Saved words')
    expect(UI_COPY.zh.confirmDeleteArticle('一篇文章')).toContain('生词本')
    expect(UI_COPY.en.headwordAudioAttribution('notice', 'Speaker', 'CC0')).toContain(
      'headword “notice”'
    )
    expect(UI_COPY.zh.headwordAudioAttribution('notice', '朗读者', 'CC0')).toContain(
      '词典原型：notice'
    )
    expect(UI_COPY.en.localCapabilities).toHaveLength(4)
    expect(UI_COPY.zh.localCapabilities).toHaveLength(4)
    expect(UI_COPY.en.aiStateReady).toBe('All ready')
    expect(UI_COPY.zh.aiStateReady).toBe('全部就绪')
  })
})
