import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import yauzl, { type Entry, type ZipFile } from 'yauzl'
import type { VideoImportProgress } from '../shared/types'
import {
  downloadPublicResource,
  type PinnedRequest,
  type ResolvedAddress
} from './safe-download'

export interface VideoComponentArtifact {
  version: string
  url: string
  bytes: number
  sha256: string
}

export interface VideoComponentRelease {
  id: string
  ytDlp: VideoComponentArtifact & { fileName: string }
  ffmpeg: VideoComponentArtifact & { archiveFileName: string; executableSha256: string }
}

export const VIDEO_COMPONENT_RELEASE: VideoComponentRelease = {
  id: 'yt-dlp-2026.08.19_ffmpeg-2026.09.14',
  ytDlp: {
    version: '2026.08.19',
    url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp.exe',
    fileName: 'yt-dlp.exe',
    bytes: 17_840_399,
    sha256: '66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a'
  },
  ffmpeg: {
    version: 'autobuild-2026-09-14-13-17',
    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-14-13-17/ffmpeg-N-126549-ga51bb69b09-win64-gpl.zip',
    archiveFileName: 'ffmpeg-N-126549-ga51bb69b09-win64-gpl.zip',
    bytes: 194_552_927,
    sha256: 'd1bd0d4e6ad451ce42de02a13757c46b6f182489c51e5a4a311013b2d3f920a2',
    executableSha256: '8be2934fe6208ef37d725e09838bf099be9ea040ddc343abd5e3651a057b6730'
  }
}

export interface PreparedVideoComponents {
  ytDlpPath: string
  ffmpegPath: string
}

export interface VideoComponentProvider {
  prepare(onProgress?: (progress: VideoImportProgress) => void, signal?: AbortSignal): Promise<PreparedVideoComponents>
}

type ComponentDownload = (
  url: string,
  onProgress: (downloadedBytes: number, totalBytes: number | null) => void,
  signal?: AbortSignal
) => Promise<Buffer>

interface VideoComponentManagerOptions {
  directory: string
  release: VideoComponentRelease
  download?: ComponentDownload
  maxArchiveEntries?: number
  maxExtractedBytes?: number
  platform?: NodeJS.Platform
  arch?: string
  artifactCacheDirectory?: string
  requestImpl?: PinnedRequest
  resolveHost?: (host: string) => Promise<ResolvedAddress[]>
}

interface ReadyManifest {
  schemaVersion: 1
  releaseId: string
  ytDlpSha256: string
  ffmpegSha256: string
  preparedAt: string
  components: {
    ytDlp: { version: string; sourceUrl: string; sha256: string }
    ffmpeg: { version: string; sourceUrl: string; archiveSha256: string; executableSha256: string }
  }
}

const MANIFEST_FILE = 'components.json'
const YT_DLP_FILE = 'yt-dlp.exe'
const FFMPEG_FILE = 'ffmpeg.exe'
const FFMPEG_LICENSE_FILE = 'FFMPEG_LICENSE.txt'

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function digestFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk)
      callback(null, chunk)
    }
  }), new Transform({ transform(_chunk, _encoding, callback) { callback() } }))
  return hash.digest('hex')
}

function openZip(bytes: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, {
      lazyEntries: true,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: true
    }, (error, zip) => error || !zip ? reject(error ?? new Error('The FFmpeg archive could not be opened.')) : resolve(zip))
  })
}

function openEntry(zip: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => error || !stream
      ? reject(error ?? new Error('The FFmpeg archive entry could not be read.'))
      : resolve(stream))
  })
}

