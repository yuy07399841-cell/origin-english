import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  SCHEMA_VERSION,
  type AppState,
  type Article,
  type ListeningItem,
  type ListeningSentence,
  type UiLanguage
} from '../shared/types'

interface LegacyStateCollections {
  currentArticle: Article | null
  savedWords: AppState['savedWords']
  lookupEvents: AppState['lookupEvents']
}

interface VersionOneState extends LegacyStateCollections {
  schemaVersion: 1
}

interface VersionTwoState extends LegacyStateCollections {
  schemaVersion: 2
  uiLanguage: UiLanguage
}

interface VersionThreeState {
  schemaVersion: 3
  uiLanguage: UiLanguage
  articles: Article[]
  savedWords: AppState['savedWords']
  lookupEvents: AppState['lookupEvents']
}

export function createEmptyState(): AppState {
  return {
    schemaVersion: SCHEMA_VERSION,
    uiLanguage: 'en',
    articles: [],
    listeningItems: [],
    savedWords: [],
    lookupEvents: []
  }
}

function isListeningSentence(value: unknown): value is ListeningSentence {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ListeningSentence>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.text === 'string' &&
    candidate.text.trim().length > 0 &&
    typeof candidate.startMs === 'number' &&
    Number.isFinite(candidate.startMs) &&
    candidate.startMs >= 0 &&
    typeof candidate.endMs === 'number' &&
    Number.isFinite(candidate.endMs) &&
    candidate.endMs > candidate.startMs
  )
}

function isListeningItem(value: unknown): value is ListeningItem {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ListeningItem>
  const transcript = candidate.transcript
  const validTranscript =
    transcript === null ||
    (typeof transcript === 'object' &&
      transcript.model === 'small.en' &&
      typeof transcript.createdAt === 'string' &&
      typeof transcript.durationMs === 'number' &&
      Number.isFinite(transcript.durationMs) &&
      transcript.durationMs > 0 &&
      Array.isArray(transcript.sentences) &&
      transcript.sentences.length > 0 &&
      transcript.sentences.every(
        (sentence) => isListeningSentence(sentence) && sentence.endMs <= transcript.durationMs
      ))

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.fileName === 'string' &&
    typeof candidate.storedFileName === 'string' &&
    /^audio-[a-f0-9-]+\.(?:mp3|wav)$/.test(candidate.storedFileName) &&
    (candidate.mimeType === 'audio/mpeg' || candidate.mimeType === 'audio/wav') &&
    typeof candidate.bytes === 'number' &&
    Number.isSafeInteger(candidate.bytes) &&
    candidate.bytes > 0 &&
    typeof candidate.importedAt === 'string' &&
    validTranscript
  )
}

function isArticle(value: unknown): value is Article {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<Article>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.fileName === 'string' &&
    typeof candidate.markdown === 'string' &&
    typeof candidate.importedAt === 'string'
  )
}

function hasLearningCollections(value: unknown): value is {
  savedWords: AppState['savedWords']
  lookupEvents: AppState['lookupEvents']
} {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<AppState>
  return Array.isArray(candidate.savedWords) && Array.isArray(candidate.lookupEvents)
}

function hasLegacyStateCollections(value: unknown): value is LegacyStateCollections {
  if (!hasLearningCollections(value)) return false
  const candidate = value as { currentArticle?: unknown }
  return candidate.currentArticle === null || isArticle(candidate.currentArticle)
}

function isAppState(value: unknown): value is AppState {
  if (!hasLearningCollections(value)) return false
  const candidate = value as Partial<AppState>
  return (
    candidate.schemaVersion === SCHEMA_VERSION &&
    (candidate.uiLanguage === 'zh' || candidate.uiLanguage === 'en') &&
    Array.isArray(candidate.articles) &&
    candidate.articles.every(isArticle) &&
    Array.isArray(candidate.listeningItems) &&
    candidate.listeningItems.every(isListeningItem)
  )
}

function isVersionThreeState(value: unknown): value is VersionThreeState {
  if (!hasLearningCollections(value)) return false
  const candidate = value as Partial<VersionThreeState>
  return (
    candidate.schemaVersion === 3 &&
    (candidate.uiLanguage === 'zh' || candidate.uiLanguage === 'en') &&
    Array.isArray(candidate.articles) &&
    candidate.articles.every(isArticle)
  )
}

function isVersionOneState(value: unknown): value is VersionOneState {
  return (
    hasLegacyStateCollections(value) &&
    (value as { schemaVersion?: unknown }).schemaVersion === 1
  )
}

function isVersionTwoState(value: unknown): value is VersionTwoState {
  if (!hasLegacyStateCollections(value)) return false
  const candidate = value as { schemaVersion?: unknown; uiLanguage?: unknown }
  return (
    candidate.schemaVersion === 2 &&
    (candidate.uiLanguage === 'zh' || candidate.uiLanguage === 'en')
  )
}

function migrateLegacyState(
  state: VersionOneState | VersionTwoState,
  uiLanguage: UiLanguage
): AppState {
  return {
    schemaVersion: SCHEMA_VERSION,
    uiLanguage,
    articles: state.currentArticle ? [state.currentArticle] : [],
    listeningItems: [],
    savedWords: state.savedWords,
    lookupEvents: state.lookupEvents
  }
}

export class LocalStore {
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async read(): Promise<AppState> {
    try {
      const content = await readFile(this.filePath, 'utf8')
      const parsed: unknown = JSON.parse(content)
      if (isVersionOneState(parsed)) {
        const migrated = migrateLegacyState(parsed, 'en')
        await this.backUpVersion(1, content)
        await this.write(migrated)
        return migrated
      }
      if (isVersionTwoState(parsed)) {
        const migrated = migrateLegacyState(parsed, parsed.uiLanguage)
        await this.backUpVersion(2, content)
        await this.write(migrated)
        return migrated
      }
      if (isVersionThreeState(parsed)) {
        const migrated: AppState = {
          ...parsed,
          schemaVersion: SCHEMA_VERSION,
          listeningItems: []
        }
        await this.backUpVersion(3, content)
        await this.write(migrated)
        return migrated
      }
      if (!isAppState(parsed)) {
        throw new Error('Local data uses an unsupported structure.')
      }
      return parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return createEmptyState()
      }
      throw error
    }
  }

  private async backUpVersion(version: 1 | 2 | 3, content: string): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    try {
      await writeFile(`${this.filePath}.v${version}.backup`, content, {
        encoding: 'utf8',
        flag: 'wx'
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }

  async update(updater: (current: AppState) => AppState): Promise<AppState> {
    let updated = createEmptyState()
    const operation = this.queue.then(async () => {
      const current = await this.read()
      updated = updater(current)
      await this.write(updated)
    })

    this.queue = operation.catch(() => undefined)
    await operation
    return updated
  }

  private async write(state: AppState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.${process.pid}.tmp`
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await rename(tempPath, this.filePath)
  }
}
