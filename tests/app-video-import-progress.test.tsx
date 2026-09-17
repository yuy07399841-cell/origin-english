// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../src/renderer/src/App'
import type { AppState, ListeningItem, OriginEnglishApi, RuntimeStatus } from '../src/shared/types'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const emptyState: AppState = {
  schemaVersion: 4, uiLanguage: 'en', articles: [], listeningItems: [], savedWords: [], lookupEvents: []
}
const runtime: RuntimeStatus = {
  definitionProvider: 'dictionary', aiAvailability: 'local', configurationSource: 'none',
  secureStorageAvailable: true, aiOnboardingDismissed: true, aiConfigurationError: null,
  textAiEnabled: false, textAiProvider: 'none', textAiBaseUrl: null, textAiModel: null,
  textCredentialSource: 'none', liveMimoEnabled: false, credentialStatus: 'not-configured',
  mimoModel: null, mimoBudgetLimitCny: null, mimoEstimatedSpendCny: null,
  sentenceAudioEnabled: false, sentenceAudioModel: null, sentenceAudioVoice: null,
  sentenceAudioCredentialMode: 'separate', sentenceAudioCredentialSource: 'none',
  sentenceAudioGenerationCount: null, sentenceAudioGenerationLimit: null
}

function installApi(overrides: Partial<OriginEnglishApi> = {}): OriginEnglishApi {
  const api = {
    loadState: vi.fn(async () => emptyState),
    getRuntimeStatus: vi.fn(async () => runtime),
    importListening: vi.fn(async () => null),
    importListeningAudioUrl: vi.fn(),
    importListeningVideoUrl: vi.fn(),
    cancelListeningVideoImport: vi.fn(),
    getListeningAudio: vi.fn(async () => ({ dataUrl: 'data:audio/mpeg;base64,SUQz', mimeType: 'audio/mpeg', bytes: 4 })),
    ...overrides
  } as unknown as OriginEnglishApi
  Object.defineProperty(window, 'originEnglish', { configurable: true, value: api })
  return api
}