async function extractRequiredFfmpegFiles(
  archive: Buffer,
  targetDirectory: string,
  maxEntries: number,
  maxExtractedBytes: number
): Promise<void> {
  const zip = await openZip(archive)
  let entries = 0
  let declaredBytes = 0
  let foundExecutable = false
  let foundLicense = false
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const fail = (error: unknown): void => {
        if (settled) return
        settled = true
        zip.close()
        reject(error)
      }
      zip.once('error', fail)
      zip.once('end', () => {
        if (settled) return
        settled = true
        resolve()
      })
      zip.on('entry', (entry: Entry) => {
        void (async () => {
          entries += 1
          declaredBytes += entry.uncompressedSize
          const segments = entry.fileName.split('/')
          if (
            entries > maxEntries || declaredBytes > maxExtractedBytes ||
            entry.fileName.startsWith('/') || /^[A-Za-z]:/.test(entry.fileName) ||
            entry.fileName.includes('\\') || segments.some((segment) => segment === '..' || segment === '.')
          ) {
            throw new Error('The FFmpeg archive contains an unsafe or oversized entry.')
          }
          const isExecutable = /\/bin\/ffmpeg\.exe$/i.test(entry.fileName)
          const isLicense = /\/LICENSE\.txt$/i.test(entry.fileName)
          if (!isExecutable && !isLicense) {
            zip.readEntry()
            return
          }
          const target = join(targetDirectory, isExecutable ? FFMPEG_FILE : FFMPEG_LICENSE_FILE)
          const stream = await openEntry(zip, entry)
          let actualBytes = 0
          await pipeline(stream, new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              actualBytes += chunk.length
              if (actualBytes > entry.uncompressedSize || actualBytes > maxExtractedBytes) {
                callback(new Error('The FFmpeg archive entry exceeded its declared size.'))
              } else {
                callback(null, chunk)
              }
            }
          }), createWriteStream(target, { flags: 'wx' }))
          if (isExecutable) foundExecutable = true
          if (isLicense) foundLicense = true
          zip.readEntry()
        })().catch(fail)
      })
      zip.readEntry()
    })
  } finally {
    zip.close()
  }
  if (!foundExecutable || !foundLicense) {
    throw new Error('The FFmpeg archive is missing the required executable or license.')
  }
}

export class VideoComponentManager implements VideoComponentProvider {
  private preparation: Promise<PreparedVideoComponents> | null = null
  private readonly download: ComponentDownload

  constructor(private readonly options: VideoComponentManagerOptions) {
    this.download = options.download ?? ((url, onProgress, signal) => this.downloadOfficial(url, onProgress, signal))
  }

  prepare(onProgress: (progress: VideoImportProgress) => void = () => undefined, signal?: AbortSignal): Promise<PreparedVideoComponents> {
    if (!this.preparation) {
      this.preparation = this.prepareOnce(onProgress, signal).finally(() => { this.preparation = null })
    }
    return this.preparation
  }

  private paths(): PreparedVideoComponents {
    const readyDirectory = join(this.options.directory, this.options.release.id)
    return { ytDlpPath: join(readyDirectory, YT_DLP_FILE), ffmpegPath: join(readyDirectory, FFMPEG_FILE) }
  }

  private async isReady(): Promise<boolean> {
    try {
      const paths = this.paths()
      const manifest = JSON.parse(await readFile(join(this.options.directory, this.options.release.id, MANIFEST_FILE), 'utf8')) as ReadyManifest
      if (
        manifest.schemaVersion !== 1 || manifest.releaseId !== this.options.release.id ||
        manifest.ytDlpSha256 !== this.options.release.ytDlp.sha256 ||
        manifest.ffmpegSha256 !== this.options.release.ffmpeg.executableSha256
      ) return false
      const [ytDlpHash, ffmpegHash] = await Promise.all([digestFile(paths.ytDlpPath), digestFile(paths.ffmpegPath)])
      return ytDlpHash === this.options.release.ytDlp.sha256 && ffmpegHash === this.options.release.ffmpeg.executableSha256
    } catch {
      return false
    }
  }

