import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { WordAudioResult } from '../shared/types'
import type { SimpleEnglishDictionary } from './dictionary'

const MAX_AUDIO_BYTES = 5 * 1024 * 1024
const COMMONS_API_URL = 'https://commons.wikimedia.org/w/api.php'

interface CachedAudioMetadata {
  sourceUrl: string
  license: string
  artist: string
  mimeType: string
  audioFileName: string
}

interface CommonsMetadataValue {
  value?: unknown
}

function plainMetadata(value: CommonsMetadataValue | undefined, fallback: string): string {
  if (typeof value?.value !== 'string') return fallback
  return value.value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || fallback
}

function extensionForMime(mimeType: string): string {
  if (mimeType === 'audio/ogg' || mimeType === 'application/ogg') return '.ogg'
  if (mimeType === 'audio/mpeg') return '.mp3'
  if (mimeType === 'audio/wav' || mimeType === 'audio/x-wav') return '.wav'
  throw new Error('The dictionary recording uses an unsupported audio format.')
}

function toDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`
}

export class WikimediaWordAudioService {
  constructor(
    private readonly dictionary: SimpleEnglishDictionary,
    private readonly cacheDirectory: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async get(word: string): Promise<WordAudioResult> {
    const reference = await this.dictionary.getAudioReference(word)
    if (!reference) throw new Error('No recorded pronunciation is available for this word.')

    const cacheKey = createHash('sha256').update(reference.fileName.toLowerCase()).digest('hex')
    const metadataPath = join(this.cacheDirectory, `${cacheKey}.json`)
    try {
      const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as CachedAudioMetadata
      const bytes = await readFile(join(this.cacheDirectory, metadata.audioFileName))
      return {
        dataUrl: toDataUrl(bytes, metadata.mimeType),
        sourceUrl: metadata.sourceUrl,
        license: metadata.license,
        artist: metadata.artist,
        sourceWord: reference.sourceWord
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error('The cached pronunciation is invalid. Remove the audio cache and try again.')
      }
    }

    const apiUrl = new URL(COMMONS_API_URL)
    apiUrl.search = new URLSearchParams({
      action: 'query',
      format: 'json',
      prop: 'imageinfo',
      iiprop: 'url|mime|extmetadata',
      titles: `File:${reference.fileName}`
    }).toString()

    const metadataResponse = await this.fetchImpl(apiUrl, {
      headers: { 'User-Agent': 'OriginEnglish/0.1 personal-learning-app' },
      signal: AbortSignal.timeout(12_000)
    })
    if (!metadataResponse.ok) throw new Error('Wikimedia Commons pronunciation lookup failed.')
    const metadataPayload = (await metadataResponse.json()) as {
      query?: {
        pages?: Record<
          string,
          {
            imageinfo?: Array<{
              url?: unknown
              descriptionurl?: unknown
              mime?: unknown
              extmetadata?: Record<string, CommonsMetadataValue>
            }>
          }
        >
      }
    }
    const page = Object.values(metadataPayload.query?.pages ?? {})[0]
    const imageInfo = page?.imageinfo?.[0]
    if (
      typeof imageInfo?.url !== 'string' ||
      typeof imageInfo.descriptionurl !== 'string' ||
      typeof imageInfo.mime !== 'string'
    ) {
      throw new Error('Wikimedia Commons returned no usable pronunciation recording.')
    }

    const audioUrl = new URL(imageInfo.url)
    if (audioUrl.protocol !== 'https:' || audioUrl.hostname !== 'upload.wikimedia.org') {
      throw new Error('Wikimedia Commons returned an untrusted audio location.')
    }
    const extension = extensionForMime(imageInfo.mime)
    const audioResponse = await this.fetchImpl(audioUrl, {
      headers: { 'User-Agent': 'OriginEnglish/0.1 personal-learning-app' },
      signal: AbortSignal.timeout(15_000)
    })
    if (!audioResponse.ok) throw new Error('The pronunciation recording could not be downloaded.')
    const declaredLength = Number(audioResponse.headers.get('content-length') ?? 0)
    if (declaredLength > MAX_AUDIO_BYTES) throw new Error('The pronunciation recording is too large.')
    const bytes = new Uint8Array(await audioResponse.arrayBuffer())
    if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) {
      throw new Error('The pronunciation recording has an invalid size.')
    }

    const audioFileName = `${cacheKey}${extension}`
    const metadata: CachedAudioMetadata = {
      sourceUrl: imageInfo.descriptionurl,
      license: plainMetadata(imageInfo.extmetadata?.LicenseShortName, 'See source page'),
      artist: plainMetadata(imageInfo.extmetadata?.Artist, 'Wikimedia Commons contributor'),
      mimeType: imageInfo.mime,
      audioFileName
    }
    await mkdir(this.cacheDirectory, { recursive: true })
    const audioTempPath = join(this.cacheDirectory, `${audioFileName}.${process.pid}.tmp`)
    const metadataTempPath = `${metadataPath}.${process.pid}.tmp`
    await writeFile(audioTempPath, bytes)
    await writeFile(metadataTempPath, JSON.stringify(metadata), 'utf8')
    await rename(audioTempPath, join(this.cacheDirectory, audioFileName))
    await rename(metadataTempPath, metadataPath)

    return {
      dataUrl: toDataUrl(bytes, imageInfo.mime),
      sourceUrl: metadata.sourceUrl,
      license: metadata.license,
      artist: metadata.artist,
      sourceWord: reference.sourceWord
    }
  }
}
