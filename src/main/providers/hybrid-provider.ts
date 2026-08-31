import type { DefinitionRequest, DefinitionResult } from '../../shared/types'
import type { SimpleEnglishDictionary } from '../dictionary'
import type { LocalFirstChineseReferenceService } from '../chinese-reference'
import type { DefinitionProvider } from './definition-provider'

export class DictionaryFirstDefinitionProvider implements DefinitionProvider {
  constructor(
    private readonly dictionary: SimpleEnglishDictionary,
    private readonly fallback: DefinitionProvider,
    private readonly chineseReference: LocalFirstChineseReferenceService
  ) {}

  async define(request: DefinitionRequest): Promise<DefinitionResult> {
    const result = (await this.dictionary.define(request)) ?? (await this.fallback.define(request))
    return {
      ...result,
      hasChineseReference: await this.chineseReference.hasLocal(request.word)
    }
  }
}
