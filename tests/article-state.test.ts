import { describe, expect, it } from 'vitest'
import { deleteArticleFromState } from '../src/main/article-state'
import type { AppState } from '../src/shared/types'

function createState(): AppState {
  return {
    schemaVersion: 4,
    uiLanguage: 'zh',
    articles: [
      {
        id: 'article-one',
        title: 'Article one',
        fileName: 'one.md',
        markdown: '# Article one',
        importedAt: '2026-08-30T00:00:00.000Z'
      },
      {
        id: 'article-two',
        title: 'Article two',
        fileName: 'two.md',
        markdown: '# Article two',
        importedAt: '2026-08-30T00:01:00.000Z'
      }
    ],
    listeningItems: [],
    savedWords: [
      {
        id: 'word-one',
        word: 'notice',
        sentence: 'I noticed the change.',
        partOfSpeech: 'verb',
        definition: 'to become aware of something',
        usage: 'notice a change',
        articleId: 'article-one',
        savedAt: '2026-08-30T00:02:00.000Z'
      },
      {
        id: 'word-two',
        word: 'calm',
        sentence: 'The room was calm.',
        partOfSpeech: 'adjective',
        definition: 'quiet and peaceful',
        usage: 'a calm room',
        articleId: 'article-two',
        savedAt: '2026-08-30T00:03:00.000Z'
      }
    ],
    lookupEvents: [
      {
        id: 'lookup-one',
        word: 'notice',
        sentence: 'I noticed the change.',
        articleId: 'article-one',
        outcome: 'helpful',
        createdAt: '2026-08-30T00:02:00.000Z'
      },
      {
        id: 'lookup-two',
        word: 'calm',
        sentence: 'The room was calm.',
        articleId: 'article-two',
        outcome: 'unrated',
        createdAt: '2026-08-30T00:03:00.000Z'
      }
    ]
  }
}

describe('article deletion', () => {
  it('deletes only the requested article and preserves learning records', () => {
    const original = createState()
    const updated = deleteArticleFromState(original, 'article-one')

    expect(updated.articles.map((article) => article.id)).toEqual(['article-two'])
    expect(updated.savedWords).toHaveLength(2)
    expect(updated.lookupEvents).toHaveLength(2)
    expect(updated.savedWords[0].articleId).toBeNull()
    expect(updated.lookupEvents[0].articleId).toBeNull()
    expect(updated.savedWords[1]).toBe(original.savedWords[1])
    expect(updated.lookupEvents[1]).toBe(original.lookupEvents[1])
    expect(original.articles).toHaveLength(2)
  })

  it('returns the original state when the article no longer exists', () => {
    const original = createState()
    expect(deleteArticleFromState(original, 'missing-article')).toBe(original)
  })
})
