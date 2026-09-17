import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { importListeningFromVideoPage } from '../src/main/video-audio-import'
import { loadListeningAudio } from '../src/main/listening-media'
import { LocalStore } from '../src/main/storage'
import { VideoComponentManager, VIDEO_COMPONENT_RELEASE } from '../src/main/video-components'

const liveUrl = process.env.ORIGIN_ENGLISH_LIVE_VIDEO_URL
const ytDlpPath = process.env.ORIGIN_ENGLISH_YTDLP_PATH
const ffmpegArchivePath = process.env.ORIGIN_ENGLISH_FFMPEG_ARCHIVE_PATH
let directory: string | null = null

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

describe('live public video page validation', () => {
  it.skipIf(!liveUrl || !ytDlpPath || !ffmpegArchivePath)(
    'imports one real public video page as playable local audio',
    async () => {
      directory = await mkdtemp(join(tmpdir(), 'origin-video-live-'))
      const mediaDirectory = join(directory, 'media')
      const componentProvider = new VideoComponentManager({
        directory: join(directory, 'video-components'),
        release: VIDEO_COMPONENT_RELEASE,
        download: async (url) => readFile(url === VIDEO_COMPONENT_RELEASE.ytDlp.url ? ytDlpPath! : ffmpegArchivePath!)
      })
      const item = await importListeningFromVideoPage(
        liveUrl!,
        new LocalStore(join(directory, 'state.json')),
        mediaDirectory,
        { componentProvider }
      )
      expect(item.transcript).toBeNull()
      expect(item.mimeType).toBe('audio/mpeg')
      expect(item.bytes).toBeGreaterThan(1_000)
      await expect(loadListeningAudio(item, mediaDirectory)).resolves.toMatchObject({ bytes: item.bytes })
    },
    150_000
  )
})
