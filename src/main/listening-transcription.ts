import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import type {
  ListeningItem,
  ListeningSentence,
  ListeningTranscript
} from '../shared/types'
import { isManagedListeningFileName } from './listening-media'

export const SMALL_EN_MODEL_SHA256 =
  'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d'
export const WHISPER_CLI_SHA256 =
  'b6b27a4b7ce9543382344ba273ea82bac35f821ca4317cf16710e16b26791e0f'
export const WHISPER_RUNTIME_SHA256: Readonly<Record<string, string>> = {
  'whisper-cli.exe': WHISPER_CLI_SHA256,
  'ggml-base.dll': '522b12f2d5150f1a219f1279c45aad33a726fc4b97d289b6bd0ac5272517565d',
  'ggml-blas.dll': 'd98c878bfc179177459d990f75dcb24f16dab4c220740d6b418b9418d6ca9498',
  'ggml-cpu-alderlake.dll': 'ab4f4c0672c1c145bee9536333b90fc8fe73f90f38c0909ffc82a36a8dcdb413',
  'ggml-cpu-cannonlake.dll': '935eb28a867b3eacfa15485df46cdab5d4a34c0fa175d557e4b99fadd175af64',
  'ggml-cpu-cascadelake.dll': 'b883b388c2a1e23cd5dbca06bca4ee62f87aa57b3fb3c9dece66e2ddf8e6c51e',
  'ggml-cpu-haswell.dll': '7b2cabb9df8b8af1b5ada9f7deff839779c5101790290fda53943b4e203a2f17',
  'ggml-cpu-icelake.dll': 'dd27b168d151fcf22f3aa2f9674fcaf71686cbb6c3c02d07767a1e34493f0998',
  'ggml-cpu-sandybridge.dll': '781aff429a54f0719d97d119b1caabb37cbee8e05d09ea8b0c5e0aea7c33d277',
  'ggml-cpu-skylakex.dll': '0b8a36d310470caac47b4de2c36fa66def7c3f472e518ff186e2166a6b6c9192',
  'ggml-cpu-sse42.dll': '125f3fcce8cb34749feb50eb9a7eac9a868938bf7db52e1d21ad6272d3f3328c',
  'ggml-cpu-x64.dll': '9b57ea7bd53aa6c90b5aa9ebcce1c410224b4bb53ad585600919679db9887b51',
  'ggml.dll': '8e24c47a3fee3f5e69657e34487625cf1c2de3a80d2c35ce868b47c6fec9cd47',
  'libopenblas.dll': '4c7fb23e900bd637cf771ad4ae3d1b51112a897385906433f2f1e58fe053ff70',
  'llama.dll': 'd6ad6d2b96f350db288829df4a42a884b862850fc533f2ecb6d0ef3f3c08a4a8',
  'parakeet.dll': '384c3d912340bbda44ccf76e60eed847c96cfcc3ed27df2a89258d35f019ab84',
  'SDL2.dll': 'de23db1694a3c7a4a735e7ecd3d214b2023cc2267922c6c35d30c7fc7370d677',
  'whisper.dll': 'f2e773c8094a4d3a6cba281cd21c2328a704a3b8a0db64a374d7904d1ed96f13'
}
export const LISTENING_TRANSCRIPTION_TIMEOUT_MS = 20 * 60 * 1000

const MAX_TRANSCRIPT_JSON_BYTES = 50 * 1024 * 1024
const SENTENCE_LEADING_PADDING_MS = 200
const SENTENCE_TRAILING_PADDING_MS = 260

interface WhisperToken {
  text?: unknown
  offsets?: {
    from?: unknown
    to?: unknown
  }
}

interface WhisperSegment {
  text?: unknown
  offsets?: {
    from?: unknown
    to?: unknown
  }
  tokens?: unknown
}

interface WhisperJson {
  transcription?: unknown
}

interface TimedTextRange {
  from: number
  to: number
  startMs: number
  endMs: number
}

interface SentenceRange {
  from: number
  to: number
}

