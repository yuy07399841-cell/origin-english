import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { ListeningAudioResult, ListeningItem } from '../shared/types'

export const MAX_LISTENING_AUDIO_BYTES = 100 * 1024 * 1024

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
