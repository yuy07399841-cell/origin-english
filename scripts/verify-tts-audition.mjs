import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

const OUTPUT_DIR = new URL('../artifacts/tts-audition/', import.meta.url)
const summary = JSON.parse(await readFile(new URL('summary.json', OUTPUT_DIR), 'utf8'))

if (summary.requestLimit !== 3 || summary.retryCount !== 0 || summary.samples?.length !== 3) {
  throw new Error('The audition request or retry boundary was not preserved.')
}

function readWavMetadata(buffer) {
  if (
    buffer.length < 44 ||
    buffer.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    buffer.subarray(8, 12).toString('ascii') !== 'WAVE'
  ) {
    throw new Error('Invalid RIFF/WAVE header.')
  }

  let offset = 12
  let format = null
  let dataBytes = null
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.subarray(offset, offset + 4).toString('ascii')
    const chunkSize = buffer.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    const chunkEnd = chunkStart + chunkSize
    if (chunkEnd > buffer.length) throw new Error(`WAV chunk ${chunkId} exceeds the file boundary.`)

    if (chunkId === 'fmt ') {
      if (chunkSize < 16) throw new Error('WAV fmt chunk is too short.')
      format = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        byteRate: buffer.readUInt32LE(chunkStart + 8),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14)
      }
    }
    if (chunkId === 'data') dataBytes = chunkSize
    offset = chunkEnd + (chunkSize % 2)
  }

  if (!format || !dataBytes || format.byteRate <= 0) {
    throw new Error('WAV is missing a usable fmt or data chunk.')
  }
  if (![1, 3, 0xfffe].includes(format.audioFormat)) {
    throw new Error(`Unsupported WAV audio format ${format.audioFormat}.`)
  }

  return {
    ...format,
    dataBytes,
    durationSeconds: Number((dataBytes / format.byteRate).toFixed(3))
  }
}

const files = []
for (const sample of summary.samples) {
  const wav = await readFile(new URL(sample.filename, OUTPUT_DIR))
  const sha256 = createHash('sha256').update(wav).digest('hex')
  if (wav.length !== sample.bytes || sha256 !== sample.sha256) {
    throw new Error(`${sample.filename} does not match the generation summary.`)
  }
  files.push({
    voice: sample.voice,
    filename: sample.filename,
    bytes: wav.length,
    sha256,
    ...readWavMetadata(wav)
  })
}

const validation = {
  valid: true,
  checkedAt: new Date().toISOString(),
  requestCount: summary.samples.length,
  retryCount: summary.retryCount,
  files
}

await writeFile(
  new URL('validation.json', OUTPUT_DIR),
  `${JSON.stringify(validation, null, 2)}\n`,
  'utf8'
)
console.log(JSON.stringify(validation, null, 2))
