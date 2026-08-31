import { join } from 'node:path'
import type {
  ChineseHintRequest,
  ChineseHintResult,
  DefinitionRequest,
  DefinitionResult,
  RuntimeStatus,
  SentenceAudioResult
} from '../shared/types'
import type { EcdictChineseDictionary } from './chinese-dictionary'
import { LocalFirstChineseReferenceService } from './chinese-reference'
import type { SimpleEnglishDictionary } from './dictionary'
import {
  AiServiceConfigStore,
  createDisabledAiServiceConfig,
  type ResolvedAiServiceConfig
} from './ai-service-config'
import { MiMoBudgetGuard } from './mimo-budget'
import type { DefinitionProvider } from './providers/definition-provider'
import { DictionaryFirstDefinitionProvider } from './providers/hybrid-provider'
import { MiMoDefinitionProvider } from './providers/mimo-provider'
import { OpenAiCompatibleDefinitionProvider } from './providers/openai-compatible-provider'
import { PreviewDefinitionProvider } from './providers/preview-provider'
import {
  MiMoSentenceAudioService,
  MIMO_TTS_GENERATION_LIMIT,
  MIMO_TTS_MODEL,
  MIMO_TTS_VOICE
} from './sentence-audio'

const MIMO_BUDGET_LIMIT_CNY = 5

interface ContextualDefinitionProvider extends DefinitionProvider {
  getChineseHint(request: ChineseHintRequest): Promise<ChineseHintResult>
}

interface AiServiceManagerOptions {
  configStore: AiServiceConfigStore
  dataDirectory: string
  dictionary: SimpleEnglishDictionary
  chineseDictionary: EcdictChineseDictionary
  environment?: Record<string, string | undefined>
  fetchImpl?: typeof fetch
}

export class AiServiceManager {
  private readonly configStore: AiServiceConfigStore
  private readonly dataDirectory: string
  private readonly dictionary: SimpleEnglishDictionary
  private readonly chineseDictionary: EcdictChineseDictionary
  private readonly environment: Record<string, string | undefined>
  private readonly fetchImpl: typeof fetch | undefined
  private config = createDisabledAiServiceConfig()
  private configurationError: string | null = null
  private definitionProvider: DefinitionProvider = new PreviewDefinitionProvider()
  private contextualProvider: ContextualDefinitionProvider | null = null
  private chineseReferenceService: LocalFirstChineseReferenceService
  private sentenceAudioService: MiMoSentenceAudioService | null = null
  private mimoBudgetGuard: MiMoBudgetGuard | null = null

  constructor(options: AiServiceManagerOptions) {
    this.configStore = options.configStore
    this.dataDirectory = options.dataDirectory
    this.dictionary = options.dictionary
    this.chineseDictionary = options.chineseDictionary
    this.environment = options.environment ?? process.env
    this.fetchImpl = options.fetchImpl
    this.chineseReferenceService = new LocalFirstChineseReferenceService(
      this.dictionary,
      this.chineseDictionary,
      null
    )
    this.definitionProvider = new DictionaryFirstDefinitionProvider(
      this.dictionary,
      new PreviewDefinitionProvider(),
      this.chineseReferenceService
    )
  }

  async initialize(): Promise<void> {
    try {
      this.apply(await this.configStore.read(this.environment))
      this.configurationError = null
    } catch (error) {
      this.apply(createDisabledAiServiceConfig(false, 'stored'))
      this.configurationError =
        error instanceof Error ? error.message : 'AI service settings could not be opened.'
    }
  }

  private apply(config: ResolvedAiServiceConfig): void {
    let contextualProvider: ContextualDefinitionProvider | null = null
    let fallbackProvider: DefinitionProvider = new PreviewDefinitionProvider()
    let mimoBudgetGuard: MiMoBudgetGuard | null = null

    if (config.textProvider === 'mimo' && config.textApiKey) {
      mimoBudgetGuard = new MiMoBudgetGuard(
        join(this.dataDirectory, 'mimo-usage.json'),
        MIMO_BUDGET_LIMIT_CNY
      )
      contextualProvider = new MiMoDefinitionProvider({
        apiKey: config.textApiKey,
        model: config.textModel ?? undefined,
        fetchImpl: this.fetchImpl,
        budgetGuard: mimoBudgetGuard
      })
      fallbackProvider = contextualProvider
    } else if (
      config.textProvider === 'openai-compatible' &&
      config.textApiKey &&
      config.textBaseUrl &&
      config.textModel
    ) {
      contextualProvider = new OpenAiCompatibleDefinitionProvider({
        apiKey: config.textApiKey,
        baseUrl: config.textBaseUrl,
        model: config.textModel,
        fetchImpl: this.fetchImpl
      })
      fallbackProvider = contextualProvider
    }

    const chineseReferenceService = new LocalFirstChineseReferenceService(
      this.dictionary,
      this.chineseDictionary,
      contextualProvider
    )
    const definitionProvider = new DictionaryFirstDefinitionProvider(
      this.dictionary,
      fallbackProvider,
      chineseReferenceService
    )
    const sentenceAudioService =
      config.sentenceAudioEnabled && config.sentenceAudioApiKey
        ? new MiMoSentenceAudioService({
            apiKey: config.sentenceAudioApiKey,
            cacheDirectory: join(this.dataDirectory, 'sentence-audio-cache'),
            usageFilePath: join(this.dataDirectory, 'mimo-tts-usage.json'),
            fetchImpl: this.fetchImpl
          })
        : null

    this.config = config
    this.contextualProvider = contextualProvider
    this.chineseReferenceService = chineseReferenceService
    this.definitionProvider = definitionProvider
    this.sentenceAudioService = sentenceAudioService
    this.mimoBudgetGuard = mimoBudgetGuard
  }

