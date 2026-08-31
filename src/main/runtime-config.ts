import {
  MIMO_TTS_GENERATION_LIMIT,
  MIMO_TTS_MODEL,
  MIMO_TTS_VOICE
} from './sentence-audio'

export const MIMO_MODEL = 'mimo-v2.5'
export const MIMO_BUDGET_LIMIT_CNY = 5

type RuntimeEnvironment = Record<string, string | undefined>

export function createRuntimeConfig(environment: RuntimeEnvironment = process.env): {
  definitionProvider: 'dictionary'
  liveMimoEnabled: boolean
  credentialStatus: 'configured' | 'not-configured'
  mimoModel: string | null
  mimoBudgetLimitCny: number | null
  sentenceAudioEnabled: boolean
  sentenceAudioModel: string | null
  sentenceAudioVoice: string | null
  sentenceAudioGenerationLimit: number | null
} {
  const hasCredential = Boolean(environment.MIMO_API_KEY?.trim())
  return Object.freeze({
    definitionProvider: 'dictionary',
    liveMimoEnabled: hasCredential,
    credentialStatus: hasCredential ? 'configured' : 'not-configured',
    mimoModel: hasCredential ? MIMO_MODEL : null,
    mimoBudgetLimitCny: hasCredential ? MIMO_BUDGET_LIMIT_CNY : null,
    sentenceAudioEnabled: hasCredential,
    sentenceAudioModel: hasCredential ? MIMO_TTS_MODEL : null,
    sentenceAudioVoice: hasCredential ? MIMO_TTS_VOICE : null,
    sentenceAudioGenerationLimit: hasCredential ? MIMO_TTS_GENERATION_LIMIT : null
  })
}

export const runtimeConfig = createRuntimeConfig()
