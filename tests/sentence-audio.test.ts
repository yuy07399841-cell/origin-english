import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MiMoSentenceAudioService,
  MIMO_TTS_MODEL,
  MIMO_TTS_STYLE,
  MIMO_TTS_VOICE
} from '../src/main/sentence-audio'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

function validWavBase64(): string {
  const buffer = Buffer.alloc(46)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(38, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(24_000, 24)
  buffer.writeUInt32LE(48_000, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(2, 40)
  return buffer.toString('base64')
}

async function createDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'origin-sentence-audio-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('MiMo sentence audio', () => {
  it('uploads only the fixed style and sentence, then reuses disk cache', async () => {
    const directory = await createDirectory()
    const sentence = 'A natural sentence should stay smooth from beginning to end.'
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        model: string
        messages: Array<{ role: string; content: string }>
        audio: { format: string; voice: string }
        stream: boolean
      }
      expect(Object.keys(body).sort()).toEqual(['audio', 'messages', 'model', 'stream'])
      expect(body.model).toBe(MIMO_TTS_MODEL)
      expect(body.messages).toEqual([
        { role: 'user', content: MIMO_TTS_STYLE },
        { role: 'assistant', content: sentence }
      ])
      expect(body.audio).toEqual({ format: 'wav', voice: MIMO_TTS_VOICE })
      expect(body.stream).toBe(false)
      expect(new Headers(init?.headers).get('api-key')).toBe('test-key-not-real')
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return new Response(
        JSON.stringify({
          choices: [{ message: { audio: { data: validWavBase64() } } }],
          usage: { prompt_tokens: 80, completion_tokens: 20 }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }) as typeof fetch
    const options = {
      apiKey: 'test-key-not-real',
      cacheDirectory: join(directory, 'cache'),
      usageFilePath: join(directory, 'usage.json'),
      fetchImpl: fetchMock
    }
    const firstService = new MiMoSentenceAudioService(options)
    const first = await firstService.get(sentence)
    const second = await firstService.get(sentence)
    const restartedService = new MiMoSentenceAudioService(options)
    const afterRestart = await restartedService.get(sentence)

    expect(first).toMatchObject({
      provider: 'mimo',
      model: MIMO_TTS_MODEL,
      voice: MIMO_TTS_VOICE,
      cached: false
    })
    expect(first.dataUrl).toMatch(/^data:audio\/wav;base64,/)
    expect(second).toMatchObject({ cached: true })
    expect(afterRestart).toMatchObject({ cached: true })
    expect(fetchMock).toHaveBeenCalledOnce()

    const cacheFiles = await readdir(join(directory, 'cache'))
    expect(cacheFiles).toHaveLength(1)
    expect(cacheFiles[0]).toMatch(/^[a-f0-9]{64}\.wav$/)
    expect(cacheFiles[0]).not.toContain('natural')

    const ledgerText = await readFile(join(directory, 'usage.json'), 'utf8')
    expect(ledgerText).not.toContain(sentence)
    expect(ledgerText).not.toContain('test-key-not-real')
    expect(JSON.parse(ledgerText)).toMatchObject({
      generationCount: 1,
      promptTokens: 80,
      completionTokens: 20
    })
  })

  it('coalesces concurrent requests for the same sentence', async () => {
    const directory = await createDirectory()
    let releaseResponse = (): void => undefined
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve
    })
    const fetchMock = vi.fn(async () => {
      await responseGate
      return new Response(
        JSON.stringify({
          choices: [{ message: { audio: { data: validWavBase64() } } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }) as typeof fetch
    const service = new MiMoSentenceAudioService({
      apiKey: 'test-key',
      cacheDirectory: join(directory, 'cache'),
      usageFilePath: join(directory, 'usage.json'),
      fetchImpl: fetchMock
    })

    const first = service.get('One sentence should produce one request.')
    const second = service.get('One sentence should produce one request.')
    releaseResponse()
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledOnce()
    await expect(service.status()).resolves.toMatchObject({ generationCount: 1 })
  })

  it('counts a failed attempt once, never retries and enforces the generation limit', async () => {
    const directory = await createDirectory()
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'unavailable' } }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      })
    ) as typeof fetch
    const service = new MiMoSentenceAudioService({
      apiKey: 'test-key',
      cacheDirectory: join(directory, 'cache'),
      usageFilePath: join(directory, 'usage.json'),
      generationLimit: 1,
      fetchImpl: fetchMock
    })

    await expect(service.get('The first request fails once.')).rejects.toThrow('status 503')
    await expect(service.get('A second sentence is blocked.')).rejects.toThrow('limit')
    expect(fetchMock).toHaveBeenCalledOnce()
    await expect(service.status()).resolves.toEqual({ generationCount: 1, generationLimit: 1 })
  })

  it('rejects an invalid audio file without writing it to cache', async () => {
    const directory = await createDirectory()
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { audio: { data: Buffer.from('not a wav').toString('base64') } } }]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    ) as typeof fetch
    const service = new MiMoSentenceAudioService({
      apiKey: 'test-key',
      cacheDirectory: join(directory, 'cache'),
      usageFilePath: join(directory, 'usage.json'),
      fetchImpl: fetchMock
    })

    await expect(service.get('This response must be a valid audio file.')).rejects.toThrow(
      'invalid or oversized'
    )
    await expect(readdir(join(directory, 'cache'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
