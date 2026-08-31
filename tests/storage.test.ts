import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalStore } from '../src/main/storage'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

async function createStore(): Promise<{ directory: string; path: string; store: LocalStore }> {
  const directory = await mkdtemp(join(tmpdir(), 'origin-english-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'state.json')
  return { directory, path, store: new LocalStore(path) }
}

describe('local state storage', () => {
  it('starts with a versioned empty state', async () => {
    const { store } = await createStore()
    await expect(store.read()).resolves.toEqual({
      schemaVersion: 4,
      uiLanguage: 'en',
      articles: [],
      listeningItems: [],
      savedWords: [],
      lookupEvents: []
    })
  })

  it('backs up and migrates version 1 data without changing learning records', async () => {
    const { directory, path, store } = await createStore()
    const versionOneState = {
      schemaVersion: 1,
      currentArticle: {
        id: 'article-1',
        title: 'A quiet article',
        fileName: 'quiet.md',
        markdown: '# A quiet article\n\nContext matters.',
        importedAt: '2026-08-29T00:00:00.000Z'
      },
      savedWords: [
        {
          id: 'word-1',
          word: 'context',
          sentence: 'Context matters.',
          partOfSpeech: 'noun',
          definition: 'the situation around an event or idea',
          usage: 'meaning from context',
          articleId: 'article-1',
          savedAt: '2026-08-29T00:01:00.000Z'
        }
      ],
      lookupEvents: [
        {
          id: 'lookup-1',
          word: 'context',
          sentence: 'Context matters.',
          articleId: 'article-1',
          outcome: 'helpful',
          createdAt: '2026-08-29T00:00:30.000Z'
        }
      ]
    }
    const originalContent = `${JSON.stringify(versionOneState, null, 2)}\n`
    await writeFile(path, originalContent, 'utf8')

    const migrated = await store.read()

    expect(migrated).toEqual({
      schemaVersion: 4,
      uiLanguage: 'en',
      articles: [versionOneState.currentArticle],
      listeningItems: [],
      savedWords: versionOneState.savedWords,
      lookupEvents: versionOneState.lookupEvents
    })
    expect(await readFile(`${path}.v1.backup`, 'utf8')).toBe(originalContent)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(migrated)
    expect((await readdir(directory)).sort()).toEqual(['state.json', 'state.json.v1.backup'])
  })

  it('backs up and migrates version 2 data into an article library', async () => {
    const { directory, path, store } = await createStore()
    const versionTwoState = {
      schemaVersion: 2,
      uiLanguage: 'zh',
      currentArticle: {
        id: 'article-2',
        title: 'A second article',
        fileName: 'second.md',
        markdown: '# A second article\n\nRead it slowly.',
        importedAt: '2026-08-30T00:00:00.000Z'
      },
      savedWords: [],
      lookupEvents: []
    }
    const originalContent = `${JSON.stringify(versionTwoState, null, 2)}\n`
    await writeFile(path, originalContent, 'utf8')

    const migrated = await store.read()

    expect(migrated).toEqual({
      schemaVersion: 4,
      uiLanguage: 'zh',
      articles: [versionTwoState.currentArticle],
      listeningItems: [],
      savedWords: [],
      lookupEvents: []
    })
    expect(await readFile(`${path}.v2.backup`, 'utf8')).toBe(originalContent)
    await expect(store.read()).resolves.toEqual(migrated)
    expect((await readdir(directory)).sort()).toEqual(['state.json', 'state.json.v2.backup'])
  })

  it('backs up and migrates version 3 data without changing the article library', async () => {
    const { directory, path, store } = await createStore()
    const versionThreeState = {
      schemaVersion: 3,
      uiLanguage: 'en',
      articles: [
        {
          id: 'article-3',
          title: 'Before listening',
          fileName: 'before-listening.md',
          markdown: '# Before listening',
          importedAt: '2026-08-30T00:00:00.000Z'
        }
      ],
      savedWords: [],
      lookupEvents: []
    }
    const originalContent = `${JSON.stringify(versionThreeState, null, 2)}\n`
    await writeFile(path, originalContent, 'utf8')

    const migrated = await store.read()

    expect(migrated).toEqual({
      ...versionThreeState,
      schemaVersion: 4,
      listeningItems: []
    })
    expect(await readFile(`${path}.v3.backup`, 'utf8')).toBe(originalContent)
    expect((await readdir(directory)).sort()).toEqual(['state.json', 'state.json.v3.backup'])
  })

  it('loads a valid version 4 listening transcript and rejects timing beyond its duration', async () => {
    const { path, store } = await createStore()
    const state = {
      schemaVersion: 4,
      uiLanguage: 'en',
      articles: [],
      listeningItems: [
        {
          id: 'abc123',
          title: 'A short sample',
          fileName: 'sample.wav',
          storedFileName: 'audio-abc123.wav',
          mimeType: 'audio/wav',
          bytes: 48,
          importedAt: '2026-08-30T13:00:00.000Z',
          transcript: {
            model: 'small.en',
            createdAt: '2026-08-30T13:01:00.000Z',
            durationMs: 2_000,
            sentences: [
              { id: 'sentence-1', text: 'A short sample.', startMs: 0, endMs: 1_900 }
            ]
          }
        }
      ],
      savedWords: [],
      lookupEvents: []
    }
    await writeFile(path, `${JSON.stringify(state)}\n`, 'utf8')
    await expect(store.read()).resolves.toEqual(state)

    state.listeningItems[0].transcript.sentences[0].endMs = 2_100
    await writeFile(path, `${JSON.stringify(state)}\n`, 'utf8')
    await expect(store.read()).rejects.toThrow('unsupported structure')
  })

  it('writes valid JSON and leaves no temporary file after replacement', async () => {
    const { directory, path, store } = await createStore()
    const updated = await store.update((current) => ({
      ...current,
      lookupEvents: [
        {
          id: 'lookup-1',
          word: 'context',
          sentence: 'Context makes meaning clearer.',
          articleId: null,
          outcome: 'helpful',
          createdAt: '2026-08-29T00:00:00.000Z'
        }
      ]
    }))

    expect(updated.lookupEvents).toHaveLength(1)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(updated)
    expect(await readdir(directory)).toEqual(['state.json'])
  })

  it('serializes concurrent updates instead of losing one', async () => {
    const { store } = await createStore()
    await Promise.all([
      store.update((current) => ({
        ...current,
        savedWords: [
          ...current.savedWords,
          {
            id: 'one',
            word: 'subtle',
            sentence: 'A subtle change matters.',
            partOfSpeech: 'adjective',
            definition: 'not immediately obvious',
            usage: 'a subtle change',
            articleId: null,
            savedAt: '2026-08-29T00:00:00.000Z'
          }
        ]
      })),
      store.update((current) => ({
        ...current,
        lookupEvents: [
          ...current.lookupEvents,
          {
            id: 'two',
            word: 'subtle',
            sentence: 'A subtle change matters.',
            articleId: null,
            outcome: 'unrated',
            createdAt: '2026-08-29T00:00:00.000Z'
          }
        ]
      }))
    ])

    const state = await store.read()
    expect(state.savedWords).toHaveLength(1)
    expect(state.lookupEvents).toHaveLength(1)
  })
})
