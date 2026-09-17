// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ImportSourceDialog } from '../src/renderer/src/ImportSourceDialog'

describe('URL import page interaction', () => {
  it('lets a reader enter an article URL while keeping local file import available', async () => {
    const onLocal = vi.fn()
    const onUrl = vi.fn()
    const user = userEvent.setup()
    render(<ImportSourceDialog kind="reading" language="en" busy={false} onClose={() => undefined} onLocal={onLocal} onUrl={onUrl} />)

    await user.type(screen.getByLabelText('Public article URL'), 'https://example.com/story')
    await user.click(screen.getByRole('button', { name: 'Import from URL' }))
    expect(onUrl).toHaveBeenCalledWith('article', 'https://example.com/story')
    await user.click(screen.getByRole('button', { name: 'Choose local Markdown' }))
    expect(onLocal).toHaveBeenCalledOnce()
  })

  it('explains first-use preparation and shows real component progress for a video import', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <ImportSourceDialog
        kind="listening"
        language="en"
        busy={false}
        progress={null}
        onClose={() => undefined}
        onLocal={() => undefined}
        onUrl={() => undefined}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Supported video page' }))
    expect(screen.getByText(/first video import downloads verified components/i)).toBeTruthy()

    rerender(
      <ImportSourceDialog
        kind="listening"
        language="en"
        busy
        progress={{ stage: 'downloading', message: 'Downloading yt-dlp', downloadedBytes: 4096, totalBytes: 8192 }}
        onClose={() => undefined}
        onLocal={() => undefined}
        onUrl={() => undefined}
      />
    )
    expect(screen.getByText('Downloading yt-dlp')).toBeTruthy()
    expect(screen.getByText('4 KB of 8 KB')).toBeTruthy()
  })
})
