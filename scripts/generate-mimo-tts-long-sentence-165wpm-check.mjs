import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const API_URL = 'https://api.xiaomimimo.com/v1/chat/completions'
const MODEL = 'mimo-v2.5-tts'
const VOICE = 'Mia'
const SENTENCE =
  'Although I had planned to leave early, I stayed by the window for a few more minutes, listening to the rain against the glass and wondering whether she would call before the last train left the station.'
const STYLE =
  'Read this sentence naturally at a steady, slightly relaxed pace of about 165 words per minute. Keep the same pace from beginning to end. Do not speed up after "and wondering whether"; keep the final clause unhurried and clear.'
const OUTPUT_DIR = new URL('../artifacts/tts-audition-long-sentence-165wpm/', import.meta.url)
const AUDIO_PATH = new URL('mia-long-sentence-165wpm.wav', OUTPUT_DIR)
const SUMMARY_PATH = new URL('summary.json', OUTPUT_DIR)

const apiKey = process.env.MIMO_API_KEY?.trim()
if (!apiKey) throw new Error('MIMO_API_KEY is not configured. No request was sent.')

try {
  await readFile(SUMMARY_PATH, 'utf8')
  throw new Error('The 165-wpm summary already exists. Refusing to overwrite it.')
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
  throw new Error(`MiMo 165-wpm TTS request failed with status ${response.status}. No retry was attempted.`)
}

const audio = payload?.choices?.[0]?.message?.audio
if (typeof audio?.data !== 'string' || audio.data.length === 0) {
  throw new Error('MiMo 165-wpm TTS returned no audio. No retry was attempted.')
}

const wav = Buffer.from(audio.data, 'base64')
const isWav =
  wav.length >= 44 &&
  wav.subarray(0, 4).toString('ascii') === 'RIFF' &&
  wav.subarray(8, 12).toString('ascii') === 'WAVE'
if (!isWav) {
  throw new Error('MiMo 165-wpm TTS returned an invalid WAV payload. No retry was attempted.')
}

await writeFile(AUDIO_PATH, wav, { flag: 'wx' })
const summary = {
  version: 1,
  model: MODEL,
  voice: VOICE,
  sentence: SENTENCE,
  style: STYLE,
  targetWordsPerMinute: 165,
  desiredMeasuredWordsPerMinute: { minimum: 180, maximum: 200 },
  wordCount: SENTENCE.trim().split(/\s+/).length,
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
  targetWordsPerMinute: summary.targetWordsPerMinute,
  bytes: summary.bytes,
  sha256: summary.sha256
}, null, 2))
