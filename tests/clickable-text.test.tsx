// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ClickableText } from '../src/renderer/src/ClickableText'

describe('single-word click lookup', () => {
  it('opens the clicked word with its containing sentence and preserves punctuation', async () => {
    const onSelectWord = vi.fn()
    const user = userEvent.setup()
    const { container } = render(
      <p>
        <ClickableText
          text="First thought. A subtle change can matter! Last thought?"
          onSelectWord={onSelectWord}
        />
      </p>
    )

    expect(container.textContent).toBe(
      'First thought. A subtle change can matter! Last thought?'
    )
    await user.click(screen.getByText('subtle'))
    expect(onSelectWord).toHaveBeenCalledWith({
      word: 'subtle',
      sentence: 'A subtle change can matter!'
    })
  })
})