  async configure(input: unknown): Promise<RuntimeStatus> {
    const config = await this.configStore.update(input, this.environment)
    this.apply(config)
    this.configurationError = null
    return this.status()
  }

  async disconnectAll(): Promise<RuntimeStatus> {
    this.apply(await this.configStore.disconnectAll())
    this.configurationError = null
    return this.status()
  }

  async dismissOnboarding(): Promise<RuntimeStatus> {
    this.apply(await this.configStore.dismissOnboarding(this.environment))
    this.configurationError = null
    return this.status()
  }

  define(request: DefinitionRequest): Promise<DefinitionResult> {
    return this.definitionProvider.define(request)
  }

  async refine(request: DefinitionRequest): Promise<DefinitionResult> {
    if (!this.contextualProvider) {
      throw new Error('Text AI is not configured for contextual refinement.')
    }
    const refined = await this.contextualProvider.define(request)
    return {
      ...refined,
      hasChineseReference: await this.chineseReferenceService.hasLocal(request.word)
    }
  }

  getChineseHint(request: ChineseHintRequest): Promise<ChineseHintResult> {
    return this.chineseReferenceService.get(request)
  }

  getSentenceAudio(sentence: string): Promise<SentenceAudioResult> {
    if (!this.sentenceAudioService) {
      throw new Error('MiMo natural sentence audio is not configured.')
    }
    return this.sentenceAudioService.get(sentence)
  }

  async status(): Promise<RuntimeStatus> {
    const budgetStatus = this.mimoBudgetGuard ? await this.mimoBudgetGuard.status() : null
    const sentenceAudioStatus = this.sentenceAudioService
      ? await this.sentenceAudioService.status()
      : null
    const textAiEnabled = this.contextualProvider !== null
    const sentenceAudioEnabled = this.sentenceAudioService !== null
    const aiAvailability = textAiEnabled
      ? sentenceAudioEnabled
        ? 'ready'
        : 'text-only'
      : sentenceAudioEnabled
        ? 'speech-only'
        : 'local'

    return {
      definitionProvider: 'dictionary',
      aiAvailability,
      configurationSource: this.config.configurationSource,
      secureStorageAvailable: this.configStore.isSecureStorageAvailable(),
      aiOnboardingDismissed: this.config.onboardingDismissed,
      aiConfigurationError: this.configurationError,
      textAiEnabled,
      textAiProvider: textAiEnabled ? this.config.textProvider : 'none',
      textAiBaseUrl: textAiEnabled ? this.config.textBaseUrl : null,
      textAiModel: textAiEnabled ? this.config.textModel : null,
      textCredentialSource: textAiEnabled ? this.config.textCredentialSource : 'none',
      liveMimoEnabled: textAiEnabled && this.config.textProvider === 'mimo',
      credentialStatus: textAiEnabled || sentenceAudioEnabled ? 'configured' : 'not-configured',
      mimoModel:
        textAiEnabled && this.config.textProvider === 'mimo' ? this.config.textModel : null,
      mimoBudgetLimitCny: budgetStatus?.limitCny ?? null,
      mimoEstimatedSpendCny: budgetStatus?.estimatedCostCny ?? null,
      sentenceAudioEnabled,
      sentenceAudioModel: sentenceAudioEnabled ? MIMO_TTS_MODEL : null,
      sentenceAudioVoice: sentenceAudioEnabled ? MIMO_TTS_VOICE : null,
      sentenceAudioCredentialMode: sentenceAudioEnabled
        ? this.config.sentenceAudioCredentialMode
        : 'separate',
      sentenceAudioCredentialSource: sentenceAudioEnabled
        ? this.config.sentenceAudioCredentialSource
        : 'none',
      sentenceAudioGenerationCount: sentenceAudioStatus?.generationCount ?? null,
      sentenceAudioGenerationLimit:
        sentenceAudioStatus?.generationLimit ??
        (sentenceAudioEnabled ? MIMO_TTS_GENERATION_LIMIT : null)
    }
  }
}
