import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  AiCredentialSource,
  AiServiceSettingsUpdate,
  SentenceAudioCredentialMode,
  TextAiProvider
} from '../shared/types'

export const AI_SERVICE_CONFIG_VERSION = 1 as const
export const MIMO_TEXT_BASE_URL = 'https://api.xiaomimimo.com/v1'
export const MIMO_TEXT_MODEL = 'mimo-v2.5'
export const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = 'https://api.openai.com/v1'

type RuntimeEnvironment = Record<string, string | undefined>

export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

interface StoredAiServiceConfig {
  version: typeof AI_SERVICE_CONFIG_VERSION
  textProvider: TextAiProvider
  textBaseUrl: string | null
  textModel: string | null
  textCredential: string | null
  sentenceAudioEnabled: boolean
  sentenceAudioCredentialMode: SentenceAudioCredentialMode
  sentenceAudioCredential: string | null
  onboardingDismissed: boolean
}

export interface ResolvedAiServiceConfig {
  textProvider: TextAiProvider
  textBaseUrl: string | null
  textModel: string | null
  textApiKey: string | null
  textCredentialSource: AiCredentialSource
  sentenceAudioEnabled: boolean
  sentenceAudioCredentialMode: SentenceAudioCredentialMode
  sentenceAudioApiKey: string | null
  sentenceAudioCredentialSource: AiCredentialSource
  configurationSource: 'none' | 'stored' | 'environment'
  onboardingDismissed: boolean
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function isStoredConfig(value: unknown): value is StoredAiServiceConfig {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<StoredAiServiceConfig>
  return (
    candidate.version === AI_SERVICE_CONFIG_VERSION &&
    (candidate.textProvider === 'none' ||
      candidate.textProvider === 'mimo' ||
      candidate.textProvider === 'openai-compatible') &&
    (candidate.textBaseUrl === null || typeof candidate.textBaseUrl === 'string') &&
    (candidate.textModel === null || typeof candidate.textModel === 'string') &&
    (candidate.textCredential === null || typeof candidate.textCredential === 'string') &&
    typeof candidate.sentenceAudioEnabled === 'boolean' &&
    (candidate.sentenceAudioCredentialMode === 'reuse-text' ||
      candidate.sentenceAudioCredentialMode === 'separate') &&
    (candidate.sentenceAudioCredential === null ||
      typeof candidate.sentenceAudioCredential === 'string') &&
    typeof candidate.onboardingDismissed === 'boolean'
  )
}

function requireShortText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${label} is required.`)
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${label} must contain between 1 and ${maxLength} characters.`)
  }
  return normalized
}

function normalizeSecret(value: unknown, label: string): string | null {
  if (value === undefined || value === '') return null
  return requireShortText(value, label, 4_096)
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '[::1]'
}

export function normalizeOpenAiCompatibleBaseUrl(value: unknown): string {
  const raw = requireShortText(value, 'Base URL', 2_048)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Base URL must be a valid absolute URL.')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Base URL cannot contain credentials, a query, or a fragment.')
  }
  const isAllowedHttp = url.protocol === 'http:' && isLoopbackHost(url.hostname)
  if (url.protocol !== 'https:' && !isAllowedHttp) {
    throw new Error('Base URL must use HTTPS, except for a local loopback address.')
  }
  return url.toString().replace(/\/$/, '')
}

export function validateAiServiceSettingsUpdate(value: unknown): AiServiceSettingsUpdate {
  if (!value || typeof value !== 'object') throw new Error('AI service settings are required.')
  const input = value as Partial<AiServiceSettingsUpdate>
  if (
    input.textProvider !== 'none' &&
    input.textProvider !== 'mimo' &&
    input.textProvider !== 'openai-compatible'
  ) {
    throw new Error('Text AI provider is invalid.')
  }
  if (typeof input.sentenceAudioEnabled !== 'boolean') {
    throw new Error('Sentence audio setting is invalid.')
  }
  if (
    input.sentenceAudioCredentialMode !== 'reuse-text' &&
    input.sentenceAudioCredentialMode !== 'separate'
  ) {
    throw new Error('Sentence audio credential mode is invalid.')
  }
  if (
    input.sentenceAudioEnabled &&
    input.sentenceAudioCredentialMode === 'reuse-text' &&
    input.textProvider !== 'mimo'
  ) {
    throw new Error('MiMo sentence audio can reuse the text key only when text AI also uses MiMo.')
  }

  return {
    textProvider: input.textProvider,
    textBaseUrl:
      input.textProvider === 'openai-compatible'
        ? normalizeOpenAiCompatibleBaseUrl(input.textBaseUrl)
        : '',
    textModel:
      input.textProvider === 'openai-compatible'
        ? requireShortText(input.textModel, 'Model', 200)
        : '',
    textApiKey: normalizeSecret(input.textApiKey, 'Text API key') ?? undefined,
    sentenceAudioEnabled: input.sentenceAudioEnabled,
    sentenceAudioCredentialMode: input.sentenceAudioCredentialMode,
    sentenceAudioApiKey:
      normalizeSecret(input.sentenceAudioApiKey, 'MiMo sentence audio API key') ?? undefined
  }
}

