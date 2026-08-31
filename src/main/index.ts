import { randomUUID } from 'node:crypto'
import { readFile, rm, stat } from 'node:fs/promises'
import { basename, extname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  type IpcMainInvokeEvent,
  type OpenDialogOptions
} from 'electron'
import dictionaryAssetPath from './assets/simple-wiktionary.data?asset'
import dictionaryNoticeAssetPath from './assets/SIMPLE_WIKTIONARY_NOTICE.txt?asset'
import ecdictChineseAssetPath from './assets/ecdict-chinese.data?asset'
import ecdictNoticeAssetPath from './assets/ECDICT_NOTICE.txt?asset'
import type {
  AppState,
  Article,
  ChineseHintResult,
  DefinitionResult,
  ListeningAudioResult,
  ListeningItem,
  RecordLookupResult,
  RuntimeStatus,
  SentenceAudioResult,
  WordAudioResult
} from '../shared/types'
import { toPlainArticleTitle } from '../shared/article-title'
import { SimpleEnglishDictionary } from './dictionary'
import { EcdictChineseDictionary } from './chinese-dictionary'
import { AiServiceConfigStore } from './ai-service-config'
import { AiServiceManager } from './ai-service-manager'
import { LocalStore } from './storage'
import {
  validateDefinitionRequest,
  validateChineseHintRequest,
  validateId,
  normalizeWord,
  validateSentenceAudioRequest,
  validateRecordLookupInput,
  validateSaveWordInput,
  validateSetLookupOutcomeInput,
  validateUiLanguage
} from './validation'
import { WikimediaWordAudioService } from './word-audio'
import { ORIGIN_ENGLISH_APP_ID, resolveOriginEnglishUserDataPath } from './app-paths'
import { deleteArticleFromState } from './article-state'
import { importListeningFile, loadListeningAudio } from './listening-media'
import { LocalListeningTranscriptionService } from './listening-transcription'

const MAX_MARKDOWN_BYTES = 5 * 1024 * 1024
let store: LocalStore
let aiServiceManager: AiServiceManager
let wordAudioService: WikimediaWordAudioService | null = null
let listeningMediaDirectory: string
let listeningTranscriptionService: LocalListeningTranscriptionService | null = null

const userDataOverride = process.env.ORIGIN_ENGLISH_USER_DATA_DIR?.trim()
app.setPath(
  'userData',
  resolveOriginEnglishUserDataPath(app.getPath('appData'), userDataOverride)
)
if (process.platform === 'win32') app.setAppUserModelId(ORIGIN_ENGLISH_APP_ID)

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url ?? ''
  const rendererRootUrl = pathToFileURL(`${resolve(__dirname, '../renderer')}${sep}`).href
  const developmentOrigin = process.env.ELECTRON_RENDERER_URL
    ? new URL(process.env.ELECTRON_RENDERER_URL).origin
    : null
  const senderOrigin = senderUrl.startsWith('http') ? new URL(senderUrl).origin : null
  const isTrusted =
    senderUrl.startsWith(rendererRootUrl) ||
    (developmentOrigin !== null && senderOrigin === developmentOrigin)

  if (!isTrusted) {
    throw new Error('Blocked an untrusted application request.')
  }
}

function extractTitle(markdown: string, fileName: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim()
  return toPlainArticleTitle(heading || basename(fileName, extname(fileName)))
}

async function importMarkdown(event: IpcMainInvokeEvent): Promise<Article | null> {
  assertTrustedSender(event)
  const { uiLanguage } = await store.read()
  const importCopy =
    uiLanguage === 'zh'
      ? {
          title: '导入 Markdown 文章',
          unsupported: '当前版本只支持 Markdown 文件。',
          tooLarge: '这个 Markdown 文件超过了 5 MB 限制。',
          empty: '选择的 Markdown 文件是空的。'
        }
      : {
          title: 'Import a Markdown article',
          unsupported: 'Only Markdown files are supported in this version.',
          tooLarge: 'This Markdown file is larger than the 5 MB limit.',
          empty: 'The selected Markdown file is empty.'
        }
  const owner = BrowserWindow.fromWebContents(event.sender)
  const dialogOptions: OpenDialogOptions = {
    title: importCopy.title,
    properties: ['openFile'],
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
  }
  const result = owner
    ? await dialog.showOpenDialog(owner, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions)

  const filePath = result.filePaths[0]
  if (result.canceled || !filePath) return null

  const extension = extname(filePath).toLowerCase()
  if (extension !== '.md' && extension !== '.markdown') {
    throw new Error(importCopy.unsupported)
  }

  const fileStats = await stat(filePath)
  if (fileStats.size > MAX_MARKDOWN_BYTES) {
    throw new Error(importCopy.tooLarge)
  }

  const markdown = await readFile(filePath, 'utf8')
  if (!markdown.trim()) {
    throw new Error(importCopy.empty)
  }

  const article: Article = {
    id: randomUUID(),
    title: extractTitle(markdown, filePath),
    fileName: basename(filePath),
    markdown,
    importedAt: new Date().toISOString()
  }

  await store.update((current) => ({ ...current, articles: [article, ...current.articles] }))
  return article
}

