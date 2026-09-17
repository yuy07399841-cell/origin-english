import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZipFile } from 'yazl'
import { VideoComponentManager, type VideoComponentRelease } from '../src/main/video-components'
import { importListeningFromVideoPage } from '../src/main/video-audio-import'
import { LocalStore } from '../src/main/storage'
import { VALID_TINY_MP3 } from './media-fixtures'

const directories: string[] = []
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

async function makeFfmpegArchive(executable: Buffer): Promise<Buffer> {
  const zip = new ZipFile()
  const chunks: Buffer[] = []
  zip.addBuffer(executable, 'ffmpeg-test/bin/ffmpeg.exe')
  zip.addBuffer(Buffer.from('GPL test license'), 'ffmpeg-test/LICENSE.txt')
  zip.outputStream.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
  const completed = new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.once('end', () => resolve(Buffer.concat(chunks)))
    zip.outputStream.once('error', reject)
  })
  zip.end()
  return completed
}

function releaseFor(ytDlp: Buffer, archive: Buffer, ffmpeg: Buffer): VideoComponentRelease {
  return {
    id: 'test-release-v1',
    ytDlp: {
      version: 'test-yt', url: 'https://official.example/yt-dlp.exe',
      fileName: 'yt-dlp.exe', bytes: ytDlp.length, sha256: sha256(ytDlp)
    },
    ffmpeg: {
      version: 'test-ffmpeg', url: 'https://official.example/ffmpeg.zip',
      archiveFileName: 'ffmpeg.zip', bytes: archive.length, sha256: sha256(archive),
      executableSha256: sha256(ffmpeg)
    }
  }
}

function replaceArchiveName(archive: Buffer, from: string, to: string): Buffer {
  if (from.length !== to.length) throw new Error('Replacement ZIP names must have equal length.')
  const result = Buffer.from(archive)
  let cursor = 0
  let replacements = 0
  while ((cursor = result.indexOf(from, cursor, 'utf8')) >= 0) {
    result.write(to, cursor, 'utf8')
    cursor += to.length
    replacements += 1
  }
  if (replacements < 2) throw new Error('The ZIP fixture name was not found in both headers.')
  return result
}

