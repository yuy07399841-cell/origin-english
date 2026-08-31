import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { SentenceAudioResult } from '../shared/types'

export const MIMO_TTS_MODEL = 'mimo-v2.5-tts'
export const MIMO_TTS_VOICE = 'Mia'
export const MIMO_TTS_GENERATION_LIMIT = 100
export const MIMO_TTS_STYLE =
  'Read this sentence naturally at a steady, slightly relaxed pace of about 165 words per minute. Keep the same pace from beginning to end. Do not speed up in the final clause; keep it unhurried and clear.'

const DEFAULT_BASE_URL = 'https://api.xiaomimimo.com/v1'
const MAX_AUDIO_BYTES = 10 * 1024 * 1024
const LEDGER_VERSION = 1 as const

interface SentenceAudioServiceOptions {
  apiKey: string
  cacheDirectory: string
  usageFilePath: string
  baseUrl?: string
  model?: string
  voice?: string
  style?: string
  generationLimit?: number
  fetchImpl?: typeof fetch
}

interface TtsUsageLedger {
  version: typeof LEDGER_VERSION
  generationCount: number
  promptTokens: number
  completionTokens: number
  updatedAt: string | null
}

export interface SentenceAudioStatus {
  generationCount: number
  generationLimit: number
}

function emptyLedger(): TtsUsageLedger {
  return {
    version: LEDGER_VERSION,
    generationCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    updatedAt: null
  }
}