async function importListening(event: IpcMainInvokeEvent): Promise<ListeningItem | null> {
  assertTrustedSender(event)
  const { uiLanguage } = await store.read()
  const copy =
    uiLanguage === 'zh'
      ? { title: '导入英语听力音频' }
      : { title: 'Import English listening audio' }
  const owner = BrowserWindow.fromWebContents(event.sender)
  const dialogOptions: OpenDialogOptions = {
    title: copy.title,
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav'] }]
  }
  const result = owner
    ? await dialog.showOpenDialog(owner, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions)
  const filePath = result.filePaths[0]
  if (result.canceled || !filePath) return null

  const imported = await importListeningFile(filePath, listeningMediaDirectory)
  try {
    await store.update((current) => ({
      ...current,
      listeningItems: [imported.item, ...current.listeningItems]
    }))
  } catch (error) {
    await rm(imported.storedPath, { force: true }).catch(() => undefined)
    throw error
  }
  return imported.item
}

function registerIpcHandlers(): void {
  ipcMain.handle('article:import', importMarkdown)

  ipcMain.handle('article:delete', async (event, rawId): Promise<AppState> => {
    assertTrustedSender(event)
    const id = validateId(rawId)
    return store.update((current) => deleteArticleFromState(current, id))
  })

  ipcMain.handle('listening:import', importListening)

  ipcMain.handle('listening:audio', async (event, rawId): Promise<ListeningAudioResult> => {
    assertTrustedSender(event)
    const id = validateId(rawId)
    const current = await store.read()
    const item = current.listeningItems.find((candidate) => candidate.id === id)
    if (!item) throw new Error('This listening file is no longer in the local library.')
    return loadListeningAudio(item, listeningMediaDirectory)
  })

  ipcMain.handle('listening:transcribe', async (event, rawId): Promise<AppState> => {
    assertTrustedSender(event)
    const id = validateId(rawId)
    const current = await store.read()
    const item = current.listeningItems.find((candidate) => candidate.id === id)
    if (!item) throw new Error('This listening file is no longer in the local library.')
    if (item.transcript) return current
    if (!listeningTranscriptionService) {
      throw new Error('The local listening transcription engine is unavailable.')
    }
    const transcript = await listeningTranscriptionService.transcribe(item)
    return store.update((latest) => ({
      ...latest,
      listeningItems: latest.listeningItems.map((candidate) =>
        candidate.id === id && !candidate.transcript
          ? { ...candidate, transcript }
          : candidate
      )
    }))
  })

  ipcMain.handle('state:load', async (event): Promise<AppState> => {
    assertTrustedSender(event)
    return store.read()
  })

  ipcMain.handle('settings:set-language', async (event, rawLanguage): Promise<AppState> => {
    assertTrustedSender(event)
    const uiLanguage = validateUiLanguage(rawLanguage)
    return store.update((current) => ({ ...current, uiLanguage }))
  })

  ipcMain.handle('word:save', async (event, rawInput): Promise<AppState> => {
    assertTrustedSender(event)
    const input = validateSaveWordInput(rawInput)
    return store.update((current) => {
      const duplicateIndex = current.savedWords.findIndex(
        (saved) =>
          saved.word.toLowerCase() === input.word.toLowerCase() &&
          saved.sentence === input.sentence
      )
      const savedWord = {
        ...input,
        id: duplicateIndex >= 0 ? current.savedWords[duplicateIndex].id : randomUUID(),
        savedAt: new Date().toISOString()
      }
      const savedWords = [...current.savedWords]
      if (duplicateIndex >= 0) savedWords[duplicateIndex] = savedWord
      else savedWords.unshift(savedWord)
      return { ...current, savedWords }
    })
  })

  ipcMain.handle('word:delete', async (event, rawId): Promise<AppState> => {
    assertTrustedSender(event)
    const id = validateId(rawId)
    return store.update((current) => ({
      ...current,
      savedWords: current.savedWords.filter((saved) => saved.id !== id)
    }))
  })

  ipcMain.handle('definition:request', async (event, rawInput): Promise<DefinitionResult> => {
    assertTrustedSender(event)
    const input = validateDefinitionRequest(rawInput)
    return aiServiceManager.define(input)
  })

  ipcMain.handle('definition:refine', async (event, rawInput): Promise<DefinitionResult> => {
    assertTrustedSender(event)
    const input = validateDefinitionRequest(rawInput)
    return aiServiceManager.refine(input)
  })

  ipcMain.handle('definition:chinese-hint', async (event, rawInput): Promise<ChineseHintResult> => {
    assertTrustedSender(event)
    const input = validateChineseHintRequest(rawInput)
    return aiServiceManager.getChineseHint(input)
  })

  ipcMain.handle('dictionary:audio', async (event, rawWord): Promise<WordAudioResult> => {
    assertTrustedSender(event)
    if (!wordAudioService) throw new Error('The local dictionary audio service is unavailable.')
    return wordAudioService.get(normalizeWord(rawWord))
  })

  ipcMain.handle('sentence:audio', async (event, rawInput): Promise<SentenceAudioResult> => {
    assertTrustedSender(event)
    const input = validateSentenceAudioRequest(rawInput)
    return aiServiceManager.getSentenceAudio(input.sentence)
  })

  ipcMain.handle('lookup:record', async (event, rawInput): Promise<RecordLookupResult> => {
    assertTrustedSender(event)
    const input = validateRecordLookupInput(rawInput)
    const lookupId = randomUUID()
    const state = await store.update((current) => ({
      ...current,
      lookupEvents: [
        {
          ...input,
          id: lookupId,
          outcome: 'unrated',
          createdAt: new Date().toISOString()
        },
        ...current.lookupEvents
      ]
    }))
    return { state, lookupId }
  })

  ipcMain.handle('lookup:set-outcome', async (event, rawInput): Promise<AppState> => {
    assertTrustedSender(event)
    const input = validateSetLookupOutcomeInput(rawInput)
    return store.update((current) => ({
      ...current,
      lookupEvents: current.lookupEvents.map((lookup) =>
        lookup.id === input.lookupId ? { ...lookup, outcome: input.outcome } : lookup
      )
    }))
  })

  ipcMain.handle('runtime:status', async (event): Promise<RuntimeStatus> => {
    assertTrustedSender(event)
    return aiServiceManager.status()
  })

  ipcMain.handle('ai-services:configure', async (event, rawInput): Promise<RuntimeStatus> => {
    assertTrustedSender(event)
    return aiServiceManager.configure(rawInput)
  })

  ipcMain.handle('ai-services:disconnect', async (event): Promise<RuntimeStatus> => {
    assertTrustedSender(event)
    return aiServiceManager.disconnectAll()
  })

  ipcMain.handle('ai-services:dismiss-onboarding', async (event): Promise<RuntimeStatus> => {
    assertTrustedSender(event)
    return aiServiceManager.dismissOnboarding()
  })
}

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 880,
    minHeight: 640,
    show: false,
    backgroundColor: '#f4f2ed',
    title: '原境英语',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#f8f6f0',
      symbolColor: '#314139',
      height: 52
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.removeMenu()
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault()
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(async () => {
  const dataDirectory = join(app.getPath('userData'), 'origin-english')
  store = new LocalStore(join(dataDirectory, 'state.json'))
  listeningMediaDirectory = join(dataDirectory, 'listening-media')
  const transcriptionBundleRoot = app.isPackaged
    ? join(process.resourcesPath, 'transcription')
    : join(app.getAppPath(), '.validation', 'listening-spike')
  listeningTranscriptionService = new LocalListeningTranscriptionService({
    dataDirectory,
    modelSourcePath: join(transcriptionBundleRoot, 'ggml-small.en.bin'),
    runtimeSourceDirectory: app.isPackaged
      ? join(transcriptionBundleRoot, 'runtime')
      : join(transcriptionBundleRoot, 'whisper-runtime', 'Release')
  })
  void dictionaryNoticeAssetPath
  void ecdictNoticeAssetPath
  const dictionary = new SimpleEnglishDictionary(dictionaryAssetPath)
  const chineseDictionary = new EcdictChineseDictionary(ecdictChineseAssetPath)
  aiServiceManager = new AiServiceManager({
    configStore: new AiServiceConfigStore(join(dataDirectory, 'ai-services.json'), safeStorage),
    dataDirectory,
    dictionary,
    chineseDictionary
  })
  await aiServiceManager.initialize()
  wordAudioService = new WikimediaWordAudioService(
    dictionary,
    join(dataDirectory, 'word-audio-cache')
  )
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