describe('on-demand video component preparation through the public import entry', () => {
  it('prepares verified components on first use and reuses the managed copy', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-video-components-'))
    directories.push(directory)
    const ytDlp = Buffer.from('trusted yt-dlp executable')
    const ffmpeg = Buffer.from('trusted ffmpeg executable')
    const archive = await makeFfmpegArchive(ffmpeg)
    const release = releaseFor(ytDlp, archive, ffmpeg)
    const download = vi.fn(async (url: string, onProgress: (downloaded: number, total: number) => void) => {
      const bytes = url.endsWith('yt-dlp.exe') ? ytDlp : archive
      onProgress(bytes.length, bytes.length)
      return bytes
    })
    const manager = new VideoComponentManager({
      directory: join(directory, 'managed-components'), release, download
    })
    const progress: string[] = []
    const runProcess = vi.fn(async (_executable: string, args: string[]) => {
      const template = args[args.indexOf('--output') + 1]
      await writeFile(template.replace('%(title).180B.%(ext)s', 'Prepared sample.mp3'), VALID_TINY_MP3)
    })
    const store = new LocalStore(join(directory, 'state.json'))
    const baseOptions = {
      onProgress: (event: { message: string }) => progress.push(event.message),
      resolveHost: async () => [{ address: '208.80.154.224', family: 4 }],
      runProcess
    }

    await importListeningFromVideoPage(
      'https://commons.wikimedia.org/wiki/File:One.webm', store, join(directory, 'media'),
      { ...baseOptions, componentProvider: manager, id: 'aaaa-1111' }
    )
    const reopenedManager = new VideoComponentManager({
      directory: join(directory, 'managed-components'), release, download
    })
    await importListeningFromVideoPage(
      'https://commons.wikimedia.org/wiki/File:Two.webm', store, join(directory, 'media'),
      { ...baseOptions, componentProvider: reopenedManager, id: 'bbbb-2222' }
    )

    expect(download).toHaveBeenCalledTimes(2)
    expect(runProcess).toHaveBeenCalledTimes(2)
    expect(progress).toContain('Downloading yt-dlp')
    expect(progress).toContain('Video components are ready')
    await expect(store.read()).resolves.toMatchObject({ listeningItems: [{ id: 'bbbb-2222' }, { id: 'aaaa-1111' }] })
  })

  it('never executes a corrupt download and succeeds when the learner retries', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-video-components-'))
    directories.push(directory)
    const ytDlp = Buffer.from('trusted yt-dlp executable')
    const ffmpeg = Buffer.from('trusted ffmpeg executable')
    const archive = await makeFfmpegArchive(ffmpeg)
    const release = releaseFor(ytDlp, archive, ffmpeg)
    let corruptFirstDownload = true
    const download = vi.fn(async (url: string, onProgress: (downloaded: number, total: number) => void) => {
      const bytes = url.endsWith('yt-dlp.exe')
        ? (corruptFirstDownload ? Buffer.from('corrupt') : ytDlp)
        : archive
      corruptFirstDownload = false
      onProgress(bytes.length, bytes.length)
      return bytes
    })
    const manager = new VideoComponentManager({ directory: join(directory, 'managed-components'), release, download })
    const runProcess = vi.fn(async (_executable: string, args: string[]) => {
      const template = args[args.indexOf('--output') + 1]
      await writeFile(template.replace('%(title).180B.%(ext)s', 'Retry sample.mp3'), VALID_TINY_MP3)
    })
    const options = {
      componentProvider: manager,
      resolveHost: async () => [{ address: '208.80.154.224', family: 4 }],
      runProcess,
      id: 'cccc-3333'
    }
    const store = new LocalStore(join(directory, 'state.json'))

    await expect(importListeningFromVideoPage(
      'https://commons.wikimedia.org/wiki/File:Retry.webm', store, join(directory, 'media'), options
    )).rejects.toThrow(/integrity check/i)
    expect(runProcess).not.toHaveBeenCalled()
    await expect(importListeningFromVideoPage(
      'https://commons.wikimedia.org/wiki/File:Retry.webm', store, join(directory, 'media'), options
    )).resolves.toMatchObject({ id: 'cccc-3333' })
    expect(runProcess).toHaveBeenCalledOnce()
  })

  it('uses one atomic preparation when two video imports start together', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-video-components-'))
    directories.push(directory)
    const ytDlp = Buffer.from('trusted yt-dlp executable')
    const ffmpeg = Buffer.from('trusted ffmpeg executable')
    const archive = await makeFfmpegArchive(ffmpeg)
    const release = releaseFor(ytDlp, archive, ffmpeg)
    const download = vi.fn(async (url: string) => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return url.endsWith('yt-dlp.exe') ? ytDlp : archive
    })
    const manager = new VideoComponentManager({ directory: join(directory, 'managed-components'), release, download })
    const runProcess = vi.fn(async (_executable: string, args: string[]) => {
      const template = args[args.indexOf('--output') + 1]
      await writeFile(template.replace('%(title).180B.%(ext)s', `Concurrent-${runProcess.mock.calls.length}.mp3`), VALID_TINY_MP3)
    })
    const store = new LocalStore(join(directory, 'state.json'))
    const options = {
      componentProvider: manager,
      resolveHost: async () => [{ address: '208.80.154.224', family: 4 }],
      runProcess
    }

    await Promise.all([
      importListeningFromVideoPage('https://commons.wikimedia.org/wiki/File:A.webm', store, join(directory, 'media'), { ...options, id: 'dddd-4444' }),
      importListeningFromVideoPage('https://commons.wikimedia.org/wiki/File:B.webm', store, join(directory, 'media'), { ...options, id: 'eeee-5555' })
    ])
    expect(download).toHaveBeenCalledTimes(2)
    expect(runProcess).toHaveBeenCalledTimes(2)
  })

  it('rejects an archive path escape before any component is executed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-video-components-'))
    directories.push(directory)
    const ytDlp = Buffer.from('trusted yt-dlp executable')
    const ffmpeg = Buffer.from('trusted ffmpeg executable')
    const safeArchive = await makeFfmpegArchive(ffmpeg)
    const unsafeArchive = replaceArchiveName(safeArchive, 'ffmpeg-test/bin/ffmpeg.exe', '../escape.exe/////////////')
    const release = releaseFor(ytDlp, unsafeArchive, ffmpeg)
    const runProcess = vi.fn()
    const manager = new VideoComponentManager({
      directory: join(directory, 'managed-components'),
      release,
      download: async (url) => url.endsWith('yt-dlp.exe') ? ytDlp : unsafeArchive
    })

    await expect(importListeningFromVideoPage(
      'https://commons.wikimedia.org/wiki/File:Unsafe.webm',
      new LocalStore(join(directory, 'state.json')),
      join(directory, 'media'),
      {
        componentProvider: manager,
        resolveHost: async () => [{ address: '208.80.154.224', family: 4 }],
        runProcess
      }
    )).rejects.toThrow(/unsafe|invalid relative path/i)
    expect(runProcess).not.toHaveBeenCalled()
  })

  it('rejects an oversized archive before any component is executed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-video-components-'))
    directories.push(directory)
    const ytDlp = Buffer.from('trusted yt-dlp executable')
    const ffmpeg = Buffer.from('trusted ffmpeg executable')
    const archive = await makeFfmpegArchive(ffmpeg)
    const release = releaseFor(ytDlp, archive, ffmpeg)
    const runProcess = vi.fn()
    const manager = new VideoComponentManager({
      directory: join(directory, 'managed-components'),
      release,
      maxExtractedBytes: ffmpeg.length - 1,
      download: async (url) => url.endsWith('yt-dlp.exe') ? ytDlp : archive
    })

    await expect(importListeningFromVideoPage(
      'https://commons.wikimedia.org/wiki/File:Oversized.webm',
      new LocalStore(join(directory, 'state.json')),
      join(directory, 'media'),
      {
        componentProvider: manager,
        resolveHost: async () => [{ address: '208.80.154.224', family: 4 }],
        runProcess
      }
    )).rejects.toThrow(/oversized/i)
    expect(runProcess).not.toHaveBeenCalled()
  })

  it('replaces a corrupted managed executable before the next import executes it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-video-components-'))
    directories.push(directory)
    const managedDirectory = join(directory, 'managed-components')
    const ytDlp = Buffer.from('trusted yt-dlp executable')
    const ffmpeg = Buffer.from('trusted ffmpeg executable')
    const archive = await makeFfmpegArchive(ffmpeg)
    const release = releaseFor(ytDlp, archive, ffmpeg)
    const download = vi.fn(async (url: string) => url.endsWith('yt-dlp.exe') ? ytDlp : archive)
    const runProcess = vi.fn(async (executable: string, args: string[]) => {
      expect(sha256(await readFile(executable))).toBe(release.ytDlp.sha256)
      const ffmpegPath = args[args.indexOf('--ffmpeg-location') + 1]
      expect(sha256(await readFile(ffmpegPath))).toBe(release.ffmpeg.executableSha256)
      const template = args[args.indexOf('--output') + 1]
      await writeFile(template.replace('%(title).180B.%(ext)s', `Integrity-${runProcess.mock.calls.length}.mp3`), VALID_TINY_MP3)
    })
    const store = new LocalStore(join(directory, 'state.json'))
    const baseOptions = {
      resolveHost: async () => [{ address: '208.80.154.224', family: 4 }],
      runProcess
    }

    await importListeningFromVideoPage(
      'https://commons.wikimedia.org/wiki/File:Original.webm', store, join(directory, 'media'),
      { ...baseOptions, componentProvider: new VideoComponentManager({ directory: managedDirectory, release, download }), id: 'ffff-6666' }
    )
    await writeFile(join(managedDirectory, release.id, 'ffmpeg.exe'), Buffer.from('tampered executable'))
    await importListeningFromVideoPage(
      'https://commons.wikimedia.org/wiki/File:Recovered.webm', store, join(directory, 'media'),
      { ...baseOptions, componentProvider: new VideoComponentManager({ directory: managedDirectory, release, download }), id: 'aaaa-7777' }
    )

    expect(download).toHaveBeenCalledTimes(4)
    expect(runProcess).toHaveBeenCalledTimes(2)
  })

  it('cleans an interrupted preparation and allows a clean retry', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-video-components-'))
    directories.push(directory)
    const managedDirectory = join(directory, 'managed-components')
    const ytDlp = Buffer.from('trusted yt-dlp executable')
    const ffmpeg = Buffer.from('trusted ffmpeg executable')
    const archive = await makeFfmpegArchive(ffmpeg)
    const release = releaseFor(ytDlp, archive, ffmpeg)
    let blockFirstDownload = true
    const download = vi.fn(async (url: string, _onProgress: unknown, signal?: AbortSignal) => {
      if (blockFirstDownload) {
        blockFirstDownload = false
        return new Promise<Buffer>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('The download was cancelled.')), { once: true })
        })
      }
      return url.endsWith('yt-dlp.exe') ? ytDlp : archive
    })
    const manager = new VideoComponentManager({ directory: managedDirectory, release, download })
    const runProcess = vi.fn(async (_executable: string, args: string[]) => {
      const template = args[args.indexOf('--output') + 1]
      await writeFile(template.replace('%(title).180B.%(ext)s', 'Cancelled retry.mp3'), VALID_TINY_MP3)
    })
    const controller = new AbortController()
    const store = new LocalStore(join(directory, 'state.json'))
    const first = importListeningFromVideoPage(
      'https://commons.wikimedia.org/wiki/File:Cancelled.webm', store, join(directory, 'media'),
      {
        componentProvider: manager,
        signal: controller.signal,
        resolveHost: async () => [{ address: '208.80.154.224', family: 4 }],
        runProcess
      }
    )
    await vi.waitFor(() => expect(download).toHaveBeenCalledOnce())
    controller.abort()
    await expect(first).rejects.toThrow(/cancelled/i)
    expect((await readdir(managedDirectory)).filter((name) => name.startsWith('.preparing-'))).toEqual([])
    expect(runProcess).not.toHaveBeenCalled()

    await expect(importListeningFromVideoPage(
      'https://commons.wikimedia.org/wiki/File:Retry.webm', store, join(directory, 'media'),
      {
        componentProvider: manager,
        resolveHost: async () => [{ address: '208.80.154.224', family: 4 }],
        runProcess,
        id: 'bbbb-8888'
      }
    )).resolves.toMatchObject({ id: 'bbbb-8888' })
    expect(runProcess).toHaveBeenCalledOnce()
  })

  it('stops the default network download promptly when the learner cancels and then allows retry', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-video-components-'))
    directories.push(directory)
    const managedDirectory = join(directory, 'managed-components')
    const ytDlp = Buffer.from('trusted yt-dlp executable')
    const ffmpeg = Buffer.from('trusted ffmpeg executable')
    const archive = await makeFfmpegArchive(ffmpeg)
    const release = releaseFor(ytDlp, archive, ffmpeg)
    release.ytDlp.url = 'https://github.com/test/yt-dlp.exe'
    release.ffmpeg.url = 'https://release-assets.githubusercontent.com/test/ffmpeg.zip'

    let receivedBytes = 0
    let networkAbortObserved = false
    const firstResponseControl: { stop?: (error: Error) => void } = {}
    let requestCount = 0
    const requestImpl = vi.fn(async (_url: URL, _addresses: unknown, signal: AbortSignal) => {
      requestCount += 1
      if (requestCount === 1) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            const interval = setInterval(() => {
              receivedBytes += 1
              controller.enqueue(Uint8Array.of(120))
            }, 5)
            const stop = (error: Error): void => {
              clearInterval(interval)
              try { controller.error(error) } catch { /* response already closed */ }
            }
            firstResponseControl.stop = stop
            signal.addEventListener('abort', () => {
              networkAbortObserved = true
              stop(new Error('simulated network connection aborted'))
            }, { once: true })
          }
        })
        return new Response(body, { headers: { 'content-type': 'application/octet-stream' } })
      }
      const bytes = requestCount === 2 ? ytDlp : archive
      return new Response(Uint8Array.from(bytes), {
        headers: {
          'content-type': requestCount === 2 ? 'application/octet-stream' : 'application/zip',
          'content-length': String(bytes.length)
        }
      })
    })
    const manager = new VideoComponentManager({
      directory: managedDirectory,
      release,
      requestImpl,
      resolveHost: async () => [{ address: '93.184.216.34', family: 4 }]
    })
    const runProcess = vi.fn(async (_executable: string, args: string[]) => {
      const template = args[args.indexOf('--output') + 1]
      await writeFile(template.replace('%(title).180B.%(ext)s', 'Default download retry.mp3'), VALID_TINY_MP3)
    })
    const store = new LocalStore(join(directory, 'state.json'))
    const controller = new AbortController()
    const firstOutcome = importListeningFromVideoPage(
      'https://commons.wikimedia.org/wiki/File:Cancelled-default.webm', store, join(directory, 'media'),
      {
        componentProvider: manager,
        signal: controller.signal,
        resolveHost: async () => [{ address: '208.80.154.224', family: 4 }],
        runProcess
      }
    ).then(() => null, (error: unknown) => error)

    await vi.waitFor(() => expect(receivedBytes).toBeGreaterThanOrEqual(2))
    const bytesAtCancel = receivedBytes
    controller.abort()
    await new Promise((resolve) => setTimeout(resolve, 50))
    const bytesReceivedAfterCancel = receivedBytes - bytesAtCancel
    if (!networkAbortObserved) firstResponseControl.stop?.(new Error('fixture stopped after missing cancellation'))
    const firstError = await firstOutcome

    expect(firstError).toBeInstanceOf(Error)
    expect(networkAbortObserved).toBe(true)
    expect(bytesReceivedAfterCancel).toBeLessThanOrEqual(1)
    expect(requestImpl).toHaveBeenCalledOnce()
    expect((await readdir(managedDirectory)).filter((name) => name.startsWith('.preparing-'))).toEqual([])
    expect(runProcess).not.toHaveBeenCalled()

    await expect(importListeningFromVideoPage(
      'https://commons.wikimedia.org/wiki/File:Retry-default.webm', store, join(directory, 'media'),
      {
        componentProvider: manager,
        resolveHost: async () => [{ address: '208.80.154.224', family: 4 }],
        runProcess,
        id: 'cccc-9999'
      }
    )).resolves.toMatchObject({ id: 'cccc-9999' })
    expect(requestImpl).toHaveBeenCalledTimes(3)
    expect(runProcess).toHaveBeenCalledOnce()
  })
})