export function createDisabledAiServiceConfig(
  onboardingDismissed = false,
  configurationSource: ResolvedAiServiceConfig['configurationSource'] = 'none'
): ResolvedAiServiceConfig {
  return {
    textProvider: 'none',
    textBaseUrl: null,
    textModel: null,
    textApiKey: null,
    textCredentialSource: 'none',
    sentenceAudioEnabled: false,
    sentenceAudioCredentialMode: 'separate',
    sentenceAudioApiKey: null,
    sentenceAudioCredentialSource: 'none',
    configurationSource,
    onboardingDismissed
  }
}

export class AiServiceConfigStore {
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly filePath: string,
    private readonly safeStorage: SafeStorageAdapter
  ) {}

  isSecureStorageAvailable(): boolean {
    return this.safeStorage.isEncryptionAvailable()
  }

  private async readStored(): Promise<StoredAiServiceConfig | null> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
      if (!isStoredConfig(parsed)) throw new Error('AI service settings use an unsupported structure.')
      return parsed
    } catch (error) {
      if (isMissingFile(error)) return null
      if (error instanceof SyntaxError) throw new Error('AI service settings are damaged.')
      throw error
    }
  }

  private decrypt(value: string, label: string): string {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure credential storage is unavailable. AI services are disabled.')
    }
    try {
      const decrypted = this.safeStorage.decryptString(Buffer.from(value, 'base64')).trim()
      if (!decrypted) throw new Error('empty')
      return decrypted
    } catch {
      throw new Error(`${label} could not be decrypted. AI services are disabled.`)
    }
  }

  private encrypt(value: string): string {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure credential storage is unavailable. New API keys cannot be saved.')
    }
    return this.safeStorage.encryptString(value).toString('base64')
  }

  private async writeStored(config: StoredAiServiceConfig): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, this.filePath)
  }

  private resolveStored(config: StoredAiServiceConfig): ResolvedAiServiceConfig {
    let textApiKey: string | null = null
    if (config.textProvider !== 'none') {
      if (!config.textCredential) throw new Error('The text AI credential is missing.')
      textApiKey = this.decrypt(config.textCredential, 'The text AI credential')
    }

    let sentenceAudioApiKey: string | null = null
    if (config.sentenceAudioEnabled) {
      if (config.sentenceAudioCredentialMode === 'reuse-text') {
        if (config.textProvider !== 'mimo' || !textApiKey) {
          throw new Error('The MiMo sentence audio credential cannot reuse this text provider.')
        }
        sentenceAudioApiKey = textApiKey
      } else {
        if (!config.sentenceAudioCredential) {
          throw new Error('The MiMo sentence audio credential is missing.')
        }
        sentenceAudioApiKey = this.decrypt(
          config.sentenceAudioCredential,
          'The MiMo sentence audio credential'
        )
      }
    }

    return {
      textProvider: config.textProvider,
      textBaseUrl:
        config.textProvider === 'mimo'
          ? MIMO_TEXT_BASE_URL
          : config.textProvider === 'openai-compatible'
            ? normalizeOpenAiCompatibleBaseUrl(config.textBaseUrl)
            : null,
      textModel:
        config.textProvider === 'mimo'
          ? MIMO_TEXT_MODEL
          : config.textProvider === 'openai-compatible'
            ? requireShortText(config.textModel, 'Model', 200)
            : null,
      textApiKey,
      textCredentialSource: textApiKey ? 'stored' : 'none',
      sentenceAudioEnabled: config.sentenceAudioEnabled,
      sentenceAudioCredentialMode: config.sentenceAudioCredentialMode,
      sentenceAudioApiKey,
      sentenceAudioCredentialSource: sentenceAudioApiKey ? 'stored' : 'none',
      configurationSource: 'stored',
      onboardingDismissed: config.onboardingDismissed
    }
  }

  async read(environment: RuntimeEnvironment = process.env): Promise<ResolvedAiServiceConfig> {
    const stored = await this.readStored()
    if (stored) return this.resolveStored(stored)

    const environmentKey = environment.MIMO_API_KEY?.trim()
    if (!environmentKey) return createDisabledAiServiceConfig()
    return {
      textProvider: 'mimo',
      textBaseUrl: MIMO_TEXT_BASE_URL,
      textModel: MIMO_TEXT_MODEL,
      textApiKey: environmentKey,
      textCredentialSource: 'environment',
      sentenceAudioEnabled: true,
      sentenceAudioCredentialMode: 'reuse-text',
      sentenceAudioApiKey: environmentKey,
      sentenceAudioCredentialSource: 'environment',
      configurationSource: 'environment',
      onboardingDismissed: true
    }
  }

  async update(
    rawInput: unknown,
    environment: RuntimeEnvironment = process.env
  ): Promise<ResolvedAiServiceConfig> {
    const input = validateAiServiceSettingsUpdate(rawInput)
    let resolved = createDisabledAiServiceConfig(true, 'stored')
    const operation = this.queue.then(async () => {
      const existing = await this.readStored()
      const environmentKey = environment.MIMO_API_KEY?.trim() || null

      let textCredential: string | null = null
      if (input.textProvider !== 'none') {
        if (input.textApiKey) {
          textCredential = this.encrypt(input.textApiKey)
        } else if (existing?.textProvider === input.textProvider && existing.textCredential) {
          textCredential = existing.textCredential
        } else if (input.textProvider === 'mimo' && !existing && environmentKey) {
          textCredential = this.encrypt(environmentKey)
        } else {
          throw new Error('Enter an API key for the selected text AI provider.')
        }
      }

      let sentenceAudioCredential: string | null = null
      if (input.sentenceAudioEnabled && input.sentenceAudioCredentialMode === 'separate') {
        if (input.sentenceAudioApiKey) {
          sentenceAudioCredential = this.encrypt(input.sentenceAudioApiKey)
        } else if (
          existing?.sentenceAudioEnabled &&
          existing.sentenceAudioCredentialMode === 'separate' &&
          existing.sentenceAudioCredential
        ) {
          sentenceAudioCredential = existing.sentenceAudioCredential
        } else if (!existing && environmentKey) {
          sentenceAudioCredential = this.encrypt(environmentKey)
        } else {
          throw new Error('Enter a MiMo API key for natural sentence audio.')
        }
      }

      const stored: StoredAiServiceConfig = {
        version: AI_SERVICE_CONFIG_VERSION,
        textProvider: input.textProvider,
        textBaseUrl:
          input.textProvider === 'openai-compatible' ? input.textBaseUrl : null,
        textModel: input.textProvider === 'openai-compatible' ? input.textModel : null,
        textCredential,
        sentenceAudioEnabled: input.sentenceAudioEnabled,
        sentenceAudioCredentialMode: input.sentenceAudioEnabled
          ? input.sentenceAudioCredentialMode
          : 'separate',
        sentenceAudioCredential,
        onboardingDismissed: true
      }
      await this.writeStored(stored)
      resolved = this.resolveStored(stored)
    })
    this.queue = operation.catch(() => undefined)
    await operation
    return resolved
  }

  async disconnectAll(): Promise<ResolvedAiServiceConfig> {
    let resolved = createDisabledAiServiceConfig(true, 'stored')
    const operation = this.queue.then(async () => {
      const stored: StoredAiServiceConfig = {
        version: AI_SERVICE_CONFIG_VERSION,
        textProvider: 'none',
        textBaseUrl: null,
        textModel: null,
        textCredential: null,
        sentenceAudioEnabled: false,
        sentenceAudioCredentialMode: 'separate',
        sentenceAudioCredential: null,
        onboardingDismissed: true
      }
      await this.writeStored(stored)
      resolved = this.resolveStored(stored)
    })
    this.queue = operation.catch(() => undefined)
    await operation
    return resolved
  }

  async dismissOnboarding(
    environment: RuntimeEnvironment = process.env
  ): Promise<ResolvedAiServiceConfig> {
    let resolved = createDisabledAiServiceConfig(true, 'stored')
    const operation = this.queue.then(async () => {
      const existing = await this.readStored()
      if (existing) {
        const updated = { ...existing, onboardingDismissed: true }
        await this.writeStored(updated)
        resolved = this.resolveStored(updated)
        return
      }
      const environmentKey = environment.MIMO_API_KEY?.trim()
      if (environmentKey) {
        resolved = await this.read(environment)
        return
      }
      const localOnly: StoredAiServiceConfig = {
        version: AI_SERVICE_CONFIG_VERSION,
        textProvider: 'none',
        textBaseUrl: null,
        textModel: null,
        textCredential: null,
        sentenceAudioEnabled: false,
        sentenceAudioCredentialMode: 'separate',
        sentenceAudioCredential: null,
        onboardingDismissed: true
      }
      await this.writeStored(localOnly)
      resolved = this.resolveStored(localOnly)
    })
    this.queue = operation.catch(() => undefined)
    await operation
    return resolved
  }
}
