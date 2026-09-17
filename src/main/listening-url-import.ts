import { rm } from 'node:fs/promises'
import type { ListeningItem } from '../shared/types'
import { importListeningBytes, MAX_LISTENING_AUDIO_BYTES } from './listening-media'
import type { LocalStore } from './storage'
import { downloadPublicResource, type ResolvedAddress } from './safe-download'

interface ListeningUrlImportOptions {
  fetchImpl?: typeof fetch
  resolveHost?: (host: string) => Promise<ResolvedAddress[]>
  id?: string
  importedAt?: string
}

export async function importListeningFromAudioUrl(
  rawUrl: string,
  store: LocalStore,
  mediaDirectory: string,
  options: ListeningUrlImportOptions = {}
): Promise<ListeningItem> {
  const downloaded = await downloadPublicResource(rawUrl, {
    fetchImpl: options.fetchImpl,
    resolveHost: options.resolveHost,
    maxBytes: MAX_LISTENING_AUDIO_BYTES,
    timeoutMs: 60_000,
    acceptedContentTypes: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav']
  })
  const mimeType: ListeningItem['mimeType'] = downloaded.contentType.includes('wav')
    ? 'audio/wav'
    : 'audio/mpeg'
  let fileName = new URL(downloaded.finalUrl).pathname.split('/').pop() || 'downloaded-audio'
  try { fileName = decodeURIComponent(fileName) } catch { /* Keep the safe URL form. */ }
  const expectedExtension = mimeType === 'audio/mpeg' ? '.mp3' : '.wav'
  if (!fileName.toLowerCase().endsWith(expectedExtension)) fileName += expectedExtension
  const imported = await importListeningBytes(downloaded.bytes, fileName, mimeType, mediaDirectory, {
    id: options.id,
    importedAt: options.importedAt,
    sourceUrl: downloaded.finalUrl
  })
  try {
    await store.update((state) => ({
      ...state,
      listeningItems: [imported.item, ...state.listeningItems]
    }))
  } catch (error) {
    await rm(imported.storedPath, { force: true }).catch(() => undefined)
    throw error
  }
  return imported.item
}