interface ListeningTranscriptionOptions {
  dataDirectory: string
  modelSourcePath: string
  runtimeSourceDirectory: string
  now?: () => Date
  timeoutMs?: number
}

function isFiniteOffset(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isSpecialToken(text: string): boolean {
  return /^\[_.*\]$/.test(text.trim())
}

function isNonSpeechSegment(text: string): boolean {
  const cleaned = text.trim().replace(/^>>\s*/, '')
  return /^\[[^\]]+\]$/.test(cleaned) || /^\([^\)]+\)$/.test(cleaned)
}

function stripSpeakerMarker(text: string): string {
  return text.replace(/^\s*>>\s*/, ' ')
}

function nextVisibleCharacter(text: string, index: number): string {
  for (let cursor = index; cursor < text.length; cursor += 1) {
    if (!/\s/.test(text[cursor])) return text[cursor]
  }
  return ''
}

function previousWord(text: string, periodIndex: number): string {
  const prefix = text.slice(0, periodIndex + 1)
  return prefix.match(/(?:[A-Za-z]\.){2,}$|[A-Za-z]+\.$/)?.[0]?.toLowerCase() ?? ''
}

function periodEndsSentence(text: string, index: number): boolean {
  const previous = text[index - 1] ?? ''
  const next = text[index + 1] ?? ''
  if (/\d/.test(previous) && /\d/.test(next)) return false
  if (next === '.') return false

  const word = previousWord(text, index)
  const commonAbbreviations = new Set([
    'mr.',
    'mrs.',
    'ms.',
    'dr.',
    'prof.',
    'sr.',
    'jr.',
    'st.',
    'vs.',
    'etc.',
    'e.g.',
    'i.e.',
    'a.m.',
    'p.m.',
    'u.s.',
    'u.k.'
  ])
  if (commonAbbreviations.has(word)) return false

  const visibleNext = nextVisibleCharacter(text, index + 1)
  if (/^[A-Z]\.$/.test(word.toUpperCase()) && /[A-Z]/.test(visibleNext)) return false
  return true
}

