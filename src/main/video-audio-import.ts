import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { ListeningItem, VideoImportProgress } from '../shared/types'
import { importListeningBytes } from './listening-media'
import { validatePublicUrl, type ResolvedAddress } from './safe-download'
import type { LocalStore } from './storage'
import type { VideoComponentProvider } from './video-components'

export interface ExtractedVideoAudio {
  bytes: Buffer
  title: string
}

export type VideoImportProcessRunner = (
  executable: string,
  args: string[],
  options: { timeout: number; windowsHide: boolean; maxBuffer: number; signal?: AbortSignal }
) => Promise<void>

interface VideoAudioImportOptions {
  extractAudio?: (url: string) => Promise<ExtractedVideoAudio>
  resolveHost?: (host: string) => Promise<ResolvedAddress[]>
  id?: string
  importedAt?: string
  runProcess?: VideoImportProcessRunner
  componentProvider?: VideoComponentProvider
  onProgress?: (progress: VideoImportProgress) => void
  signal?: AbortSignal
}

const SUPPORTED_VIDEO_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'youtu.be',
  'vimeo.com', 'www.vimeo.com',
  'bilibili.com', 'www.bilibili.com',
  'commons.wikimedia.org'
])

async function runYtDlp(
  url: string,
  workDirectory: string,
  executable: string,
  ffmpegPath?: string,
  runProcess: VideoImportProcessRunner = runExecutable,
  signal?: AbortSignal
): Promise<ExtractedVideoAudio> {
  await mkdir(workDirectory, { recursive: true })
  const temporaryDirectory = await mkdtemp(join(workDirectory, 'video-import-'))
  try {
    const args = [
      '--ignore-config', '--no-playlist', '--max-downloads', '1', '--socket-timeout', '15', '--retries', '1',
      '--max-filesize', '100M', '--no-write-thumbnail', '--no-write-info-json',
      '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '5',
      '--output', join(temporaryDirectory, '%(title).180B.%(ext)s'), url
    ]
    if (ffmpegPath) args.splice(1, 0, '--ffmpeg-location', ffmpegPath)
    await runProcess(executable, args, { timeout: 120_000, windowsHide: true, maxBuffer: 1024 * 1024, signal })
    const files = (await readdir(temporaryDirectory)).filter((file) => extname(file).toLowerCase() === '.mp3')
    if (files.length !== 1) throw new Error('The video page did not produce exactly one audio file.')
    const fileName = files[0]
    return { bytes: await readFile(join(temporaryDirectory, fileName)), title: basename(fileName, '.mp3') }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('Video page import needs trusted yt-dlp and FFmpeg components. Configure their project paths.')
    }
    throw new Error(`The video audio could not be extracted: ${error instanceof Error ? error.message : 'unknown error'}`)
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

const runExecutable: VideoImportProcessRunner = (executable, args, options) => new Promise((resolve, reject) => {
  execFile(executable, args, options, (error) => {
    if (error && (error as { code?: string | number }).code !== 101) reject(error)
    else resolve()
  })
})

export async function importListeningFromVideoPage(
  rawUrl: string,
  store: LocalStore,
  mediaDirectory: string,
  options: VideoAudioImportOptions = {}
): Promise<ListeningItem> {
  const resolveHost = options.resolveHost ?? (async (host) => {
    const { lookup } = await import('node:dns/promises')
    return lookup(host, { all: true })
  })
  const url = await validatePublicUrl(rawUrl, resolveHost)
  if (!SUPPORTED_VIDEO_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('This is not a supported video page. Use a direct MP3/WAV link or a supported public video page.')
  }
  if (url.searchParams.has('list') || /\/(?:playlist|show|channel|courses?)\b/i.test(url.pathname)) {
    throw new Error('Playlists and collections are not supported. Choose one specific video.')
  }
  const extractAudio = options.extractAudio ?? (async (sourceUrl) => {
    if (!options.componentProvider) {
      throw new Error('Verified video components could not be prepared. Retry the import.')
    }
    const components = await options.componentProvider.prepare(options.onProgress, options.signal)
    options.onProgress?.({ stage: 'extracting', message: 'Extracting audio from the video' })
    return runYtDlp(sourceUrl, mediaDirectory, components.ytDlpPath, components.ffmpegPath || undefined, options.runProcess, options.signal)
  })
  const extracted = await extractAudio(url.href)
  const imported = await importListeningBytes(extracted.bytes, `${extracted.title}.mp3`, 'audio/mpeg', mediaDirectory, {
    id: options.id,
    importedAt: options.importedAt,
    sourceUrl: url.href
  })
  try {
    await store.update((state) => ({ ...state, listeningItems: [imported.item, ...state.listeningItems] }))
  } catch (error) {
    await rm(imported.storedPath, { force: true }).catch(() => undefined)
    throw error
  }
  return imported.item
}
