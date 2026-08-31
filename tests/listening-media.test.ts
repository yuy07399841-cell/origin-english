import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  importListeningFile,
  loadListeningAudio,
  MAX_LISTENING_AUDIO_BYTES
} from '../src/main/listening-media'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

async function createDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'origin-listening-media-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('listening media import', () => {
  it('copies an MP3 into a managed ASCII filename and returns the same bytes', async () => {
    const directory = await createDirectory()
    const sourcePath = join(directory, 'Conversation sample.mp3')
    const source = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x01])
    await writeFile(sourcePath, source)

    const imported = await importListeningFile(sourcePath, join(directory, 'media'), {
      id: 'abc-123',
      importedAt: '2026-08-30T12:00:00.000Z'
    })

    expect(imported.item).toMatchObject({
      id: 'abc-123',
      title: 'Conversation sample',
      fileName: 'Conversation sample.mp3',
      storedFileName: 'audio-abc-123.mp3',
      mimeType: 'audio/mpeg',
      bytes: source.length,
      transcript: null
    })
    expect(await readFile(imported.storedPath)).toEqual(source)
    await expect(loadListeningAudio(imported.item, join(directory, 'media'))).resolves.toEqual({
      dataUrl: `data:audio/mpeg;base64,${source.toString('base64')}`,
      mimeType: 'audio/mpeg',
      bytes: source.length
    })
  })

  it('rejects unsupported, empty and oversized input before it is copied', async () => {
    const directory = await createDirectory()
    const textPath = join(directory, 'not-audio.txt')
    const emptyPath = join(directory, 'empty.wav')
    const largePath = join(directory, 'large.mp3')
    await writeFile(textPath, 'text')
    await writeFile(emptyPath, '')
    const handle = await open(largePath, 'w')
    await handle.truncate(MAX_LISTENING_AUDIO_BYTES + 1)
    await handle.close()

    await expect(importListeningFile(textPath, join(directory, 'media'))).rejects.toThrow(
      'Only MP3 and WAV'
    )
    await expect(importListeningFile(emptyPath, join(directory, 'media'))).rejects.toThrow(
      'empty or unavailable'
    )
    await expect(importListeningFile(largePath, join(directory, 'media'))).rejects.toThrow(
      '100 MB'
    )
  })

  it('blocks a tampered managed audio copy', async () => {
    const directory = await createDirectory()
    const sourcePath = join(directory, 'sample.wav')
    await writeFile(sourcePath, Buffer.from('RIFFtest'))
    const imported = await importListeningFile(sourcePath, join(directory, 'media'), {
      id: 'def-456'
    })
    await writeFile(imported.storedPath, Buffer.from('changed'))

    await expect(loadListeningAudio(imported.item, join(directory, 'media'))).rejects.toThrow(
      'does not match'
    )
  })
})
