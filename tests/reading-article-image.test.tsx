// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReadingArticle } from '../src/renderer/src/App'

const onePixelPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('offline article images in the reading page', () => {
  it('displays a saved image with a Markdown title and preserves the caption', async () => {
    Object.defineProperty(window, 'originEnglish', { configurable: true, value: {
      getArticleAsset: vi.fn(async () => ({ dataUrl: onePixelPng, mimeType: 'image/png', bytes: 68 }))
    } })
    render(<ReadingArticle articleId="article-images"
      markdown={'![Titled diagram](origin-asset://article-images/image-1.png "Source caption")'}
      linksDisabled="Disabled" onSelectWord={() => undefined} />)
    await waitFor(() => expect(screen.getByAltText('Titled diagram').getAttribute('src')).toBe(onePixelPng))
    expect(screen.getByAltText('Titled diagram').getAttribute('title')).toBe('Source caption')
  })

  it('loads a managed origin-asset image through the public preload API', async () => {
    const getArticleAsset = vi.fn(async () => ({ dataUrl: onePixelPng, mimeType: 'image/png' as const, bytes: 68 }))
    Object.defineProperty(window, 'originEnglish', {
      configurable: true,
      value: { getArticleAsset }
    })

    render(
      <ReadingArticle
        articleId="article-images"
        markdown={'# Offline article\n\n![Useful diagram](origin-asset://article-images/image-1.png)'}
        linksDisabled="Links disabled"
        onSelectWord={() => undefined}
      />
    )

    await waitFor(() => expect(getArticleAsset).toHaveBeenCalledWith('article-images', 'image-1.png'))
    expect(screen.getByAltText('Useful diagram').getAttribute('src')).toBe(onePixelPng)
  })

  it('does not pass an unrelated custom URL scheme to the image loader', async () => {
    const getArticleAsset = vi.fn()
    Object.defineProperty(window, 'originEnglish', { configurable: true, value: { getArticleAsset } })
    render(
      <ReadingArticle
        articleId="article-images"
        markdown={'![Unsafe](origin-asset://another-article/image-1.png) ![Script](javascript:alert(1))'}
        linksDisabled="Links disabled"
        onSelectWord={() => undefined}
      />
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getArticleAsset).not.toHaveBeenCalled()
  })
})
