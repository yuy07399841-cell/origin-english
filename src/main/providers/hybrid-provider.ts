import type { DefinitionRequest, DefinitionResult } from '../../shared/types'
import type { SimpleEnglishDictionary } from '../dictionary'
import type { LocalFirstChineseReferenceService } from '../chinese-reference'
import type { DefinitionProvider } from './definition-provider'

export class DictionaryFirstDefinitionProvider implements DefinitionProvider {
  constructor(
    private readonly dictionary: SimpleEnglishDictionary,
    private readonly chineseReference: LocalFirstChineseReferenceService
  ) {}

  async define(request: DefinitionRequest): Promise<DefinitionResult> {
    const local = await this.dictionary.define(request)
    const result: DefinitionResult = local ?? {
      word: request.word,
      partOfSpeech: '',
      definition: '',
      usage: '',
      contextualChineseHint: null,
      source: 'not-found',
      notice: 'This word is not in the local dictionary. Text AI was not called.',
      phonetic: null,
      hasAudio: false,
      hasAlternativeSenses: false,
      hasChineseReference: false,
      sourceUrl: null,
      senses: []
    }
    return {
      ...result,
      hasChineseReference: await this.chineseReference.hasLocal(request.word)
    }
  }
}