describe('video component preparation in the application', () => {
  it.each(['article-local', 'article-url', 'audio-local', 'audio-url', 'video-url'] as const)(
    'dismisses the import dialog after %s succeeds, including after returning to the library', async (kind) => {
      const article = { id: 'article-imported', title: 'Imported article', fileName: 'imported.md',
        markdown: 'Some English text.', importedAt: '2026-09-17T00:00:00.000Z' }
      const item: ListeningItem = { id: 'aaaa-9999', title: 'Imported audio', fileName: 'imported.mp3',
        storedFileName: 'audio-aaaa-9999.mp3', mimeType: 'audio/mpeg', bytes: 853,
        importedAt: '2026-09-17T00:00:00.000Z', transcript: null }
      installApi({ importMarkdown: vi.fn(async () => article), importArticleUrl: vi.fn(async () => ({ article, warnings: [] })),
        importListening: vi.fn(async () => item), importListeningAudioUrl: vi.fn(async () => item),
        importListeningVideoUrl: vi.fn(async () => item) })
      const user = userEvent.setup()
      render(<App />)
      await screen.findByRole('button', { name: 'Import' })
      const reading = kind.startsWith('article')
      const local = kind.endsWith('local')
      if (!reading) await user.click(screen.getByRole('button', { name: 'Listening' }))
      await user.click(screen.getByRole('button', { name: 'Import' }))
      if (local) {
        await user.click(screen.getByRole('button', { name: reading ? 'Choose local Markdown' : 'Choose local MP3 / WAV' }))
      } else {
        if (kind === 'video-url') await user.click(screen.getByRole('button', { name: 'Supported video page' }))
        await user.type(screen.getByLabelText(reading ? 'Public article URL' : 'Public audio or video URL'), 'https://example.com/material')
        await user.click(screen.getByRole('button', { name: 'Import from URL' }))
      }
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      if (!local) {
        await user.click(document.querySelector<HTMLButtonElement>('.back-button')!)
        expect(screen.queryByRole('dialog')).toBeNull()
      }
    }
  )

  it('does not prepare video components during startup or non-video imports', async () => {
    const directItem: ListeningItem = {
      id: 'aaaa-1111', title: 'Direct audio', fileName: 'direct.mp3', storedFileName: 'audio-aaaa-1111.mp3',
      mimeType: 'audio/mpeg', bytes: 853, importedAt: '2026-09-15T00:00:00.000Z', transcript: null
    }
    const api = installApi({ importListeningAudioUrl: vi.fn(async () => directItem) })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Listening' }))
    expect(api.importListeningVideoUrl).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Import' }))
    await user.click(screen.getByRole('button', { name: 'Choose local MP3 / WAV' }))
    expect(api.importListeningVideoUrl).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText('Public audio or video URL'), 'https://example.com/direct.mp3')
    await user.click(screen.getByRole('button', { name: 'Import from URL' }))
    await screen.findByRole('heading', { name: 'Direct audio', level: 1 })
    expect(api.importListeningVideoUrl).not.toHaveBeenCalled()
  })

  it('shows progress from the public video import call and continues the same import', async () => {
    const item: ListeningItem = {
      id: 'bbbb-2222', title: 'Prepared video audio', fileName: 'prepared.mp3', storedFileName: 'audio-bbbb-2222.mp3',
      mimeType: 'audio/mpeg', bytes: 853, importedAt: '2026-09-15T00:00:00.000Z', transcript: null
    }
    let finish!: (item: ListeningItem) => void
    const imported = new Promise<ListeningItem>((resolve) => { finish = resolve })
    const importVideo = vi.fn(async (_url: string, onProgress?: (event: { stage: 'downloading'; message: string; downloadedBytes: number; totalBytes: number }) => void) => {
      onProgress?.({ stage: 'downloading', message: 'Downloading FFmpeg', downloadedBytes: 4096, totalBytes: 8192 })
      return imported
    })
    installApi({ importListeningVideoUrl: importVideo as OriginEnglishApi['importListeningVideoUrl'] })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Listening' }))
    await user.click(screen.getByRole('button', { name: 'Import' }))
    await user.click(screen.getByRole('button', { name: 'Supported video page' }))
    await user.type(screen.getByLabelText('Public audio or video URL'), 'https://commons.wikimedia.org/wiki/File:Sample.webm')
    await user.click(screen.getByRole('button', { name: 'Import from URL' }))

    expect(await screen.findByText('Downloading FFmpeg')).toBeTruthy()
    expect(screen.getByText('4 KB of 8 KB')).toBeTruthy()
    finish(item)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByRole('heading', { name: 'Prepared video audio', level: 1 })).toBeTruthy()
  })

  it('keeps the dialog usable after a preparation failure so the learner can retry', async () => {
    const item: ListeningItem = {
      id: 'cccc-3333', title: 'Retry succeeded', fileName: 'retry.mp3', storedFileName: 'audio-cccc-3333.mp3',
      mimeType: 'audio/mpeg', bytes: 853, importedAt: '2026-09-15T00:00:00.000Z', transcript: null
    }
    const importVideo = vi.fn()
      .mockRejectedValueOnce(new Error('Component integrity check failed. Nothing was installed.'))
      .mockResolvedValueOnce(item)
    installApi({ importListeningVideoUrl: importVideo })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Listening' }))
    await user.click(screen.getByRole('button', { name: 'Import' }))
    await user.click(screen.getByRole('button', { name: 'Supported video page' }))
    await user.type(screen.getByLabelText('Public audio or video URL'), 'https://commons.wikimedia.org/wiki/File:Retry.webm')
    await user.click(screen.getByRole('button', { name: 'Import from URL' }))

    expect(await screen.findByText('Component integrity check failed. Nothing was installed.')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Import from URL' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByRole('heading', { name: 'Retry succeeded', level: 1 })).toBeTruthy()
    expect(importVideo).toHaveBeenCalledTimes(2)
  })

  it('lets the learner cancel an in-progress video import', async () => {
    let rejectImport!: (error: Error) => void
    const imported = new Promise<ListeningItem>((_resolve, reject) => { rejectImport = reject })
    const importVideo = vi.fn(async (_url: string, onProgress?: (event: { stage: 'checking'; message: string }) => void) => {
      onProgress?.({ stage: 'checking', message: 'Checking video components' })
      return imported
    })
    const cancelImport = vi.fn(() => rejectImport(new Error('Video import was cancelled.')))
    const api = installApi({
      importListeningVideoUrl: importVideo as OriginEnglishApi['importListeningVideoUrl'],
      cancelListeningVideoImport: cancelImport
    })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Listening' }))
    await user.click(screen.getByRole('button', { name: 'Import' }))
    await user.click(screen.getByRole('button', { name: 'Supported video page' }))
    await user.type(screen.getByLabelText('Public audio or video URL'), 'https://commons.wikimedia.org/wiki/File:Cancel.webm')
    await user.click(screen.getByRole('button', { name: 'Import from URL' }))
    await screen.findByText('Checking video components')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(api.cancelListeningVideoImport).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
