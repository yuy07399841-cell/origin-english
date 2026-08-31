import { readFile } from 'node:fs/promises'
import type { ChineseHintResult } from '../shared/types'

interface EcdictFile {
  schemaVersion: 1
  source: 'ECDICT'
  sourceUrl: string
  license: 'MIT'
  sourceSha256: string
  targetHeadwordCount: number
  entryCount: number
  entries: Record<string, string>
}

export class EcdictChineseDictionary {
  private data: EcdictFile | null = null

  constructor(private readonly filePath: string) {}

  private async load(): Promise<EcdictFile> {
    if (this.data) return this.data
    const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<EcdictFile>
    if (
      parsed.schemaVersion !== 1 ||
      parsed.source !== 'ECDICT' ||
      typeof parsed.sourceUrl !== 'string' ||
      typeof parsed.entryCount !== 'number' ||
      !parsed.entries ||
      typeof parsed.entries !== 'object'
    ) {
      throw new Error('The local Chinese dictionary resource is invalid.')
    }
    this.data = parsed as EcdictFile
    return this.data
  }

  async get(word: string): Promise<ChineseHintResult | null> {
    const data = await this.load()
    const hint = data.entries[word.trim().toLocaleLowerCase('en-US')]
    if (!hint) return null
    return {
      hint,
      source: 'ecdict',
      sourceUrl: data.sourceUrl,
      contextual: false
    }
  }

  async has(word: string): Promise<boolean> {
    return (await this.get(word)) !== null
  }
}
