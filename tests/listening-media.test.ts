import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  importListeningFile,
  loadListeningAudio,
  MAX_LISTENING_AUDIO_BYTES,
  stageListeningFileDeletion
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

  it('stages a managed audio deletion so it can be committed or rolled back', async () => {
    const directory = await createDirectory()
    const sourcePath = join(directory, 'sample.mp3')
    const source = Buffer.from('managed audio')
    await writeFile(sourcePath, source)
    const imported = await importListeningFile(sourcePath, join(directory, 'media'), {
      id: 'abc-789'
    })

    const firstDeletion = await stageListeningFileDeletion(imported.item, join(directory, 'media'))
    await expect(readFile(imported.storedPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await firstDeletion.rollback()
    await expect(readFile(imported.storedPath)).resolves.toEqual(source)

    const secondDeletion = await stageListeningFileDeletion(imported.item, join(directory, 'media'))
    await secondDeletion.commit()
    await expect(readFile(imported.storedPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects deletion paths that are not managed listening filenames', async () => {
    const directory = await createDirectory()
    await expect(
      stageListeningFileDeletion(
        {
          id: 'unsafe',
          title: 'Unsafe',
          fileName: 'unsafe.mp3',
          storedFileName: '../unsafe.mp3',
          mimeType: 'audio/mpeg',
          bytes: 1,
          importedAt: '2026-09-01T00:00:00.000Z',
          transcript: null
        },
        join(directory, 'media')
      )
    ).rejects.toThrow('reference is invalid')
  })
})