  private async prepareOnce(onProgress: (progress: VideoImportProgress) => void, signal?: AbortSignal): Promise<PreparedVideoComponents> {
    if (signal?.aborted) throw new Error('Video import was cancelled.')
    if ((this.options.platform ?? process.platform) !== 'win32' || (this.options.arch ?? process.arch) !== 'x64') {
      throw new Error('Automatic video component preparation currently supports Windows x64 only.')
    }
    onProgress({ stage: 'checking', message: 'Checking video components' })
    if (await this.isReady()) {
      onProgress({ stage: 'preparing', message: 'Video components are ready' })
      return this.paths()
    }
    await mkdir(this.options.directory, { recursive: true })
    const staging = join(this.options.directory, `.preparing-${randomUUID()}`)
    await mkdir(staging)
    try {
      const ytDlp = await this.download(this.options.release.ytDlp.url, (downloadedBytes, totalBytes) =>
        onProgress({ stage: 'downloading', message: 'Downloading yt-dlp', downloadedBytes, totalBytes }), signal)
      if (signal?.aborted) throw new Error('Video import was cancelled.')
      this.verifyArtifact(ytDlp, this.options.release.ytDlp, 'yt-dlp')
      await writeFile(join(staging, YT_DLP_FILE), ytDlp, { flag: 'wx' })

      const archive = await this.download(this.options.release.ffmpeg.url, (downloadedBytes, totalBytes) =>
        onProgress({ stage: 'downloading', message: 'Downloading FFmpeg', downloadedBytes, totalBytes }), signal)
      if (signal?.aborted) throw new Error('Video import was cancelled.')
      this.verifyArtifact(archive, this.options.release.ffmpeg, 'FFmpeg archive')
      onProgress({ stage: 'verifying', message: 'Verifying and preparing FFmpeg' })
      await extractRequiredFfmpegFiles(
        archive,
        staging,
        this.options.maxArchiveEntries ?? 500,
        this.options.maxExtractedBytes ?? 1024 * 1024 * 1024
      )
      if (signal?.aborted) throw new Error('Video import was cancelled.')
      if (await digestFile(join(staging, FFMPEG_FILE)) !== this.options.release.ffmpeg.executableSha256) {
        throw new Error('FFmpeg executable failed its integrity check.')
      }
      const manifest: ReadyManifest = {
        schemaVersion: 1,
        releaseId: this.options.release.id,
        ytDlpSha256: this.options.release.ytDlp.sha256,
        ffmpegSha256: this.options.release.ffmpeg.executableSha256,
        preparedAt: new Date().toISOString(),
        components: {
          ytDlp: {
            version: this.options.release.ytDlp.version,
            sourceUrl: this.options.release.ytDlp.url,
            sha256: this.options.release.ytDlp.sha256
          },
          ffmpeg: {
            version: this.options.release.ffmpeg.version,
            sourceUrl: this.options.release.ffmpeg.url,
            archiveSha256: this.options.release.ffmpeg.sha256,
            executableSha256: this.options.release.ffmpeg.executableSha256
          }
        }
      }
      await writeFile(join(staging, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
      const ready = join(this.options.directory, this.options.release.id)
      const displaced = join(this.options.directory, `.replaced-${randomUUID()}`)
      await rename(ready, displaced).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
      try {
        await rename(staging, ready)
      } catch (error) {
        await rename(displaced, ready).catch(() => undefined)
        throw error
      }
      await rm(displaced, { recursive: true, force: true })
      onProgress({ stage: 'preparing', message: 'Video components are ready' })
      return this.paths()
    } catch (error) {
      await rm(staging, { recursive: true, force: true })
      throw error
    }
  }

  private verifyArtifact(bytes: Buffer, artifact: VideoComponentArtifact, label: string): void {
    if (bytes.length !== artifact.bytes || digest(bytes) !== artifact.sha256) {
      throw new Error(`${label} failed its integrity check. Nothing was installed.`)
    }
  }

  private async downloadOfficial(
    url: string,
    onProgress: (downloadedBytes: number, totalBytes: number | null) => void,
    signal?: AbortSignal
  ): Promise<Buffer> {
    const artifact = url === this.options.release.ytDlp.url
      ? this.options.release.ytDlp
      : this.options.release.ffmpeg
    if (this.options.artifactCacheDirectory) {
      const fileName = 'fileName' in artifact ? artifact.fileName : artifact.archiveFileName
      const cached = await readFile(join(this.options.artifactCacheDirectory, basename(fileName)))
      if (signal?.aborted) throw new Error('Video import was cancelled.')
      onProgress(cached.length, cached.length)
      return cached
    }
    const downloaded = await downloadPublicResource(url, {
      requestImpl: this.options.requestImpl,
      resolveHost: this.options.resolveHost,
      maxBytes: artifact.bytes,
      timeoutMs: 10 * 60_000,
      dnsTimeoutMs: 10_000,
      acceptedContentTypes: ['application/octet-stream', 'application/zip', 'application/x-zip-compressed'],
      maxRedirects: 3,
      allowedHosts: ['github.com', 'release-assets.githubusercontent.com'],
      onProgress,
      signal
    })
    return downloaded.bytes
  }
}
