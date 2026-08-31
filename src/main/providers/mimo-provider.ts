import type {
  ChineseHintRequest,
  ChineseHintResult,
  DefinitionRequest,
  DefinitionResult
} from '../../shared/types'
import type { MiMoBudgetGuard, MiMoTokenUsage } from '../mimo-budget'
import type { DefinitionProvider } from './definition-provider'

const DEFAULT_BASE_URL = 'https://api.xiaomimimo.com/v1'
const DEFAULT_MODEL = 'mimo-v2.5'

interface MiMoProviderOptions {
  apiKey: string
  baseUrl?: string
  model?: string
  fetchImpl?: typeof fetch
  budgetGuard: MiMoBudgetGuard
}

function parseModelOutput(content: string, word: string): DefinitionResult {
  const normalized = content.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '')
  const parsed = JSON.parse(normalized) as Record<string, unknown>
  const partOfSpeech = parsed.partOfSpeech
  const definition = parsed.definition
  const usage = parsed.usage

  if (
    typeof partOfSpeech !== 'string' ||
    typeof definition !== 'string' ||
    typeof usage !== 'string' ||
    !partOfSpeech.trim() ||
    !definition.trim() ||
    !usage.trim()
  ) {
    throw new Error('MiMo returned an invalid definition payload.')
  }

  return {
    word,
    partOfSpeech: partOfSpeech.trim(),
    definition: definition.trim(),
    usage: usage.trim(),
    source: 'mimo',
    notice: 'Context sent: selected word and current sentence only',
    phonetic: null,
    hasAudio: false,
    hasAlternativeSenses: false,
    hasChineseReference: false,
    sourceUrl: null
  }
}

export class MiMoDefinitionProvider implements DefinitionProvider {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly model: string
  private readonly fetchImpl: typeof fetch
  private readonly budgetGuard: MiMoBudgetGuard

  constructor(options: MiMoProviderOptions) {
    if (!options.apiKey.trim()) {
      throw new Error('A MiMo API key is required.')
    }

    this.apiKey = options.apiKey
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.model = options.model ?? DEFAULT_MODEL
    this.fetchImpl = options.fetchImpl ?? fetch
    this.budgetGuard = options.budgetGuard
  }

  private async completeJson(
    systemPrompt: string,
    userContent: Record<string, string>,
    maxCompletionTokens: number
  ): Promise<Record<string, unknown>> {
    const reservation = await this.budgetGuard.reserve()
    let usage: MiMoTokenUsage | undefined
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: JSON.stringify(userContent)
            }
          ],
          max_completion_tokens: maxCompletionTokens,
          temperature: 0.2,
          stream: false,
          thinking: { type: 'disabled' }
        }),
        signal: AbortSignal.timeout(15_000)
      })

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }
      }
      if (
        typeof payload.usage?.prompt_tokens === 'number' &&
        typeof payload.usage?.completion_tokens === 'number'
      ) {
        usage = {
          promptTokens: payload.usage.prompt_tokens,
          completionTokens: payload.usage.completion_tokens
        }
      }

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('MiMo rejected the configured API key.')
        }
        if (response.status === 429) {
          throw new Error('MiMo is rate-limited or the account balance is unavailable.')
        }
        throw new Error(`MiMo request failed with status ${response.status}.`)
      }

      const content = payload.choices?.[0]?.message?.content
      if (typeof content !== 'string') {
        throw new Error('MiMo returned no definition content.')
      }
      const normalized = content.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '')
      return JSON.parse(normalized) as Record<string, unknown>
    } finally {
      await reservation.settle(usage)
    }
  }

  async define(request: DefinitionRequest): Promise<DefinitionResult> {
    const parsed = await this.completeJson(
      'Choose the exact sense of the selected English word in the sentence. Write for a beginning English learner. The definition must use common words and no more than 18 words. Return JSON only with non-empty string fields partOfSpeech, definition, and usage. Usage must be one short, natural example or pattern and must not repeat the definition.',
      { word: request.word, sentence: request.sentence },
      256
    )
    return parseModelOutput(JSON.stringify(parsed), request.word)
  }

  async getChineseHint(request: ChineseHintRequest): Promise<ChineseHintResult> {
    const parsed = await this.completeJson(
      'Give one very short Simplified Chinese meaning hint for the English word in this sentence. Do not translate the whole sentence. Return JSON only with one non-empty string field named hint.',
      {
        word: request.word,
        sentence: request.sentence,
        englishDefinition: request.definition
      },
      80
    )
    if (typeof parsed.hint !== 'string' || !parsed.hint.trim() || parsed.hint.length > 80) {
      throw new Error('MiMo returned an invalid Chinese hint.')
    }
    return {
      hint: parsed.hint.trim(),
      source: 'mimo',
      sourceUrl: null,
      contextual: true
    }
  }
}
