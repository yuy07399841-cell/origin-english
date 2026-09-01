import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SimpleEnglishDictionary } from '../src/main/dictionary'
import { EcdictChineseDictionary } from '../src/main/chinese-dictionary'
import { LocalFirstChineseReferenceService } from '../src/main/chinese-reference'
import { DictionaryFirstDefinitionProvider } from '../src/main/providers/hybrid-provider'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

async function createDictionary(): Promise<SimpleEnglishDictionary> {
  const directory = await mkdtemp(join(tmpdir(), 'origin-dictionary-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'dictionary.json')
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: 1,
      source: 'Simple English Wiktionary',
      sourceUrl: 'https://simple.wiktionary.org/',
      license: 'CC BY-SA 4.0',
      entryCount: 3,
      entries: {
        notice: {
          h: 'notice',
          i: '/notice/',
          a: 'en-us-notice.ogg',
          s: [
            {
              p: 'verb',
              d: [
                { m: 'to become aware of something', e: 'I noticed the change.' },
                { m: 'to give attention to something' }
              ]
            },
            { p: 'noun', d: [{ m: 'a written warning or piece of information' }] }
          ]
        },
        noticing: { h: 'noticing', l: 'notice', q: 'verb', a: 'en-us-noticing.ogg' },
        notices: { h: 'notices', l: 'notice', q: 'verb' }
      }
    }),
    'utf8'
  )
  return new SimpleEnglishDictionary(path)
}

async function createChineseReference(
  dictionary: SimpleEnglishDictionary
): Promise<LocalFirstChineseReferenceService> {
  const directory = await mkdtemp(join(tmpdir(), 'origin-chinese-dictionary-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'chinese.data')
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: 1,
      source: 'ECDICT',
      sourceUrl: 'https://github.com/skywind3000/ECDICT',
      license: 'MIT',
      sourceSha256: 'test',
      targetHeadwordCount: 1,
      entryCount: 1,
      entries: { notice: 'v. 注意到；留意' }
    }),
    'utf8'
  )
  return new LocalFirstChineseReferenceService(
    dictionary,
    new EcdictChineseDictionary(path),
    null
  )
}

describe('local Simple English dictionary', () => {
  it('resolves an inflected word to a beginner definition without calling the fallback', async () => {
    const dictionary = await createDictionary()
    const chineseReference = await createChineseReference(dictionary)
    const fallback = { define: vi.fn() }
    const provider = new DictionaryFirstDefinitionProvider(
      dictionary,
      fallback,
      chineseReference
    )

    const result = await provider.define({
      word: 'noticing',
      sentence: 'I could not help noticing the change.'
    })

    expect(result).toMatchObject({
      word: 'noticing',
      partOfSpeech: 'verb',
      definition: 'to become aware of something',
      source: 'simple-wiktionary',
      hasAudio: true,
      hasAlternativeSenses: true,
      hasChineseReference: true
    })
    expect(fallback.define).not.toHaveBeenCalled()
  })

  it('uses the fallback only when the local dictionary has no entry', async () => {
    const dictionary = await createDictionary()
    const chineseReference = await createChineseReference(dictionary)
    const fallbackResult = {
      word: 'unlisted',
      partOfSpeech: 'word',
      definition: 'fallback meaning',
      usage: '',
      contextualChineseHint: null,
      source: 'preview' as const,
      notice: 'fallback',
      phonetic: null,
      hasAudio: false,
      hasAlternativeSenses: false,
      hasChineseReference: false,
      sourceUrl: null
    }
    const fallback = { define: vi.fn(async () => fallbackResult) }
    const provider = new DictionaryFirstDefinitionProvider(
      dictionary,
      fallback,
      chineseReference
    )
    await expect(
      provider.define({ word: 'unlisted', sentence: 'This word is unlisted.' })
    ).resolves.toEqual(fallbackResult)
    expect(fallback.define).toHaveBeenCalledOnce()
  })

  it('prefers an inflected recording and otherwise reports the headword recording', async () => {
    const dictionary = await createDictionary()

    await expect(dictionary.getAudioReference('noticing')).resolves.toEqual({
      fileName: 'en-us-noticing.ogg',
      sourceWord: 'noticing'
    })
    await expect(dictionary.getAudioReference('notices')).resolves.toEqual({
      fileName: 'en-us-notice.ogg',
      sourceWord: 'notice'
    })
  })
})
