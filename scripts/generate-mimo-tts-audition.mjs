import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const API_URL = 'https://api.xiaomimimo.com/v1/chat/completions'
const MODEL = 'mimo-v2.5-tts'
const SENTENCE = 'I could not help noticing the subtle change in her voice.'
const STYLE =
  'Read in natural conversational native English at a calm, medium pace. Use normal connected speech, reductions, and gentle sentence-level intonation. Do not over-enunciate or read word by word.'
const VOICES = ['Mia', 'Chloe', 'Dean']
const OUTPUT_DIR = new URL('../artifacts/tts-audition/', import.meta.url)
const SUMMARY_PATH = new URL('summary.json', OUTPUT_DIR)

const apiKey = process.env.MIMO_API_KEY?.trim()
if (!apiKey) {
  throw new Error('MIMO_API_KEY is not configured. No request was sent.')
}

try {
  await readFile(SUMMARY_PATH, 'utf8')
  throw new Error('The audition summary already exists. Refusing to overwrite prior samples.')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

await mkdir(OUTPUT_DIR, { recursive: true })

const summary = {
  version: 1,
  model: MODEL,
  sentence: SENTENCE,
  style: STYLE,
  requestedVoices: VOICES,
  requestLimit: 3,
  retryCount: 0,
  startedAt: new Date().toISOString(),
  completedAt: null,
  samples: []
}

async function saveSummary() {
  await writeFile(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
}

await saveSummary()

for (const voice of VOICES) {
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
      audio: { format: 'wav', voice },
      stream: false
    }),
    signal: AbortSignal.timeout(60_000)
  })

  const payload = await response.json()
  if (!response.ok) {
    throw new Error(`MiMo TTS request for ${voice} failed with status ${response.status}. No retry was attempted.`)
  }

  const audio = payload?.choices?.[0]?.message?.audio
  if (typeof audio?.data !== 'string' || audio.data.length === 0) {
    throw new Error(`MiMo TTS returned no audio for ${voice}. No retry was attempted.`)
  }

  const wav = Buffer.from(audio.data, 'base64')
  const isWav =
    wav.length >= 12 && wav.subarray(0, 4).toString('ascii') === 'RIFF' && wav.subarray(8, 12).toString('ascii') === 'WAVE'
  if (!isWav) {
    throw new Error(`MiMo TTS returned an invalid WAV payload for ${voice}. No retry was attempted.`)
  }

  const filename = `${voice.toLowerCase()}.wav`
  await writeFile(new URL(filename, OUTPUT_DIR), wav, { flag: 'wx' })
  summary.samples.push({
    voice,
    filename,
    responseId: typeof payload.id === 'string' ? payload.id : null,
    audioId: typeof audio.id === 'string' ? audio.id : null,
    promptTokens: Number.isInteger(payload?.usage?.prompt_tokens) ? payload.usage.prompt_tokens : null,
    completionTokens: Number.isInteger(payload?.usage?.completion_tokens)
      ? payload.usage.completion_tokens
      : null,
    bytes: wav.length,
    sha256: createHash('sha256').update(wav).digest('hex'),
    createdAt: new Date().toISOString()
  })
  await saveSummary()
}

summary.completedAt = new Date().toISOString()
await saveSummary()
console.log(JSON.stringify({
  requestCount: summary.samples.length,
  retryCount: summary.retryCount,
  files: summary.samples.map(({ voice, filename, bytes, sha256 }) => ({ voice, filename, bytes, sha256 }))
}, null, 2))
