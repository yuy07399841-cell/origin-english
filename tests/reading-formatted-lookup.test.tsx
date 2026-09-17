// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { ReadingArticle } from '../src/renderer/src/App'

afterEach(cleanup)

it('renders an underscore-only separator as a divider without changing underscores in prose', () => {
  render(<ReadingArticle articleId="bbc-separator"
    markdown={`${'\\_'.repeat(140)}\n\nKeep file\\_name in this sentence.`}
    linksDisabled="Disabled" onSelectWord={() => undefined} />)
  expect(screen.getAllByRole('separator')).toHaveLength(1)
  expect(document.querySelector('.reading-paper p')?.textContent).toBe('Keep file_name in this sentence.')
})

it('looks up words across formatted text without losing the original sentence or formatting', async () => {
  const select = vi.fn()
  const user = userEvent.setup()
  const { container } = render(<ReadingArticle articleId="formatted"
    markdown={'A **subtle** change feels *different* near [home](https://example.com). `code` stays code.'}
    linksDisabled="Disabled" onSelectWord={select} />)
  for (const word of ['A', 'subtle', 'change', 'different', 'home']) {
    await user.click(screen.getByText(word, { exact: true }))
    expect(select).toHaveBeenLastCalledWith({ word, sentence: 'A subtle change feels different near home.' })
  }
  expect(container.querySelector('strong')?.textContent).toBe('subtle')
  expect(container.querySelector('em')?.textContent).toBe('different')
  expect(container.querySelector('code')?.textContent).toBe('code')
  expect(container.querySelector('code .lookup-word')).toBeNull()
})
