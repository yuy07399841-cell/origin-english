import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SimpleEnglishDictionary } from '../src/main/dictionary'
import { WikimediaWordAudioService } from '../src/main/word-audio'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

describe('Wikimedia word audio', () => {
  it('downloads attributed audio once and then reuses the local cache', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-audio-'))
    temporaryDirectories.push(directory)
    const dictionaryPath = join(directory, 'dictionary.json')
    await writeFile(
      dictionaryPath,
      JSON.stringify({
        schemaVersion: 1,
        source: 'Simple English Wiktionary',
        sourceUrl: 'https://simple.wiktionary.org/',
        license: 'CC BY-SA 4.0',
        entryCount: 1,
        entries: {
          subtle: {
            h: 'subtle',
            a: 'en-us-subtle.ogg',
            s: [{ p: 'adjective', d: [{ m: 'not easy to notice' }] }]
          }
        }
      }),
      'utf8'
    )
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            query: {
              pages: {
                '1': {
                  imageinfo: [
                    {
                      url: 'https://upload.wikimedia.org/test/subtle.ogg',
                      descriptionurl: 'https://commons.wikimedia.org/wiki/File:en-us-subtle.ogg',
                      mime: 'audio/ogg',
                      extmetadata: {
                        LicenseShortName: { value: 'CC BY 4.0' },
                        Artist: { value: '<b>Example speaker</b>' }
                      }
                    }
                  ]
                }
              }
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(Uint8Array.from([79, 103, 103, 83]), {
          status: 200,
          headers: { 'Content-Type': 'audio/ogg', 'Content-Length': '4' }
        })
      )
    const service = new WikimediaWordAudioService(
      new SimpleEnglishDictionary(dictionaryPath),
      join(directory, 'cache'),
      fetchMock as typeof fetch
    )

    const first = await service.get('subtle')
    const second = await service.get('subtle')
    expect(first).toMatchObject({
      license: 'CC BY 4.0',
      artist: 'Example speaker',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:en-us-subtle.ogg',
      sourceWord: 'subtle'
    })
    expect(first.dataUrl).toMatch(/^data:audio\/ogg;base64,/)
    expect(second).toEqual(first)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
