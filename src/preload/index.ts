import { contextBridge, ipcRenderer } from 'electron'
import type { OriginEnglishApi, VideoImportProgress } from '../shared/types'

let videoImportRequestSequence = 0
let activeVideoImportRequestId: string | null = null

const api: OriginEnglishApi = {
  importMarkdown: () => ipcRenderer.invoke('article:import'),
  importArticleUrl: (url) => ipcRenderer.invoke('article:import-url', url),
  getArticleAsset: (articleId, storedFileName) =>
    ipcRenderer.invoke('article:asset', articleId, storedFileName),
  deleteArticle: (id) => ipcRenderer.invoke('article:delete', id),
  importListening: () => ipcRenderer.invoke('listening:import'),
  importListeningAudioUrl: (url) => ipcRenderer.invoke('listening:import-audio-url', url),
  importListeningVideoUrl: async (url, onProgress) => {
    const requestId = `video-import-${++videoImportRequestSequence}`
    activeVideoImportRequestId = requestId
    const channel = 'listening:video-import-progress'
    const listener = (_event: Electron.IpcRendererEvent, payload: { requestId?: unknown; progress?: unknown }): void => {
      if (payload?.requestId === requestId && onProgress) onProgress(payload.progress as VideoImportProgress)
    }
    ipcRenderer.on(channel, listener)
    try {
      return await ipcRenderer.invoke('listening:import-video-url', url, requestId)
    } finally {
      ipcRenderer.removeListener(channel, listener)
      if (activeVideoImportRequestId === requestId) activeVideoImportRequestId = null
    }
  },
  cancelListeningVideoImport: () => {
    if (activeVideoImportRequestId) ipcRenderer.send('listening:cancel-video-import', activeVideoImportRequestId)
  },
  deleteListening: (id) => ipcRenderer.invoke('listening:delete', id),
  getListeningAudio: (id) => ipcRenderer.invoke('listening:audio', id),
  transcribeListening: (id) => ipcRenderer.invoke('listening:transcribe', id),
  loadState: () => ipcRenderer.invoke('state:load'),
  setUiLanguage: (language) => ipcRenderer.invoke('settings:set-language', language),
  saveWord: (input) => ipcRenderer.invoke('word:save', input),
  deleteWord: (id) => ipcRenderer.invoke('word:delete', id),
  defineWord: (input) => ipcRenderer.invoke('definition:request', input),
  refineDefinition: (input) => ipcRenderer.invoke('definition:refine', input),
  getChineseHint: (input) => ipcRenderer.invoke('definition:chinese-hint', input),
  getWordAudio: (word) => ipcRenderer.invoke('dictionary:audio', word),
  getSentenceAudio: (input) => ipcRenderer.invoke('sentence:audio', input),
  recordLookup: (input) => ipcRenderer.invoke('lookup:record', input),
  setLookupOutcome: (input) => ipcRenderer.invoke('lookup:set-outcome', input),
  getRuntimeStatus: () => ipcRenderer.invoke('runtime:status'),
  configureAiServices: (input) => ipcRenderer.invoke('ai-services:configure', input),
  disconnectAiServices: () => ipcRenderer.invoke('ai-services:disconnect'),
  dismissAiOnboarding: () => ipcRenderer.invoke('ai-services:dismiss-onboarding')
}

contextBridge.exposeInMainWorld('originEnglish', api)
