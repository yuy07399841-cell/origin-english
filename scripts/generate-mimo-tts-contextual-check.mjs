import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const API_URL = 'https://api.xiaomimimo.com/v1/chat/completions'
const MODEL = 'mimo-v2.5-tts'
const VOICE = 'Mia'
const SENTENCE = 'I could not help noticing the subtle change in her voice.'
const STYLE =
  'Speak as if you have just noticed that a close friend is quietly hiding an emotion, and you are softly sharing that observation with someone beside you. Use natural contemporary native English conversation at about 170 words per minute. Deliver the entire sentence as one connected thought and one breath group. Keep function words light and unstressed, link words naturally, and convey subtle curiosity and concern. Preserve every written word exactly. Do not add, remove, or contract words. Do not sound like a language lesson, audiobook, announcement, or word-by-word reading.'
const OUTPUT_DIR = new URL('../artifacts/tts-audition-contextual/', import.meta.url)
const AUDIO_PATH = new URL('mia-contextual.wav', OUTPUT_DIR)
const SUMMARY_PATH = new URL('summary.json', OUTPUT_DIR)

const apiKey = process.env.MIMO_API_KEY?.trim()
if (!apiKey) throw new Error('MIMO_API_KEY is not configured. No request was sent.')

try {
  await readFile(SUMMARY_PATH, 'utf8')
  throw new Error('The contextual-check summary already exists. Refusing to overwrite it.')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

await mkdir(OUTPUT_DIR, { recursive: true })

const response = await fetch(API_URL, {
  method: 'POST',
  headers: {
    'api-key': apiKey,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: MODEL,
    messages: [
      { role: 'user', content: STYLE },
      { role: 'assistant', content: SENTENCE }
    ],
    audio: { format: 'wav', voice: VOICE },
    stream: false
  }),
  signal: AbortSignal.timeout(60_000)
})

const payload = await response.json()
if (!response.ok) {
  throw new Error(`MiMo contextual TTS request failed with status ${response.status}. No retry was attempted.`)
}

const audio = payload?.choices?.[0]?.message?.audio
if (typeof audio?.data !== 'string' || audio.data.length === 0) {
  throw new Error('MiMo contextual TTS returned no audio. No retry was attempted.')
}

const wav = Buffer.from(audio.data, 'base64')
const isWav =
  wav.length >= 44 &&
  wav.subarray(0, 4).toString('ascii') === 'RIFF' &&
  wav.subarray(8, 12).toString('ascii') === 'WAVE'
if (!isWav) {
  throw new Error('MiMo contextual TTS returned an invalid WAV payload. No retry was attempted.')
}

await writeFile(AUDIO_PATH, wav, { flag: 'wx' })
const summary = {
  version: 1,
  model: MODEL,
  voice: VOICE,
  sentence: SENTENCE,
  style: STYLE,
  requestCount: 1,
  retryCount: 0,
  responseId: typeof payload.id === 'string' ? payload.id : null,
  audioId: typeof audio.id === 'string' ? audio.id : null,
  promptTokens: Number.isInteger(payload?.usage?.prompt_tokens) ? payload.usage.prompt_tokens : null,
  completionTokens: Number.isInteger(payload?.usage?.completion_tokens)
    ? payload.usage.completion_tokens
    : null,
  bytes: wav.length,
  sha256: createHash('sha256').update(wav).digest('hex'),
  createdAt: new Date().toISOString()
}
await writeFile(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify({
  requestCount: summary.requestCount,
  retryCount: summary.retryCount,
  voice: summary.voice,
  bytes: summary.bytes,
  sha256: summary.sha256
}, null, 2))