function parseLedger(value: unknown): TtsUsageLedger {
  if (!value || typeof value !== 'object') {
    throw new Error('MiMo sentence audio usage data is invalid. New generation is blocked.')
  }
  const ledger = value as Partial<TtsUsageLedger>
  if (
    ledger.version !== LEDGER_VERSION ||
    !Number.isInteger(ledger.generationCount) ||
    (ledger.generationCount ?? -1) < 0 ||
    !Number.isInteger(ledger.promptTokens) ||
    (ledger.promptTokens ?? -1) < 0 ||
    !Number.isInteger(ledger.completionTokens) ||
    (ledger.completionTokens ?? -1) < 0 ||
    (ledger.updatedAt !== null && typeof ledger.updatedAt !== 'string')
  ) {
    throw new Error('MiMo sentence audio usage data is invalid. New generation is blocked.')
  }
  return ledger as TtsUsageLedger
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function assertValidWav(buffer: Buffer): void {
  const declaredBytes = buffer.length >= 8 ? buffer.readUInt32LE(4) + 8 : 0
  if (
    buffer.length < 44 ||
    buffer.length > MAX_AUDIO_BYTES ||
    buffer.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    buffer.subarray(8, 12).toString('ascii') !== 'WAVE' ||
    declaredBytes > buffer.length
  ) {
    throw new Error('MiMo returned an invalid or oversized sentence audio file.')
  }
}

export function sentenceAudioCacheKey(
  sentence: string,
  model = MIMO_TTS_MODEL,
  voice = MIMO_TTS_VOICE,
  style = MIMO_TTS_STYLE
): string {
  return createHash('sha256')
    .update([model, voice, style, sentence].join('\u0000'))
    .digest('hex')
}

export class MiMoSentenceAudioService {
  private readonly apiKey: string
  private readonly cacheDirectory: string
  private readonly usageFilePath: string
  private readonly baseUrl: string
  private readonly model: string
  private readonly voice: string
  private readonly style: string
  private readonly generationLimit: number
  private readonly fetchImpl: typeof fetch
  private readonly inFlight = new Map<string, Promise<SentenceAudioResult>>()
  private ledgerQueue: Promise<void> = Promise.resolve()

  constructor(options: SentenceAudioServiceOptions) {
    if (!options.apiKey.trim()) throw new Error('A MiMo API key is required for sentence audio.')
    const generationLimit = options.generationLimit ?? MIMO_TTS_GENERATION_LIMIT
    if (!Number.isInteger(generationLimit) || generationLimit <= 0) {
      throw new Error('The MiMo sentence audio generation limit must be a positive integer.')
    }
    this.apiKey = options.apiKey
    this.cacheDirectory = options.cacheDirectory
    this.usageFilePath = options.usageFilePath
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.model = options.model ?? MIMO_TTS_MODEL
    this.voice = options.voice ?? MIMO_TTS_VOICE
    this.style = options.style ?? MIMO_TTS_STYLE
    this.generationLimit = generationLimit
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  private async exclusiveLedger<T>(operation: () => Promise<T>): Promise<T> {
    let release = (): void => undefined
    const previous = this.ledgerQueue
    this.ledgerQueue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  private async readLedger(): Promise<TtsUsageLedger> {
    try {
      return parseLedger(JSON.parse(await readFile(this.usageFilePath, 'utf8')) as unknown)
    } catch (error) {
      if (isMissingFile(error)) return emptyLedger()
      if (error instanceof SyntaxError) {
        throw new Error('MiMo sentence audio usage data is invalid. New generation is blocked.')
      }
      throw error
    }
  }

  private async writeLedger(ledger: TtsUsageLedger): Promise<void> {
    await mkdir(dirname(this.usageFilePath), { recursive: true })
    const temporaryPath = `${this.usageFilePath}.${process.pid}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, this.usageFilePath)
  }

  private async reserveGeneration(): Promise<void> {
    await this.exclusiveLedger(async () => {
      const ledger = await this.readLedger()
      if (ledger.generationCount >= this.generationLimit) {
        throw new Error(
          `The ${this.generationLimit}-sentence MiMo audio limit has been reached. New generation is paused.`
        )
      }
      await this.writeLedger({
        ...ledger,
        generationCount: ledger.generationCount + 1,
        updatedAt: new Date().toISOString()
      })
    })
  }

  private async recordTokens(promptTokens: unknown, completionTokens: unknown): Promise<void> {
    if (!Number.isInteger(promptTokens) || !Number.isInteger(completionTokens)) return
    if ((promptTokens as number) < 0 || (completionTokens as number) < 0) return
    await this.exclusiveLedger(async () => {
      const ledger = await this.readLedger()
      await this.writeLedger({
        ...ledger,
        promptTokens: ledger.promptTokens + (promptTokens as number),
        completionTokens: ledger.completionTokens + (completionTokens as number),
        updatedAt: new Date().toISOString()
      })
    })
  }

  async status(): Promise<SentenceAudioStatus> {
    return this.exclusiveLedger(async () => {
      const ledger = await this.readLedger()
      return {
        generationCount: ledger.generationCount,
        generationLimit: this.generationLimit
      }
    })
  }

  private resultFromBuffer(buffer: Buffer, cached: boolean): SentenceAudioResult {
    return {
      dataUrl: `data:audio/wav;base64,${buffer.toString('base64')}`,
      provider: 'mimo',
      model: this.model,
      voice: this.voice,
      cached
    }
  }

  private async readCache(filePath: string): Promise<SentenceAudioResult | null> {
    try {
      const buffer = await readFile(filePath)
      assertValidWav(buffer)
      return this.resultFromBuffer(buffer, true)
    } catch (error) {
      if (isMissingFile(error)) return null
      throw error
    }
  }

  private async generate(sentence: string, filePath: string): Promise<SentenceAudioResult> {
    await this.reserveGeneration()
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'api-key': this.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'user', content: this.style },
          { role: 'assistant', content: sentence }
        ],
        audio: { format: 'wav', voice: this.voice },
        stream: false
      }),
      signal: AbortSignal.timeout(60_000)
    })

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { audio?: { data?: unknown } } }>
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }
    }
    await this.recordTokens(payload.usage?.prompt_tokens, payload.usage?.completion_tokens)

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('MiMo rejected the configured API key for sentence audio.')
      }
      if (response.status === 429) {
        throw new Error('MiMo sentence audio is rate-limited or temporarily unavailable.')
      }
      throw new Error(`MiMo sentence audio failed with status ${response.status}.`)
    }

    const audioData = payload.choices?.[0]?.message?.audio?.data
    if (typeof audioData !== 'string' || !audioData) {
      throw new Error('MiMo returned no sentence audio.')
    }
    const buffer = Buffer.from(audioData, 'base64')
    assertValidWav(buffer)

    await mkdir(this.cacheDirectory, { recursive: true })
    const temporaryPath = `${filePath}.${process.pid}.tmp`
    await writeFile(temporaryPath, buffer)
    await rename(temporaryPath, filePath)
    return this.resultFromBuffer(buffer, false)
  }

  async get(sentence: string): Promise<SentenceAudioResult> {
    const key = sentenceAudioCacheKey(sentence, this.model, this.voice, this.style)
    const filePath = join(this.cacheDirectory, `${key}.wav`)
    const cached = await this.readCache(filePath)
    if (cached) return cached

    const existing = this.inFlight.get(key)
    if (existing) return existing

    const generation = this.generate(sentence, filePath).finally(() => {
      this.inFlight.delete(key)
    })
    this.inFlight.set(key, generation)
    return generation
  }
}
