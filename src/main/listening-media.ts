import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { ListeningAudioResult, ListeningItem } from '../shared/types'

export const MAX_LISTENING_AUDIO_BYTES = 100 * 1024 * 1024

export interface StagedListeningFileDeletion {
  commit: () => Promise<void>
  rollback: () => Promise<void>
}

const AUDIO_FORMATS = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav'
} as const

function managedFileName(id: string, extension: keyof typeof AUDIO_FORMATS): string {
  return `audio-${id}${extension}`
}

export function isManagedListeningFileName(value: string): boolean {
  return /^audio-[a-f0-9-]+\.(?:mp3|wav)$/.test(value)
}

export async function importListeningFile(
  sourcePath: string,
  mediaDirectory: string,
  options: {
    id?: string
    importedAt?: string
  } = {}
): Promise<{ item: ListeningItem; storedPath: string }> {
  const extension = extname(sourcePath).toLowerCase() as keyof typeof AUDIO_FORMATS
  const mimeType = AUDIO_FORMATS[extension]
  if (!mimeType) {
    throw new Error('Only MP3 and WAV audio files are supported.')
  }

  const sourceStats = await stat(sourcePath)
  if (!sourceStats.isFile() || sourceStats.size <= 0) {
    throw new Error('The selected audio file is empty or unavailable.')
  }
  if (sourceStats.size > MAX_LISTENING_AUDIO_BYTES) {
    throw new Error('This audio file is larger than the 100 MB limit.')
  }

  const id = options.id ?? randomUUID()
  if (!/^[a-f0-9-]+$/.test(id)) {
    throw new Error('The generated audio id is invalid.')
  }
  const storedFileName = managedFileName(id, extension)
  const storedPath = join(mediaDirectory, storedFileName)
  const temporaryPath = `${storedPath}.${process.pid}.tmp`
  await mkdir(mediaDirectory, { recursive: true })
  try {
    await copyFile(sourcePath, temporaryPath)
    const copiedStats = await stat(temporaryPath)
    if (copiedStats.size !== sourceStats.size) {
      throw new Error('The imported audio copy is incomplete.')
    }
    await rename(temporaryPath, storedPath)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }

  const fileName = basename(sourcePath)
  return {
    storedPath,
    item: {
      id,
      title: basename(fileName, extension),
      fileName,
      storedFileName,
      mimeType,
      bytes: sourceStats.size,
      importedAt: options.importedAt ?? new Date().toISOString(),
      transcript: null
    }
  }
}

export async function importListeningBytes(
  content: Buffer,
  fileName: string,
  mimeType: ListeningItem['mimeType'],
  mediaDirectory: string,
  options: { id?: string; importedAt?: string; sourceUrl?: string } = {}
): Promise<{ item: ListeningItem; storedPath: string }> {
  if (content.length === 0 || content.length > MAX_LISTENING_AUDIO_BYTES) {
    throw new Error('The downloaded audio is empty or larger than the 100 MB limit.')
  }
  const isMp3 = content.subarray(0, 3).toString('ascii') === 'ID3' ||
    (content.length >= 2 && content[0] === 0xff && (content[1] & 0xe0) === 0xe0)
  const isWav = content.subarray(0, 4).toString('ascii') === 'RIFF' &&
    content.subarray(8, 12).toString('ascii') === 'WAVE'
  if ((mimeType === 'audio/mpeg' && !isMp3) || (mimeType === 'audio/wav' && !isWav)) {
    throw new Error('The downloaded file does not contain valid MP3 or WAV audio.')
  }
  const extension = mimeType === 'audio/mpeg' ? '.mp3' : '.wav'
  const id = options.id ?? randomUUID()
  if (!/^[a-f0-9-]+$/.test(id)) throw new Error('The generated audio id is invalid.')
  const storedFileName = managedFileName(id, extension)
  const storedPath = join(mediaDirectory, storedFileName)
  const temporaryPath = `${storedPath}.${process.pid}.tmp`
  await mkdir(mediaDirectory, { recursive: true })
  try {
    await writeFile(temporaryPath, content)
    await rename(temporaryPath, storedPath)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
  const safeFileName = basename(fileName) || `downloaded-audio${extension}`
  return {
    storedPath,
    item: {
      id,
      title: basename(safeFileName, extname(safeFileName)) || 'Downloaded audio',
      fileName: safeFileName,
      storedFileName,
      mimeType,
      bytes: content.length,
      importedAt: options.importedAt ?? new Date().toISOString(),
      transcript: null,
      sourceUrl: options.sourceUrl ?? null
    }
  }
}

export async function loadListeningAudio(
  item: ListeningItem,
  mediaDirectory: string
): Promise<ListeningAudioResult> {
  if (!isManagedListeningFileName(item.storedFileName)) {
    throw new Error('The saved audio reference is invalid.')
  }
  const content = await readFile(join(mediaDirectory, item.storedFileName))
  if (content.length !== item.bytes || content.length > MAX_LISTENING_AUDIO_BYTES) {
    throw new Error('The saved audio file does not match its library record.')
  }
  return {
    dataUrl: `data:${item.mimeType};base64,${content.toString('base64')}`,
    mimeType: item.mimeType,
    bytes: content.length
  }
}

export async function stageListeningFileDeletion(
  item: ListeningItem,
  mediaDirectory: string
): Promise<StagedListeningFileDeletion> {
  if (!isManagedListeningFileName(item.storedFileName)) {
    throw new Error('The saved audio reference is invalid.')
  }

  const storedPath = join(mediaDirectory, item.storedFileName)
  const stagedPath = `${storedPath}.${process.pid}-${randomUUID()}.delete`
  try {
    await rename(storedPath, stagedPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        commit: async () => undefined,
        rollback: async () => undefined
      }
    }
    throw error
  }

  return {
    commit: async () => rm(stagedPath, { force: true }),
    rollback: async () => rename(stagedPath, storedPath)
  }
}
