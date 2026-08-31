import { describe, expect, it } from 'vitest'
import { toPlainArticleTitle } from '../src/shared/article-title'

describe('article titles', () => {
  it('removes common inline Markdown without changing the stored article', () => {
    expect(toPlainArticleTitle('**Why is the ocean salty?**')).toBe(
      'Why is the ocean salty?'
    )
    expect(toPlainArticleTitle('[A calm title](https://example.com)')).toBe('A calm title')
  })

  it('uses a readable fallback for markup-only headings', () => {
    expect(toPlainArticleTitle('***')).toBe('Untitled reading')
  })
})
