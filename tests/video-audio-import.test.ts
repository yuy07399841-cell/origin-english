import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { importListeningFromVideoPage } from '../src/main/video-audio-import'
import { loadListeningAudio } from '../src/main/listening-media'
import { LocalStore } from '../src/main/storage'
import { VALID_TINY_MP3 } from './media-fixtures'

const directories: string[] = []
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe('video page audio import', () => {
  it('extracts exactly one audio stream into the listening library and keeps transcription manual', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-video-audio-'))
    directories.push(directory)
    const store = new LocalStore(join(directory, 'state.json'))
    const mp3 = VALID_TINY_MP3
    const extractAudio = vi.fn(async () => ({ bytes: mp3, title: 'One public lesson' }))

    const item = await importListeningFromVideoPage(
      'https://www.youtube.com/watch?v=public-example',
      store,
      join(directory, 'media'),
      {
        extractAudio,
        resolveHost: async () => [{ address: '142.250.72.206', family: 4 }],
        id: 'def-456'
      }
    )

    expect(extractAudio).toHaveBeenCalledOnce()
    expect(item).toMatchObject({ title: 'One public lesson', mimeType: 'audio/mpeg', transcript: null })
    await expect(loadListeningAudio(item, join(directory, 'media'))).resolves.toMatchObject({ bytes: mp3.length })
  })

  it('starts yt-dlp with user configuration disabled at the executable boundary', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-video-audio-'))
    directories.push(directory)
    const processRunner = vi.fn(async (_executable: string, args: string[]) => {
      expect(args[0]).toBe('--ignore-config')
      expect(args).not.toContain('--cookies-from-browser')
      expect(args).not.toContain('--exec')
      const template = args[args.indexOf('--output') + 1]
      await writeFile(template.replace('%(title).180B.%(ext)s', 'Runner sample.mp3'), VALID_TINY_MP3)
    })

    const item = await importListeningFromVideoPage(
      'https://commons.wikimedia.org/wiki/File:Sample.webm',
      new LocalStore(join(directory, 'state.json')),
      join(directory, 'media'),
      {
        runProcess: processRunner,
        componentProvider: {
          prepare: async () => ({ ytDlpPath: 'trusted-yt-dlp', ffmpegPath: 'trusted-ffmpeg' })
        },
        resolveHost: async () => [{ address: '208.80.154.224', family: 4 }],
        id: 'cafe-1234'
      }
    )

    expect(processRunner).toHaveBeenCalledOnce()
    expect(item).toMatchObject({ title: 'Runner sample', mimeType: 'audio/mpeg' })
  })

  it('rejects unsupported video pages without pretending direct-link support is page extraction', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-video-audio-'))
    directories.push(directory)
    const extractAudio = vi.fn()
    await expect(importListeningFromVideoPage(
      'https://unsupported.example.com/watch/one',
      new LocalStore(join(directory, 'state.json')),
      join(directory, 'media'),
      { extractAudio, resolveHost: async () => [{ address: '93.184.216.34', family: 4 }] }
    )).rejects.toThrow(/not a supported video page/i)
    expect(extractAudio).not.toHaveBeenCalled()
  })
})
