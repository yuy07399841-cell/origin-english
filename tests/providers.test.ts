import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { MiMoBudgetGuard } from '../src/main/mimo-budget'
import { MiMoDefinitionProvider } from '../src/main/providers/mimo-provider'
import { PreviewDefinitionProvider } from '../src/main/providers/preview-provider'
import { createRuntimeConfig } from '../src/main/runtime-config'

describe('definition providers', () => {
  it('uses preview without a credential and enables MiMo without exposing it', () => {
    expect(createRuntimeConfig({})).toEqual({
      definitionProvider: 'dictionary',
      liveMimoEnabled: false,
      credentialStatus: 'not-configured',
      mimoModel: null,
      mimoBudgetLimitCny: null,
      sentenceAudioEnabled: false,
      sentenceAudioModel: null,
      sentenceAudioVoice: null,
      sentenceAudioGenerationLimit: null
    })
    expect(createRuntimeConfig({ MIMO_API_KEY: 'test-key' })).toEqual({
      definitionProvider: 'dictionary',
      liveMimoEnabled: true,
      credentialStatus: 'configured',
      mimoModel: 'mimo-v2.5',
      mimoBudgetLimitCny: 5,
      sentenceAudioEnabled: true,
      sentenceAudioModel: 'mimo-v2.5-tts',
      sentenceAudioVoice: 'Mia',
      sentenceAudioGenerationLimit: 100
    })
  })

  it('labels preview output clearly', async () => {
    const provider = new PreviewDefinitionProvider()
    const result = await provider.define({
      word: 'sustained',
      sentence: 'Sustained attention can reveal a pattern.'
    })
    expect(result.source).toBe('preview')
    expect(result.notice).toContain('No remote AI service was called')
    expect(result.partOfSpeech).toBe('verb')
    expect(result.definition).toContain('continuing')
  })

  it('limits a future MiMo request to the word and current sentence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-english-provider-'))
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>
        max_completion_tokens: number
        thinking: { type: string }
        model: string
      }
      expect(body.messages[1].content).toBe(
        JSON.stringify({ word: 'context', sentence: 'Context makes the idea clear.' })
      )
      expect(JSON.stringify(body)).not.toContain('full article')
      expect(body.model).toBe('mimo-v2.5')
      expect(body.max_completion_tokens).toBe(256)
      expect(body.thinking.type).toBe('disabled')
      expect(new Headers(init?.headers).get('api-key')).toBe('test-key-not-a-real-secret')
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  partOfSpeech: 'noun',
                  definition: 'surrounding information that makes meaning clear',
                  usage: 'Use context to choose the intended sense.'
                })
              }
            }
          ],
          usage: { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165 }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }) as typeof fetch

    try {
      const provider = new MiMoDefinitionProvider({
        apiKey: 'test-key-not-a-real-secret',
        fetchImpl: fetchMock,
        budgetGuard: new MiMoBudgetGuard(join(directory, 'usage.json'), 5)
      })
      const result = await provider.define({
        word: 'context',
        sentence: 'Context makes the idea clear.'
      })

      expect(fetchMock).toHaveBeenCalledOnce()
      expect(result.source).toBe('mimo')
      expect(result.partOfSpeech).toBe('noun')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('only requests a Chinese hint after the explicit method is called', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-english-provider-'))
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>
        max_completion_tokens: number
      }
      expect(body.messages[1].content).toBe(
        JSON.stringify({
          word: 'notice',
          sentence: 'I noticed a small change.',
          englishDefinition: 'to become aware of something'
        })
      )
      expect(body.max_completion_tokens).toBe(80)
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ hint: '注意到' }) } }],
          usage: { prompt_tokens: 60, completion_tokens: 8 }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }) as typeof fetch

    try {
      const provider = new MiMoDefinitionProvider({
        apiKey: 'test-key-not-a-real-secret',
        fetchImpl: fetchMock,
        budgetGuard: new MiMoBudgetGuard(join(directory, 'usage.json'), 5)
      })
      expect(fetchMock).not.toHaveBeenCalled()
      await expect(
        provider.getChineseHint({
          word: 'notice',
          sentence: 'I noticed a small change.',
          definition: 'to become aware of something'
        })
      ).resolves.toEqual({
        hint: '注意到',
        source: 'mimo',
        sourceUrl: null,
        contextual: true
      })
      expect(fetchMock).toHaveBeenCalledOnce()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
