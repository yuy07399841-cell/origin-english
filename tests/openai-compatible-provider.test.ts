import { describe, expect, it, vi } from 'vitest'
import { OpenAiCompatibleDefinitionProvider } from '../src/main/providers/openai-compatible-provider'

describe('OpenAI-compatible contextual definition provider', () => {
  it('sends only the selected word and sentence with Bearer authentication', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://models.example.test/v1/chat/completions')
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe('Bearer custom-key-for-test')
      expect(headers.get('api-key')).toBeNull()
      const body = JSON.parse(String(init?.body)) as {
        model: string
        messages: Array<{ role: string; content: string }>
        max_tokens: number
        temperature: number
        stream: boolean
      }
      expect(body.model).toBe('learner-model')
      expect(body.messages[1].content).toBe(
        JSON.stringify({ word: 'context', sentence: 'Context makes the idea clear.' })
      )
      expect(JSON.stringify(body)).not.toContain('full article')
      expect(body.max_tokens).toBe(256)
      expect(body.stream).toBe(false)
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  partOfSpeech: 'noun',
                  definition: 'surrounding information that helps make meaning clear',
                  usage: 'Use context to choose the intended sense.'
                })
              }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }) as typeof fetch
    const provider = new OpenAiCompatibleDefinitionProvider({
      apiKey: 'custom-key-for-test',
      baseUrl: 'https://models.example.test/v1',
      model: 'learner-model',
      fetchImpl: fetchMock
    })

    await expect(
      provider.define({ word: 'context', sentence: 'Context makes the idea clear.' })
    ).resolves.toMatchObject({
      word: 'context',
      partOfSpeech: 'noun',
      source: 'openai-compatible'
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('does not request a Chinese hint until the explicit method is used', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>
        max_tokens: number
      }
      expect(body.messages[1].content).toBe(
        JSON.stringify({
          word: 'noticed',
          sentence: 'I noticed a small change.',
          englishDefinition: 'became aware of something'
        })
      )
      expect(body.max_tokens).toBe(80)
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"hint":"注意到"}' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }) as typeof fetch
    const provider = new OpenAiCompatibleDefinitionProvider({
      apiKey: 'custom-key-for-test',
      baseUrl: 'https://models.example.test/v1',
      model: 'learner-model',
      fetchImpl: fetchMock
    })

    expect(fetchMock).not.toHaveBeenCalled()
    await expect(
      provider.getChineseHint({
        word: 'noticed',
        sentence: 'I noticed a small change.',
        definition: 'became aware of something'
      })
    ).resolves.toEqual({
      hint: '注意到',
      source: 'openai-compatible',
      sourceUrl: null,
      contextual: true
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
