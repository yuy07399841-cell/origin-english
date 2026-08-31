import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AiServiceConfigStore,
  normalizeOpenAiCompatibleBaseUrl,
  type SafeStorageAdapter
} from '../src/main/ai-service-config'

const temporaryDirectories: string[] = []

class FakeSafeStorage implements SafeStorageAdapter {
  constructor(private readonly available = true) {}

  isEncryptionAvailable(): boolean {
    return this.available
  }

  encryptString(value: string): Buffer {
    return Buffer.from(Buffer.from(value, 'utf8').map((byte) => byte ^ 0xa5))
  }

  decryptString(value: Buffer): string {
    return Buffer.from(value.map((byte) => byte ^ 0xa5)).toString('utf8')
  }
}

async function createStore(available = true): Promise<{
  directory: string
  filePath: string
  store: AiServiceConfigStore
}> {
  const directory = await mkdtemp(join(tmpdir(), 'origin-ai-config-'))
  temporaryDirectories.push(directory)
  const filePath = join(directory, 'ai-services.json')
  return { directory, filePath, store: new AiServiceConfigStore(filePath, new FakeSafeStorage(available)) }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

describe('AI service credential configuration', () => {
  it('starts in local mode without a credential and uses the legacy environment only before settings exist', async () => {
    const { store } = await createStore()
    await expect(store.read({})).resolves.toMatchObject({
      textProvider: 'none',
      sentenceAudioEnabled: false,
      configurationSource: 'none',
      onboardingDismissed: false
    })
    await expect(store.read({ MIMO_API_KEY: 'legacy-environment-key' })).resolves.toMatchObject({
      textProvider: 'mimo',
      textApiKey: 'legacy-environment-key',
      textCredentialSource: 'environment',
      sentenceAudioEnabled: true,
      sentenceAudioApiKey: 'legacy-environment-key',
      sentenceAudioCredentialSource: 'environment',
      configurationSource: 'environment',
      onboardingDismissed: true
    })
  })

  it('encrypts saved keys, preserves a blank existing slot and never writes plaintext', async () => {
    const { filePath, store } = await createStore()
    const textKey = 'text-key-only-for-tests'
    const audioKey = 'audio-key-only-for-tests'
    await store.update(
      {
        textProvider: 'openai-compatible',
        textBaseUrl: 'https://models.example.test/v1/',
        textModel: 'example-model',
        textApiKey: textKey,
        sentenceAudioEnabled: true,
        sentenceAudioCredentialMode: 'separate',
        sentenceAudioApiKey: audioKey
      },
      {}
    )

    const fileText = await readFile(filePath, 'utf8')
    expect(fileText).not.toContain(textKey)
    expect(fileText).not.toContain(audioKey)
    expect(fileText).not.toContain('Bearer')
    await expect(store.read({})).resolves.toMatchObject({
      textProvider: 'openai-compatible',
      textBaseUrl: 'https://models.example.test/v1',
      textModel: 'example-model',
      textApiKey: textKey,
      textCredentialSource: 'stored',
      sentenceAudioApiKey: audioKey,
      sentenceAudioCredentialSource: 'stored',
      configurationSource: 'stored'
    })

    await expect(
      store.update(
        {
          textProvider: 'openai-compatible',
          textBaseUrl: 'https://models.example.test/v1',
          textModel: 'example-model-2',
          textApiKey: '',
          sentenceAudioEnabled: true,
          sentenceAudioCredentialMode: 'separate',
          sentenceAudioApiKey: ''
        },
        {}
      )
    ).resolves.toMatchObject({ textApiKey: textKey, sentenceAudioApiKey: audioKey })
  })

  it('persists explicit local mode so disconnect is not undone by an environment key', async () => {
    const { filePath, store } = await createStore()
    await store.update(
      {
        textProvider: 'mimo',
        textBaseUrl: '',
        textModel: '',
        textApiKey: 'stored-mimo-key',
        sentenceAudioEnabled: true,
        sentenceAudioCredentialMode: 'reuse-text',
        sentenceAudioApiKey: ''
      },
      {}
    )
    await store.disconnectAll()
    await expect(store.read({ MIMO_API_KEY: 'must-not-reactivate' })).resolves.toMatchObject({
      textProvider: 'none',
      textApiKey: null,
      sentenceAudioEnabled: false,
      sentenceAudioApiKey: null,
      configurationSource: 'stored',
      onboardingDismissed: true
    })
    expect(await readFile(filePath, 'utf8')).not.toContain('stored-mimo-key')
  })

  it('allows only HTTPS or local loopback HTTP for a custom provider', () => {
    expect(normalizeOpenAiCompatibleBaseUrl('https://example.test/v1/')).toBe(
      'https://example.test/v1'
    )
    expect(normalizeOpenAiCompatibleBaseUrl('http://127.0.0.1:11434/v1/')).toBe(
      'http://127.0.0.1:11434/v1'
    )
    expect(() => normalizeOpenAiCompatibleBaseUrl('http://example.test/v1')).toThrow('HTTPS')
    expect(() => normalizeOpenAiCompatibleBaseUrl('https://user:pass@example.test/v1')).toThrow(
      'credentials'
    )
    expect(() => normalizeOpenAiCompatibleBaseUrl('https://example.test/v1?token=secret')).toThrow(
      'query'
    )
  })

  it('blocks saving a key when secure storage is unavailable but still allows local mode', async () => {
    const { store } = await createStore(false)
    await expect(
      store.update(
        {
          textProvider: 'mimo',
          textBaseUrl: '',
          textModel: '',
          textApiKey: 'cannot-save-this',
          sentenceAudioEnabled: false,
          sentenceAudioCredentialMode: 'separate',
          sentenceAudioApiKey: ''
        },
        {}
      )
    ).rejects.toThrow('Secure credential storage')
    await expect(store.disconnectAll()).resolves.toMatchObject({
      textProvider: 'none',
      configurationSource: 'stored'
    })
  })
})
