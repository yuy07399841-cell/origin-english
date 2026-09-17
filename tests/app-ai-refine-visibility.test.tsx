// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../src/renderer/src/App'
import type { AppState, DefinitionResult, OriginEnglishApi, RuntimeStatus } from '../src/shared/types'

afterEach(() => vi.restoreAllMocks())

describe('explicit AI definition flow in the application', () => {
  it('keeps an AI-returned Chinese hint hidden until the learner expands it', async () => {
    const state: AppState = {
      schemaVersion: 4,
      uiLanguage: 'en',
      articles: [{
        id: 'article-ai',
        title: 'Explicit AI',
        fileName: 'explicit-ai.md',
        markdown: '# Explicit AI\n\nUnlisted appears here.',
        importedAt: '2026-09-15T00:00:00.000Z'
      }],
      listeningItems: [],
      savedWords: [],
      lookupEvents: []
    }
    const runtime: RuntimeStatus = {
      definitionProvider: 'dictionary',
      aiAvailability: 'text-only',
      configurationSource: 'stored',
      secureStorageAvailable: true,
      aiOnboardingDismissed: true,
      aiConfigurationError: null,
      textAiEnabled: true,
      textAiProvider: 'openai-compatible',
      textAiBaseUrl: 'https://api.example.com/v1',
      textAiModel: 'test-model',
      textCredentialSource: 'stored',
      liveMimoEnabled: false,
      credentialStatus: 'configured',
      mimoModel: null,
      mimoBudgetLimitCny: null,
      mimoEstimatedSpendCny: null,
      sentenceAudioEnabled: false,
      sentenceAudioModel: null,
      sentenceAudioVoice: null,
      sentenceAudioCredentialMode: 'separate',
      sentenceAudioCredentialSource: 'none',
      sentenceAudioGenerationCount: null,
      sentenceAudioGenerationLimit: null
    }
    const localMiss: DefinitionResult = {
      word: 'Unlisted', partOfSpeech: '', definition: '', usage: '', contextualChineseHint: null,
      source: 'not-found', notice: 'not found', phonetic: null, hasAudio: false,
      hasAlternativeSenses: false, hasChineseReference: false, sourceUrl: null, senses: []
    }
    const refined: DefinitionResult = {
      ...localMiss,
      partOfSpeech: 'adjective',
      definition: 'Not included in a list.',
      contextualChineseHint: {
        hint: '未列出的', source: 'openai-compatible', sourceUrl: null, contextual: true
      },
      source: 'openai-compatible',
      notice: 'AI result'
    }
    const api = {
      loadState: vi.fn(async () => state),
      getRuntimeStatus: vi.fn(async () => runtime),
      defineWord: vi.fn(async () => localMiss),
      refineDefinition: vi.fn(async () => refined),
      recordLookup: vi.fn(async () => ({ state, lookupId: 'lookup-1' }))
    } as unknown as OriginEnglishApi
    Object.defineProperty(window, 'originEnglish', { configurable: true, value: api })
    const user = userEvent.setup()

    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Open article: Explicit AI' }))
    await user.click(await screen.findByText('Unlisted'))
    await user.click(await screen.findByRole('button', { name: 'Use text AI to explain this word' }))
    await waitFor(() => expect(api.refineDefinition).toHaveBeenCalledOnce())

    expect(screen.queryByText('未列出的')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show Chinese meaning' }))
    expect(await screen.findByText('未列出的')).toBeTruthy()
  })
})
