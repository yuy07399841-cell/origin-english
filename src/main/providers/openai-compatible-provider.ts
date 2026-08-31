import type {
  ChineseHintRequest,
  ChineseHintResult,
  DefinitionRequest,
  DefinitionResult
} from '../../shared/types'
import { normalizeOpenAiCompatibleBaseUrl } from '../ai-service-config'
import type { DefinitionProvider } from './definition-provider'

const MAX_RESPONSE_BYTES = 512 * 1024

interface OpenAiCompatibleProviderOptions {
  apiKey: string
  baseUrl: string
  model: string
  fetchImpl?: typeof fetch
}

function requireModelOutputString(
  value: unknown,
  label: string,
  maxLength: number
): string {
  if (typeof value !== 'string') throw new Error(`The text AI returned an invalid ${label}.`)
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`The text AI returned an invalid ${label}.`)
  }
  return normalized
}

function parseJsonContent(content: string): Record<string, unknown> {
  const normalized = content.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '')
  try {
    const parsed: unknown = JSON.parse(normalized)
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid')
    return parsed as Record<string, unknown>
  } catch {
    throw new Error('The text AI returned content that could not be read.')
  }
}

async function readResponsePayload(response: Response): Promise<{
  choices?: Array<{ message?: { content?: unknown } }>
}> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error('The text AI response was too large.')
  }
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new Error('The text AI response was too large.')
  }
  try {
    return JSON.parse(text) as { choices?: Array<{ message?: { content?: unknown } }> }
  } catch {
    throw new Error('The text AI returned an unreadable response.')
  }
}

export class OpenAiCompatibleDefinitionProvider implements DefinitionProvider {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly model: string
  private readonly fetchImpl: typeof fetch

  constructor(options: OpenAiCompatibleProviderOptions) {
    const apiKey = options.apiKey.trim()
    const model = options.model.trim()
    if (!apiKey) throw new Error('An API key is required for the custom text AI provider.')
    if (!model || model.length > 200) throw new Error('A valid model name is required.')
    this.apiKey = apiKey
    this.baseUrl = normalizeOpenAiCompatibleBaseUrl(options.baseUrl)
    this.model = model
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  private async completeJson(
    systemPrompt: string,
    userContent: Record<string, string>,
    maxTokens: number
  ): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(userContent) }
        ],
        max_tokens: maxTokens,
        temperature: 0.2,
        stream: false
      }),
      signal: AbortSignal.timeout(15_000)
    })
    const payload = await readResponsePayload(response)
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('The custom text AI provider rejected the configured API key.')
      }
      if (response.status === 429) {
        throw new Error('The custom text AI provider is rate-limited or has no available balance.')
      }
      throw new Error(`The custom text AI request failed with status ${response.status}.`)
    }
    const content = payload.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Error('The text AI returned no usable content.')
    return parseJsonContent(content)
  }

  async define(request: DefinitionRequest): Promise<DefinitionResult> {
    const parsed = await this.completeJson(
      'Choose the exact sense of the selected English word in the sentence. Write for a beginning English learner. The definition must use common words and no more than 18 words. Return JSON only with non-empty string fields partOfSpeech, definition, and usage. Usage must be one short, natural example or pattern and must not repeat the definition.',
      { word: request.word, sentence: request.sentence },
      256
    )
    return {
      word: request.word,
      partOfSpeech: requireModelOutputString(parsed.partOfSpeech, 'part of speech', 80),
      definition: requireModelOutputString(parsed.definition, 'definition', 1_200),
      usage: requireModelOutputString(parsed.usage, 'usage', 1_200),
      source: 'openai-compatible',
      notice: 'Context sent: selected word and current sentence only',
      phonetic: null,
      hasAudio: false,
      hasAlternativeSenses: false,
      hasChineseReference: false,
      sourceUrl: null
    }
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
    return {
      hint: requireModelOutputString(parsed.hint, 'Chinese hint', 80),
      source: 'openai-compatible',
      sourceUrl: null,
      contextual: true
    }
  }
}
