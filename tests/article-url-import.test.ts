import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteArticleWithAssets, importArticleFromUrl } from '../src/main/article-url-import'
import { LocalStore } from '../src/main/storage'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('article URL import', () => {
  it('saves readable article structure and source, then reopens it from local state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-article-url-'))
    temporaryDirectories.push(directory)
    const store = new LocalStore(join(directory, 'state.json'))
    const fetchMock = vi.fn(async () => new Response(`<!doctype html><html><head>
      <title>Ignored browser title</title></head><body><nav>Navigation noise</nav>
      <article><h1>A careful reading</h1><p>Context makes meaning clearer.</p>
      <h2>What to notice</h2><ul><li>Keep the source.</li><li>Read offline.</li></ul></article>
      <section class="comments">Comment noise</section></body></html>`, {
        headers: { 'content-type': 'text/html; charset=utf-8' }
      })) as typeof fetch

    const imported = await importArticleFromUrl(
      'https://example.com/reading/story',
      store,
      join(directory, 'article-assets'),
      {
        fetchImpl: fetchMock,
        resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
        id: 'article-url-1',
        importedAt: '2026-09-15T10:00:00.000Z'
      }
    )

    expect(imported.article).toMatchObject({
      id: 'article-url-1',
      title: 'A careful reading',
      sourceUrl: 'https://example.com/reading/story'
    })
    expect(imported.article.markdown).toContain('# A careful reading')
    expect(imported.article.markdown).toContain('## What to notice')
    expect(imported.article.markdown).toMatch(/\*\s+Keep the source\./)
    expect(imported.article.markdown).not.toContain('Navigation noise')
    expect(imported.article.markdown).not.toContain('Comment noise')
    await expect(store.read()).resolves.toMatchObject({
      articles: [{ id: 'article-url-1', sourceUrl: 'https://example.com/reading/story' }]
    })
    expect(JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).articles).toHaveLength(1)
  })

  it('rejects private destinations before fetch and never saves an empty article', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-article-url-'))
    temporaryDirectories.push(directory)
    const store = new LocalStore(join(directory, 'state.json'))
    const fetchMock = vi.fn() as typeof fetch

    await expect(importArticleFromUrl('http://localhost/story', store, join(directory, 'assets'), {
      fetchImpl: fetchMock,
      resolveHost: async () => [{ address: '127.0.0.1', family: 4 }]
    })).rejects.toThrow(/private|local/i)
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(store.read()).resolves.toMatchObject({ articles: [] })
  })

  it('blocks a redirect to a private address and enforces the HTML size limit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-article-url-'))
    temporaryDirectories.push(directory)
    const store = new LocalStore(join(directory, 'state.json'))
    const redirectFetch = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/private' }
    })) as typeof fetch
    await expect(importArticleFromUrl('https://example.com/story', store, join(directory, 'assets'), {
      fetchImpl: redirectFetch,
      resolveHost: async () => [{ address: '93.184.216.34', family: 4 }]
    })).rejects.toThrow(/private network/i)
    expect(redirectFetch).toHaveBeenCalledOnce()

    await expect(importArticleFromUrl('https://example.com/large', store, join(directory, 'assets'), {
      fetchImpl: (async () => new Response('small', {
        headers: { 'content-type': 'text/html', 'content-length': String(5 * 1024 * 1024 + 1) }
      })) as typeof fetch,
      resolveHost: async () => [{ address: '93.184.216.34', family: 4 }]
    })).rejects.toThrow(/byte limit/i)
    await expect(store.read()).resolves.toMatchObject({ articles: [] })
  })

  it('stores readable-body images locally and reports an individual image failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-article-url-'))
    temporaryDirectories.push(directory)
    const store = new LocalStore(join(directory, 'state.json'))
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/story')) return new Response(
        '<article><h1>Images in context</h1><p>A useful diagram follows and explains the full idea in a memorable way.</p>' +
        '<img src="/good.png" alt="Useful diagram"><img src="/missing.png" alt="Missing"></article>',
        { headers: { 'content-type': 'text/html' } }
      )
      if (url.endsWith('/good.png')) return new Response(image, { headers: { 'content-type': 'image/png' } })
      return new Response('missing', { status: 404, headers: { 'content-type': 'text/plain' } })
    }) as typeof fetch

    const result = await importArticleFromUrl('https://example.com/story', store, join(directory, 'assets'), {
      fetchImpl: fetchMock,
      resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
      id: 'article-images'
    })

    expect(result.article.assets).toEqual([{ storedFileName: 'image-1.png', mimeType: 'image/png', bytes: image.length }])
    expect(await readFile(join(directory, 'assets', 'article-images', 'image-1.png'))).toEqual(image)
    expect(result.article.markdown).toContain('origin-asset://article-images/image-1.png')
    expect(result.article.markdown).not.toContain('missing.png')
    expect(result.warnings).toEqual(['1 article image could not be saved for offline reading.'])
  })

  it('keeps the readable article when one image URL is malformed and ignores unrelated page assets', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-article-url-'))
    temporaryDirectories.push(directory)
    const store = new LocalStore(join(directory, 'state.json'))
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/story')) return new Response(
        '<header><img src="/logo.png"></header><article><h1>Still readable</h1>' +
        '<p>The article body must survive one broken image reference.</p>' +
        '<img src="http://[bad" alt="Broken diagram"></article>',
        { headers: { 'content-type': 'text/html' } }
      )
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    const result = await importArticleFromUrl('https://example.com/story', store, join(directory, 'assets'), {
      fetchImpl: fetchMock,
      resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
      id: 'article-malformed-image'
    })

    expect(result.article.markdown).toContain('The article body must survive one broken image reference.')
    expect(result.article.markdown).toContain('Broken diagram unavailable offline')
    expect(result.warnings).toEqual(['1 article image could not be saved for offline reading.'])
    expect(fetchMock).toHaveBeenCalledOnce()
    await expect(store.read()).resolves.toMatchObject({ articles: [{ id: 'article-malformed-image' }] })
  })

  it('deletes only the managed article asset directory and preserves source and unrelated files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-article-delete-'))
    temporaryDirectories.push(directory)
    const store = new LocalStore(join(directory, 'state.json'))
    const assetsDirectory = join(directory, 'assets')
    const sourcePath = join(directory, 'source.md')
    const unrelatedPath = join(assetsDirectory, 'another-article', 'keep.png')
    const targetPath = join(assetsDirectory, 'article-delete', 'image-1.png')
    await mkdir(join(assetsDirectory, 'another-article'), { recursive: true })
    await mkdir(join(assetsDirectory, 'article-delete'), { recursive: true })
    await Promise.all([
      writeFile(sourcePath, '# Source'),
      writeFile(unrelatedPath, 'keep'),
      writeFile(targetPath, 'delete')
    ])
    await store.update((state) => ({
      ...state,
      articles: [{ id: 'article-delete', title: 'Delete', fileName: 'source.md', markdown: '# Delete', importedAt: '2026-09-15T00:00:00.000Z' }]
    }))

    await deleteArticleWithAssets(store, 'article-delete', assetsDirectory)

    await expect(access(targetPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(sourcePath)).resolves.toBeUndefined()
    await expect(readFile(unrelatedPath, 'utf8')).resolves.toBe('keep')
    await expect(store.read()).resolves.toMatchObject({ articles: [] })
  })
})
