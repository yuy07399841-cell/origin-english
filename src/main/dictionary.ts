import { readFile } from 'node:fs/promises'
import type { DefinitionRequest, DefinitionResult } from '../shared/types'

interface CompactSense {
  m: string
  e?: string
}

interface CompactSection {
  p: string
  d: CompactSense[]
}

interface CompactEntry {
  h: string
  i?: string
  a?: string
  l?: string
  q?: string
  s?: CompactSection[]
}

interface DictionaryFile {
  schemaVersion: 1
  source: string
  sourceUrl: string
  license: string
  entryCount: number
  entries: Record<string, CompactEntry>
}

export interface DictionaryAudioReference {
  fileName: string
  sourceWord: string
}

function simpleWiktionaryUrl(word: string): string {
  return `https://simple.wiktionary.org/wiki/${encodeURIComponent(word.replace(/ /g, '_'))}`
}

export class SimpleEnglishDictionary {
  private data: DictionaryFile | null = null

  constructor(private readonly filePath: string) {}

  private async load(): Promise<DictionaryFile> {
    if (this.data) return this.data
    const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<DictionaryFile>
    if (
      parsed.schemaVersion !== 1 ||
      typeof parsed.source !== 'string' ||
      typeof parsed.entryCount !== 'number' ||
      !parsed.entries ||
      typeof parsed.entries !== 'object'
    ) {
      throw new Error('The local dictionary resource is invalid.')
    }
    this.data = parsed as DictionaryFile
    return this.data
  }

  private resolveEntry(
    entries: Record<string, CompactEntry>,
    word: string
  ): { displayEntry: CompactEntry; definitionEntry: CompactEntry } | null {
    const displayEntry = entries[word.toLowerCase()]
    if (!displayEntry) return null
    if (displayEntry.s?.some((section) => section.d.length)) {
      return { displayEntry, definitionEntry: displayEntry }
    }
    const lemma = displayEntry.l ? entries[displayEntry.l.toLowerCase()] : null
    if (!lemma?.s?.some((section) => section.d.length)) return null
    return { displayEntry, definitionEntry: lemma }
  }

  async define(request: DefinitionRequest): Promise<DefinitionResult | null> {
    const { entries } = await this.load()
    const resolved = this.resolveEntry(entries, request.word)
    if (!resolved) return null

    const { displayEntry, definitionEntry } = resolved
    const preferredPartOfSpeech = displayEntry.q
    const matchingSections = preferredPartOfSpeech
      ? definitionEntry.s?.filter((section) => section.p === preferredPartOfSpeech)
      : definitionEntry.s
    const sections = matchingSections?.length ? matchingSections : definitionEntry.s ?? []
    const senses = sections.flatMap((section) =>
      section.d.map((sense) => ({ ...sense, partOfSpeech: section.p }))
    )
    const primary = senses[0]
    if (!primary) return null

    return {
      word: request.word,
      partOfSpeech: primary.partOfSpeech,
      definition: primary.m,
      usage: primary.e ?? '',
      source: 'simple-wiktionary',
      notice: 'Local dictionary · MiMo was not called',
      phonetic: displayEntry.i ?? definitionEntry.i ?? null,
      hasAudio: Boolean(displayEntry.a ?? definitionEntry.a),
      hasAlternativeSenses: senses.length > 1,
      hasChineseReference: false,
      sourceUrl: simpleWiktionaryUrl(definitionEntry.h)
    }
  }

  async getHeadword(word: string): Promise<string | null> {
    const { entries } = await this.load()
    const resolved = this.resolveEntry(entries, word)
    return resolved?.definitionEntry.h ?? null
  }

  async getAudioReference(word: string): Promise<DictionaryAudioReference | null> {
    const { entries } = await this.load()
    const resolved = this.resolveEntry(entries, word)
    if (!resolved) return null
    const audioEntry = resolved.displayEntry.a ? resolved.displayEntry : resolved.definitionEntry
    if (!audioEntry.a) return null
    return { fileName: audioEntry.a, sourceWord: audioEntry.h }
  }
}
