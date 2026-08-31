import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EcdictChineseDictionary } from '../src/main/chinese-dictionary'
import { LocalFirstChineseReferenceService } from '../src/main/chinese-reference'
import { SimpleEnglishDictionary } from '../src/main/dictionary'
import type { ChineseHintRequest, ChineseHintResult } from '../src/shared/types'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

type ChineseHintFallback = {
  getChineseHint(request: ChineseHintRequest): Promise<ChineseHintResult>
}

async function createService(
  fallback: ChineseHintFallback | null = null
): Promise<LocalFirstChineseReferenceService> {
  const directory = await mkdtemp(join(tmpdir(), 'origin-chinese-reference-'))
  temporaryDirectories.push(directory)
  const simplePath = join(directory, 'simple.data')
  const chinesePath = join(directory, 'chinese.data')
  await Promise.all([
    writeFile(
      simplePath,
      JSON.stringify({
        schemaVersion: 1,
        source: 'Simple English Wiktionary',
        sourceUrl: 'https://simple.wiktionary.org/',
        license: 'CC BY-SA 4.0',
        entryCount: 2,
        entries: {
          notice: {
            h: 'notice',
            s: [{ p: 'verb', d: [{ m: 'to become aware of something' }] }]
          },
          noticing: { h: 'noticing', l: 'notice', q: 'verb' }
        }
      }),
      'utf8'
    ),
    writeFile(
      chinesePath,
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
  ])
  return new LocalFirstChineseReferenceService(
    new SimpleEnglishDictionary(simplePath),
    new EcdictChineseDictionary(chinesePath),
    fallback
  )
}

describe('local-first Chinese reference', () => {
  it('resolves an inflected word to its local ECDICT headword without using MiMo', async () => {
    const fallback = {
      getChineseHint: vi.fn(async () => ({
        hint: '模型提示',
        source: 'mimo' as const,
        sourceUrl: null,
        contextual: true
      }))
    }
    const service = await createService(fallback)

    await expect(
      service.get({
        word: 'noticing',
        sentence: 'I noticed the change.',
        definition: 'to become aware of something'
      })
    ).resolves.toEqual({
      hint: 'v. 注意到；留意',
      source: 'ecdict',
      sourceUrl: 'https://github.com/skywind3000/ECDICT',
      contextual: false
    })
    expect(fallback.getChineseHint).not.toHaveBeenCalled()
    await expect(service.hasLocal('noticing')).resolves.toBe(true)
  })

  it('uses MiMo only after an explicit request has no local Chinese reference', async () => {
    const fallback = {
      getChineseHint: vi.fn(async () => ({
        hint: '当前语境提示',
        source: 'mimo' as const,
        sourceUrl: null,
        contextual: true
      }))
    }
    const service = await createService(fallback)
    const request = {
      word: 'unlisted',
      sentence: 'This word is unlisted.',
      definition: 'not listed'
    }

    await expect(service.get(request)).resolves.toMatchObject({
      hint: '当前语境提示',
      source: 'mimo',
      contextual: true
    })
    expect(fallback.getChineseHint).toHaveBeenCalledOnce()
  })

  it('fails clearly when neither local Chinese nor MiMo is available', async () => {
    const service = await createService()
    await expect(
      service.get({
        word: 'unlisted',
        sentence: 'This word is unlisted.',
        definition: 'not listed'
      })
    ).rejects.toThrow('No local Chinese reference')
  })
})
