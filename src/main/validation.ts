import type {
  ChineseHintRequest,
  DefinitionRequest,
  RecordLookupInput,
  SaveWordInput,
  SentenceAudioRequest,
  SetLookupOutcomeInput,
  UiLanguage
} from '../shared/types'

const WORD_PATTERN = /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/

function requireText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} is required.`)
  }
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${label} must contain between 1 and ${maxLength} characters.`)
  }
  return normalized
}

export function normalizeWord(value: unknown): string {
  const word = requireText(value, 'Word', 80)
  if (!WORD_PATTERN.test(word)) {
    throw new Error('Select one English word at a time.')
  }
  return word
}

export function validateDefinitionRequest(value: unknown): DefinitionRequest {
  if (!value || typeof value !== 'object') {
    throw new Error('A definition request is required.')
  }
  const input = value as Partial<DefinitionRequest>
  return {
    word: normalizeWord(input.word),
    sentence: requireText(input.sentence, 'Sentence', 1_000)
  }
}

export function validateChineseHintRequest(value: unknown): ChineseHintRequest {
  const definitionRequest = validateDefinitionRequest(value)
  const input = value as Partial<ChineseHintRequest>
  return {
    ...definitionRequest,
    definition: requireText(input.definition, 'Definition', 1_200)
  }
}

export function validateSentenceAudioRequest(value: unknown): SentenceAudioRequest {
  if (!value || typeof value !== 'object') {
    throw new Error('A sentence audio request is required.')
  }
  const input = value as Partial<SentenceAudioRequest>
  const sentence = requireText(input.sentence, 'Sentence', 1_000).replace(/\s+/g, ' ')
  if (!/[A-Za-z]/.test(sentence)) {
    throw new Error('Sentence audio requires readable English text.')
  }
  return { sentence }
}

export function validateSaveWordInput(value: unknown): SaveWordInput {
  if (!value || typeof value !== 'object') {
    throw new Error('A saved word is required.')
  }
  const input = value as Partial<SaveWordInput>
  return {
    word: normalizeWord(input.word),
    sentence: requireText(input.sentence, 'Sentence', 1_000),
    partOfSpeech: requireText(input.partOfSpeech, 'Part of speech', 80),
    definition: requireText(input.definition, 'Definition', 1_200),
    usage:
      typeof input.usage === 'string' && input.usage.trim().length <= 1_200
        ? input.usage.trim()
        : requireText(input.usage, 'Usage', 1_200),
    articleId:
      input.articleId === null ? null : requireText(input.articleId, 'Article id', 100)
  }
}

export function validateRecordLookupInput(value: unknown): RecordLookupInput {
  if (!value || typeof value !== 'object') {
    throw new Error('A lookup record is required.')
  }
  const input = value as Partial<RecordLookupInput>
  return {
    word: normalizeWord(input.word),
    sentence: requireText(input.sentence, 'Sentence', 1_000),
    articleId:
      input.articleId === null ? null : requireText(input.articleId, 'Article id', 100)
  }
}

export function validateSetLookupOutcomeInput(value: unknown): SetLookupOutcomeInput {
  if (!value || typeof value !== 'object') {
    throw new Error('A lookup outcome is required.')
  }
  const input = value as Partial<SetLookupOutcomeInput>
  const outcome = input.outcome
  if (outcome !== 'helpful' && outcome !== 'external-needed') {
    throw new Error('Lookup outcome is invalid.')
  }
  return {
    lookupId: requireText(input.lookupId, 'Lookup id', 100),
    outcome
  }
}

export function validateId(value: unknown): string {
  const id = requireText(value, 'Id', 100)
  if (!/^[A-Za-z0-9-]+$/.test(id)) {
    throw new Error('Id contains unsupported characters.')
  }
  return id
}

export function validateUiLanguage(value: unknown): UiLanguage {
  if (value !== 'zh' && value !== 'en') {
    throw new Error('Interface language is invalid.')
  }
  return value
}
