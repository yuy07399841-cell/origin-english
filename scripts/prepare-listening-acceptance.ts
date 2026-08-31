import { constants } from 'node:fs'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseWhisperTranscript } from '../src/main/listening-transcription'

const projectDirectory = resolve(import.meta.dirname, '..')
const evidenceDirectory = join(
  projectDirectory,
  '.validation',
  'listening-spike',
  'apptek-unseen-v1'
)
const acceptanceDirectory = join(projectDirectory, '.validation', 'listening-acceptance')
const userDataDirectory = join(acceptanceDirectory, 'user-data')
const dataDirectory = join(userDataDirectory, 'origin-english')
const mediaDirectory = join(dataDirectory, 'listening-media')
const storedFileName = 'audio-a11e1586896.wav'
const sourceAudioPath = join(evidenceDirectory, 'source.wav')
const predictionPath = join(evidenceDirectory, 'small-en-once.json')

await mkdir(mediaDirectory, { recursive: true })
const transcript = parseWhisperTranscript(
  JSON.parse(await readFile(predictionPath, 'utf8')) as unknown,
  '2026-08-30T22:25:00.000Z'
)
const sourceStats = await stat(sourceAudioPath)
await copyFile(
  sourceAudioPath,
  join(mediaDirectory, storedFileName),
  constants.COPYFILE_EXCL
)

const state = {
  schemaVersion: 4,
  uiLanguage: 'zh',
  articles: [],
  listeningItems: [
    {
      id: 'a11e1586896',
      title: '逐句验收 · 9分55秒双人英语对话',
      fileName: 'en_US_General_Energy_1586896.wav',
      storedFileName,
      mimeType: 'audio/wav',
      bytes: sourceStats.size,
      importedAt: '2026-08-30T22:25:00.000Z',
      transcript
    }
  ],
  savedWords: [],
  lookupEvents: []
}
await writeFile(join(dataDirectory, 'state.json'), `${JSON.stringify(state, null, 2)}\n`, {
  encoding: 'utf8',
  flag: 'wx'
})
await writeFile(
  join(acceptanceDirectory, 'acceptance-info.json'),
  `${JSON.stringify(
    {
      sample: 'audio/en_US_General_Energy_1586896.wav',
      durationMs: transcript.durationMs,
      sentenceCount: transcript.sentences.length,
      source: 'existing frozen Small.EN output; no ASR rerun',
      userDataDirectory
    },
    null,
    2
  )}\n`,
  { encoding: 'utf8', flag: 'wx' }
)
console.log(
  JSON.stringify({
    userDataDirectory,
    durationMs: transcript.durationMs,
    sentenceCount: transcript.sentences.length
  })
)
