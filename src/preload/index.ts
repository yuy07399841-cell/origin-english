import { contextBridge, ipcRenderer } from 'electron'
import type { OriginEnglishApi } from '../shared/types'

const api: OriginEnglishApi = {
  importMarkdown: () => ipcRenderer.invoke('article:import'),
  deleteArticle: (id) => ipcRenderer.invoke('article:delete', id),
  importListening: () => ipcRenderer.invoke('listening:import'),
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
