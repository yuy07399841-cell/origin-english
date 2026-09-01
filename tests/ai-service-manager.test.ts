import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AiServiceConfigStore,
  type SafeStorageAdapter
} from '../src/main/ai-service-config'
import { AiServiceManager } from '../src/main/ai-service-manager'
import { EcdictChineseDictionary } from '../src/main/chinese-dictionary'
import { SimpleEnglishDictionary } from '../src/main/dictionary'

const temporaryDirectories: string[] = []

class FakeSafeStorage implements SafeStorageAdapter {
  isEncryptionAvailable(): boolean {
    return true
  }

  encryptString(value: string): Buffer {
    return Buffer.from(Buffer.from(value, 'utf8').map((byte) => byte ^ 0x6d))
  }

  decryptString(value: Buffer): string {
    return Buffer.from(value.map((byte) => byte ^ 0x6d)).toString('utf8')
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

async function createManager(fetchImpl: typeof fetch): Promise<AiServiceManager> {
  const directory = await mkdtemp(join(tmpdir(), 'origin-ai-manager-'))
  temporaryDirectories.push(directory)
  const dictionaryPath = join(directory, 'simple.data')
  const chinesePath = join(directory, 'chinese.data')
  await Promise.all([
    writeFile(
      dictionaryPath,
      JSON.stringify({
        schemaVersion: 1,
        source: 'Simple English Wiktionary',
        sourceUrl: 'https://simple.wiktionary.org/',
        license: 'CC BY-SA 4.0',
        entryCount: 1,
        entries: {
          notice: {
            h: 'notice',
            s: [{ p: 'verb', d: [{ m: 'to become aware of something' }] }]
          }
        }
      }),
      'utf8'
    ),
    writeFile(
      chinesePath,
      JSON.stringify({
        schemaVersion: 1,
        source: 'ECDICT',
        sourceUrl: 'https://github.com/skywind3000/ECDICT',
        license: 'MIT',
        sourceSha256: 'test',
        targetHeadwordCount: 1,
        entryCount: 1,
        entries: { notice: 'v. 注意到' }
      }),
      'utf8'
    )
  ])
  const manager = new AiServiceManager({
    configStore: new AiServiceConfigStore(
      join(directory, 'ai-services.json'),
      new FakeSafeStorage()
    ),
    dataDirectory: directory,
    dictionary: new SimpleEnglishDictionary(dictionaryPath),
    chineseDictionary: new EcdictChineseDictionary(chinesePath),
    environment: {},
    fetchImpl
  })
  await manager.initialize()
  return manager
}

describe('AI service runtime switching', () => {
  it('moves from local to partial and ready states without making a network request', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('No network request is allowed in this test.')
    }) as typeof fetch
    const manager = await createManager(fetchMock)

    await expect(manager.status()).resolves.toMatchObject({
      aiAvailability: 'local',
      textAiEnabled: false,
      sentenceAudioEnabled: false,
      aiOnboardingDismissed: false
    })

    const textOnly = await manager.configure({
      textProvider: 'openai-compatible',
      textBaseUrl: 'https://models.example.test/v1',
      textModel: 'learner-model',
      textApiKey: 'text-manager-test-key',
      sentenceAudioEnabled: false,
      sentenceAudioCredentialMode: 'separate',
      sentenceAudioApiKey: ''
    })
    expect(textOnly).toMatchObject({
      aiAvailability: 'text-only',
      textAiProvider: 'openai-compatible',
      textAiEnabled: true,
      sentenceAudioEnabled: false,
      configurationSource: 'stored'
    })
    expect(JSON.stringify(textOnly)).not.toContain('text-manager-test-key')

    const ready = await manager.configure({
      textProvider: 'openai-compatible',
      textBaseUrl: 'https://models.example.test/v1',
      textModel: 'learner-model',
      textApiKey: '',
      sentenceAudioEnabled: true,
      sentenceAudioCredentialMode: 'separate',
      sentenceAudioApiKey: 'audio-manager-test-key'
    })
    expect(ready).toMatchObject({
      aiAvailability: 'ready',
      textAiEnabled: true,
      sentenceAudioEnabled: true,
      sentenceAudioCredentialMode: 'separate'
    })
    expect(JSON.stringify(ready)).not.toContain('audio-manager-test-key')

    await expect(manager.disconnectAll()).resolves.toMatchObject({
      aiAvailability: 'local',
      textAiEnabled: false,
      sentenceAudioEnabled: false,
      configurationSource: 'stored',
      aiOnboardingDismissed: true
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns English and Chinese contextual meanings in one text AI request', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>
      }
      expect(body.messages[1].content).toBe(
        JSON.stringify({ word: 'notice', sentence: 'I noticed a small change.' })
      )
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  partOfSpeech: 'verb',
                  definition: 'to become aware of something',
                  chineseDefinition: '注意到；察觉到',
                  usage: 'notice a small change'
                })
              }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }) as typeof fetch
    const manager = await createManager(fetchMock)
    await manager.configure({
      textProvider: 'openai-compatible',
      textBaseUrl: 'https://models.example.test/v1',
      textModel: 'learner-model',
      textApiKey: 'text-manager-test-key',
      sentenceAudioEnabled: false,
      sentenceAudioCredentialMode: 'separate',
      sentenceAudioApiKey: ''
    })

    await expect(
      manager.refine({ word: 'notice', sentence: 'I noticed a small change.' })
    ).resolves.toMatchObject({
      definition: 'to become aware of something',
      hasChineseReference: true,
      contextualChineseHint: {
        hint: '注意到；察觉到',
        source: 'openai-compatible',
        contextual: true
      }
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
