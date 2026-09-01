export const SCHEMA_VERSION = 4 as const

export type UiLanguage = 'zh' | 'en'

export interface Article {
  id: string
  title: string
  fileName: string
  markdown: string
  importedAt: string
}

export interface ListeningSentence {
  id: string
  text: string
  startMs: number
  endMs: number
}

export interface ListeningTranscript {
  model: 'small.en'
  createdAt: string
  durationMs: number
  sentences: ListeningSentence[]
}

export interface ListeningItem {
  id: string
  title: string
  fileName: string
  storedFileName: string
  mimeType: 'audio/mpeg' | 'audio/wav'
  bytes: number
  importedAt: string
  transcript: ListeningTranscript | null
}

export interface ListeningAudioResult {
  dataUrl: string
  mimeType: ListeningItem['mimeType']
  bytes: number
}

export interface DefinitionRequest {
  word: string
  sentence: string
}

export interface DefinitionResult {
  word: string
  partOfSpeech: string
  definition: string
  usage: string
  contextualChineseHint: ChineseHintResult | null
  source: 'simple-wiktionary' | 'preview' | 'mimo' | 'openai-compatible'
  notice: string
  phonetic: string | null
  hasAudio: boolean
  hasAlternativeSenses: boolean
  hasChineseReference: boolean
  sourceUrl: string | null
}

export interface ChineseHintRequest extends DefinitionRequest {
  definition: string
}

export interface ChineseHintResult {
  hint: string
  source: 'ecdict' | 'mimo' | 'openai-compatible'
  sourceUrl: string | null
  contextual: boolean
}

export interface WordAudioResult {
  dataUrl: string
  sourceUrl: string
  license: string
  artist: string
  sourceWord: string
}

export interface SentenceAudioRequest {
  sentence: string
}

export interface SentenceAudioResult {
  dataUrl: string
  provider: 'mimo'
  model: string
  voice: string
  cached: boolean
}

export interface SavedWord {
  id: string
  word: string
  sentence: string
  partOfSpeech: string
  definition: string
  usage: string
  articleId: string | null
  savedAt: string
}

export type LookupOutcome = 'unrated' | 'helpful' | 'external-needed'

export interface LookupEvent {
  id: string
  word: string
  sentence: string
  articleId: string | null
  outcome: LookupOutcome
  createdAt: string
}

export interface AppState {
  schemaVersion: typeof SCHEMA_VERSION
  uiLanguage: UiLanguage
  articles: Article[]
  listeningItems: ListeningItem[]
  savedWords: SavedWord[]
  lookupEvents: LookupEvent[]
}

export interface SaveWordInput {
  word: string
  sentence: string
  partOfSpeech: string
  definition: string
  usage: string
  articleId: string | null
}

export interface RecordLookupInput {
  word: string
  sentence: string
  articleId: string | null
}

export interface RecordLookupResult {
  state: AppState
  lookupId: string
}

export interface SetLookupOutcomeInput {
  lookupId: string
  outcome: Exclude<LookupOutcome, 'unrated'>
}

export interface RuntimeStatus {
  definitionProvider: 'dictionary'
  aiAvailability: 'local' | 'text-only' | 'speech-only' | 'ready'
  configurationSource: 'none' | 'stored' | 'environment'
  secureStorageAvailable: boolean
  aiOnboardingDismissed: boolean
  aiConfigurationError: string | null
  textAiEnabled: boolean
  textAiProvider: TextAiProvider
  textAiBaseUrl: string | null
  textAiModel: string | null
  textCredentialSource: AiCredentialSource
  liveMimoEnabled: boolean
  credentialStatus: 'configured' | 'not-configured'
  mimoModel: string | null
  mimoBudgetLimitCny: number | null
  mimoEstimatedSpendCny: number | null
  sentenceAudioEnabled: boolean
  sentenceAudioModel: string | null
  sentenceAudioVoice: string | null
  sentenceAudioCredentialMode: SentenceAudioCredentialMode
  sentenceAudioCredentialSource: AiCredentialSource
  sentenceAudioGenerationCount: number | null
  sentenceAudioGenerationLimit: number | null
}

export type TextAiProvider = 'none' | 'mimo' | 'openai-compatible'

export type AiCredentialSource = 'none' | 'stored' | 'environment'

export type SentenceAudioCredentialMode = 'reuse-text' | 'separate'

export interface AiServiceSettingsUpdate {
  textProvider: TextAiProvider
  textBaseUrl: string
  textModel: string
  textApiKey?: string
  sentenceAudioEnabled: boolean
  sentenceAudioCredentialMode: SentenceAudioCredentialMode
  sentenceAudioApiKey?: string
}

export interface OriginEnglishApi {
  importMarkdown: () => Promise<Article | null>
  deleteArticle: (id: string) => Promise<AppState>
  importListening: () => Promise<ListeningItem | null>
  deleteListening: (id: string) => Promise<AppState>
  getListeningAudio: (id: string) => Promise<ListeningAudioResult>
  transcribeListening: (id: string) => Promise<AppState>
  loadState: () => Promise<AppState>
  setUiLanguage: (language: UiLanguage) => Promise<AppState>
  saveWord: (input: SaveWordInput) => Promise<AppState>
  deleteWord: (id: string) => Promise<AppState>
  defineWord: (input: DefinitionRequest) => Promise<DefinitionResult>
  refineDefinition: (input: DefinitionRequest) => Promise<DefinitionResult>
  getChineseHint: (input: ChineseHintRequest) => Promise<ChineseHintResult>
  getWordAudio: (word: string) => Promise<WordAudioResult>
  getSentenceAudio: (input: SentenceAudioRequest) => Promise<SentenceAudioResult>
  recordLookup: (input: RecordLookupInput) => Promise<RecordLookupResult>
  setLookupOutcome: (input: SetLookupOutcomeInput) => Promise<AppState>
  getRuntimeStatus: () => Promise<RuntimeStatus>
  configureAiServices: (input: AiServiceSettingsUpdate) => Promise<RuntimeStatus>
  disconnectAiServices: () => Promise<RuntimeStatus>
  dismissAiOnboarding: () => Promise<RuntimeStatus>
}
