import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { importListeningFromAudioUrl } from '../src/main/listening-url-import'
import { loadListeningAudio } from '../src/main/listening-media'
import { LocalStore } from '../src/main/storage'
import { VALID_TINY_MP3 } from './media-fixtures'

const directories: string[] = []
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe('audio URL import', () => {
  it('saves one public MP3 as a playable local listening item without transcribing it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-audio-url-'))
    directories.push(directory)
    const store = new LocalStore(join(directory, 'state.json'))
    const mediaDirectory = join(directory, 'media')
    const mp3 = VALID_TINY_MP3
    const fetchMock = vi.fn(async () => new Response(mp3, { headers: { 'content-type': 'audio/mpeg' } })) as typeof fetch

    const item = await importListeningFromAudioUrl('https://media.example.com/lesson.mp3', store, mediaDirectory, {
      fetchImpl: fetchMock,
      resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
      id: 'abc-123',
      importedAt: '2026-09-15T11:00:00.000Z'
    })

    expect(item).toMatchObject({
      id: 'abc-123',
      title: 'lesson',
      sourceUrl: 'https://media.example.com/lesson.mp3',
      transcript: null
    })
    await expect(loadListeningAudio(item, mediaDirectory)).resolves.toMatchObject({ bytes: mp3.length })
    await expect(store.read()).resolves.toMatchObject({ listeningItems: [{ id: 'abc-123', transcript: null }] })
  })

  it('does not create a library item when the response is not supported audio', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-audio-url-'))
    directories.push(directory)
    const store = new LocalStore(join(directory, 'state.json'))
    await expect(importListeningFromAudioUrl('https://media.example.com/not-audio', store, join(directory, 'media'), {
      fetchImpl: (async () => new Response('<html>no audio</html>', { headers: { 'content-type': 'text/html' } })) as typeof fetch,
      resolveHost: async () => [{ address: '93.184.216.34', family: 4 }]
    })).rejects.toThrow(/unsupported content/i)
    await expect(store.read()).resolves.toMatchObject({ listeningItems: [] })
  })
})