export function splitEnglishSentenceRanges(text: string): SentenceRange[] {
  const ranges: SentenceRange[] = []
  let start = 0

  const pushRange = (endExclusive: number): void => {
    let from = start
    let to = endExclusive
    while (from < to && /\s/.test(text[from])) from += 1
    while (to > from && /\s/.test(text[to - 1])) to -= 1
    if (to > from) ranges.push({ from, to })
    start = endExclusive
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    const isBoundary =
      character === '?' || character === '!' || (character === '.' && periodEndsSentence(text, index))
    if (!isBoundary) continue

    let end = index + 1
    while (end < text.length && /[.!?]/.test(text[end])) end += 1
    while (end < text.length && /[\"'”’\)\]]/.test(text[end])) end += 1
    pushRange(end)
    index = end - 1
  }

  pushRange(text.length)
  return ranges
}

function segmentDuration(segment: WhisperSegment): number {
  const end = segment.offsets?.to
  return isFiniteOffset(end) ? end : 0
}

export function parseWhisperTranscript(
  value: unknown,
  createdAt = new Date().toISOString()
): ListeningTranscript {
  if (!value || typeof value !== 'object') {
    throw new Error('The local transcription result is invalid.')
  }
  const rawSegments = (value as WhisperJson).transcription
  if (!Array.isArray(rawSegments)) {
    throw new Error('The local transcription result has no timed segments.')
  }

  let text = ''
  let durationMs = 0
  const timedRanges: TimedTextRange[] = []

  for (const rawSegment of rawSegments) {
    if (!rawSegment || typeof rawSegment !== 'object') continue
    const segment = rawSegment as WhisperSegment
    durationMs = Math.max(durationMs, segmentDuration(segment))
    if (typeof segment.text === 'string' && isNonSpeechSegment(segment.text)) continue
    if (!Array.isArray(segment.tokens)) continue

    for (const rawToken of segment.tokens) {
      if (!rawToken || typeof rawToken !== 'object') continue
      const token = rawToken as WhisperToken
      if (typeof token.text !== 'string' || isSpecialToken(token.text)) continue
      const startMs = token.offsets?.from
      const endMs = token.offsets?.to
      if (!isFiniteOffset(startMs) || !isFiniteOffset(endMs)) continue

      const piece = stripSpeakerMarker(token.text)
      if (!piece || piece.trim() === '>>') continue
      if (text && !/\s$/.test(text) && !/^\s|^[,.;:!?\)\]]/.test(piece)) text += ' '
      const from = text.length
      text += piece
      const to = text.length
      if (to > from) {
        timedRanges.push({ from, to, startMs, endMs: Math.max(startMs, endMs) })
        durationMs = Math.max(durationMs, endMs)
      }
    }
  }

  const sentenceRanges = splitEnglishSentenceRanges(text)
  const sentences: ListeningSentence[] = []
  for (const range of sentenceRanges) {
    const overlapping = timedRanges.filter(
      (token) => token.to > range.from && token.from < range.to
    )
    if (!overlapping.length) continue
    const sentenceText = text.slice(range.from, range.to).replace(/\s+/g, ' ').trim()
    if (!/[A-Za-z]/.test(sentenceText)) continue
    const rawStartMs = Math.min(...overlapping.map((token) => token.startMs))
    const rawEndMs = Math.max(...overlapping.map((token) => token.endMs))
    const startMs = Math.max(0, rawStartMs - SENTENCE_LEADING_PADDING_MS)
    const endMs = Math.min(
      durationMs,
      Math.max(startMs + 1, rawEndMs + SENTENCE_TRAILING_PADDING_MS)
    )
    sentences.push({
      id: `sentence-${sentences.length + 1}`,
      text: sentenceText,
      startMs,
      endMs: Math.max(startMs + 1, endMs)
    })
  }

  if (!sentences.length || durationMs <= 0) {
    throw new Error('No playable English sentences were found in this audio.')
  }

  return {
    model: 'small.en',
    createdAt,
    durationMs,
    sentences
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function copyManagedFile(sourcePath: string, destinationPath: string): Promise<void> {
  const temporaryPath = `${destinationPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await copyFile(sourcePath, temporaryPath)
    await rm(destinationPath, { force: true })
    await rename(temporaryPath, destinationPath)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function ensureHash(filePath: string, expectedHash: string, label: string): Promise<void> {
  if ((await sha256File(filePath)) !== expectedHash) {
    throw new Error(`${label} does not match the version that passed the WER gate.`)
  }
}

async function runWhisper(
  executablePath: string,
  argumentsList: string[],
  cwd: string,
  timeoutMs: number
): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(executablePath, argumentsList, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    })
    let settled = false
    let timeout: NodeJS.Timeout | null = null
    let stderr = ''
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      if (error) rejectPromise(error)
      else resolvePromise()
    }
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 16_000) stderr += chunk.toString('utf8').slice(0, 16_000 - stderr.length)
    })
    child.once('error', () => finish(new Error('The local transcription engine could not start.')))
    child.once('close', (code) => {
      if (code === 0) finish()
      else {
        const hint = /failed to read audio data/i.test(stderr)
          ? ' The selected audio format could not be decoded.'
          : ''
        finish(new Error(`Local transcription stopped before completion.${hint}`))
      }
    })
    timeout = setTimeout(() => {
      child.kill()
      finish(new Error('Local transcription exceeded the 20-minute safety limit.'))
    }, timeoutMs)
  })
}

export class LocalListeningTranscriptionService {
  private readonly now: () => Date
  private readonly timeoutMs: number
  private engineReady: Promise<void> | null = null
  private active: { id: string; promise: Promise<ListeningTranscript> } | null = null

  constructor(private readonly options: ListeningTranscriptionOptions) {
    this.now = options.now ?? (() => new Date())
    this.timeoutMs = options.timeoutMs ?? LISTENING_TRANSCRIPTION_TIMEOUT_MS
  }

  private ensureEngine(): Promise<void> {
    if (this.engineReady) return this.engineReady
    this.engineReady = this.prepareEngine().catch((error) => {
      this.engineReady = null
      throw error
    })
    return this.engineReady
  }

  private async prepareEngine(): Promise<void> {
    const engineDirectory = join(this.options.dataDirectory, 'listening-engine')
    const runtimeDirectory = join(engineDirectory, 'runtime')
    const destinationModel = join(engineDirectory, 'ggml-small.en.bin')
    const destinationCli = join(runtimeDirectory, 'whisper-cli.exe')
    await ensureHash(this.options.modelSourcePath, SMALL_EN_MODEL_SHA256, 'Small.EN model')
    await mkdir(runtimeDirectory, { recursive: true })

    const destinationModelHash = await sha256File(destinationModel).catch(() => '')
    if (destinationModelHash !== SMALL_EN_MODEL_SHA256) {
      await copyManagedFile(this.options.modelSourcePath, destinationModel)
    }

    for (const [fileName, expectedHash] of Object.entries(WHISPER_RUNTIME_SHA256)) {
      const sourcePath = join(this.options.runtimeSourceDirectory, fileName)
      const destinationPath = join(runtimeDirectory, fileName)
      await ensureHash(sourcePath, expectedHash, `Bundled ${fileName}`)
      const destinationHash = await sha256File(destinationPath).catch(() => '')
      if (destinationHash !== expectedHash) await copyManagedFile(sourcePath, destinationPath)
      await ensureHash(destinationPath, expectedHash, `Installed ${fileName}`)
    }

    await ensureHash(destinationModel, SMALL_EN_MODEL_SHA256, 'Installed Small.EN model')
    await ensureHash(destinationCli, WHISPER_CLI_SHA256, 'Installed whisper-cli')
  }

  private async execute(item: ListeningItem): Promise<ListeningTranscript> {
    if (!isManagedListeningFileName(item.storedFileName)) {
      throw new Error('The saved audio reference is invalid.')
    }
    await this.ensureEngine()

    const mediaPath = join(this.options.dataDirectory, 'listening-media', item.storedFileName)
    const mediaStats = await stat(mediaPath)
    if (!mediaStats.isFile() || mediaStats.size !== item.bytes) {
      throw new Error('The saved audio file does not match its library record.')
    }

    const outputDirectory = join(this.options.dataDirectory, 'listening-transcripts')
    await mkdir(outputDirectory, { recursive: true })
    const outputBaseName = `transcript-${item.id}`
    const outputRelativePath = `listening-transcripts/${outputBaseName}`
    const outputJsonPath = join(outputDirectory, `${outputBaseName}.json`)
    await rm(outputJsonPath, { force: true })

    const executablePath = join(
      this.options.dataDirectory,
      'listening-engine',
      'runtime',
      'whisper-cli.exe'
    )
    await runWhisper(
      executablePath,
      [
        '-m',
        'listening-engine/ggml-small.en.bin',
        '-f',
        `listening-media/${item.storedFileName}`,
        '-l',
        'en',
        '-t',
        '8',
        '-bs',
        '5',
        '-bo',
        '5',
        '-ojf',
        '-np',
        '-of',
        outputRelativePath
      ],
      this.options.dataDirectory,
      this.timeoutMs
    )

    const outputStats = await stat(outputJsonPath)
    if (!outputStats.isFile() || outputStats.size <= 0 || outputStats.size > MAX_TRANSCRIPT_JSON_BYTES) {
      throw new Error('The local transcription result is missing or too large.')
    }
    const raw = JSON.parse(await readFile(outputJsonPath, 'utf8')) as unknown
    const transcript = parseWhisperTranscript(raw, this.now().toISOString())
    await rm(outputJsonPath, { force: true })
    return transcript
  }

  transcribe(item: ListeningItem): Promise<ListeningTranscript> {
    if (this.active) {
      if (this.active.id === item.id) return this.active.promise
      return Promise.reject(new Error('Another audio file is already being transcribed.'))
    }
    const promise = this.execute(item).finally(() => {
      if (this.active?.promise === promise) this.active = null
    })
    this.active = { id: item.id, promise }
    return promise
  }

  isTranscribing(id: string): boolean {
    return this.active?.id === id
  }
}
