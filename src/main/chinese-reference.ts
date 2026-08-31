import type { ChineseHintRequest, ChineseHintResult } from '../shared/types'
import type { EcdictChineseDictionary } from './chinese-dictionary'
import type { SimpleEnglishDictionary } from './dictionary'

interface ChineseHintFallback {
  getChineseHint(request: ChineseHintRequest): Promise<ChineseHintResult>
}

export class LocalFirstChineseReferenceService {
  constructor(
    private readonly simpleDictionary: SimpleEnglishDictionary,
    private readonly chineseDictionary: EcdictChineseDictionary,
    private readonly fallback: ChineseHintFallback | null
  ) {}

  private async lookupWord(word: string): Promise<string> {
    return (await this.simpleDictionary.getHeadword(word)) ?? word
  }

  async hasLocal(word: string): Promise<boolean> {
    return this.chineseDictionary.has(await this.lookupWord(word))
  }

  async get(request: ChineseHintRequest): Promise<ChineseHintResult> {
    const local = await this.chineseDictionary.get(await this.lookupWord(request.word))
    if (local) return local
    if (this.fallback) return this.fallback.getChineseHint(request)
    throw new Error('No local Chinese reference is available for this word, and text AI is not configured.')
  }
}
