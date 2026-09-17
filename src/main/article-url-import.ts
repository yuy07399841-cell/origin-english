import { Readability } from '@mozilla/readability'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseHTML } from 'linkedom'
import TurndownService from 'turndown'
import type { Article, ArticleAssetResult, ArticleUrlImportResult } from '../shared/types'
import type { LocalStore } from './storage'
import { downloadPublicResource, type ResolvedAddress } from './safe-download'
import { deleteArticleFromState } from './article-state'

const MAX_ARTICLE_HTML_BYTES = 5 * 1024 * 1024

interface ArticleUrlImportOptions {
  fetchImpl?: typeof fetch
  resolveHost?: (host: string) => Promise<ResolvedAddress[]>
  id?: string
  importedAt?: string
}

export async function importArticleFromUrl(
  rawUrl: string,
  store: LocalStore,
  assetsDirectory: string,
  options: ArticleUrlImportOptions = {}
): Promise<ArticleUrlImportResult> {
  const downloaded = await downloadPublicResource(rawUrl, {
    fetchImpl: options.fetchImpl,
    resolveHost: options.resolveHost,
    maxBytes: MAX_ARTICLE_HTML_BYTES,
    timeoutMs: 15_000,
    acceptedContentTypes: ['text/html', 'application/xhtml+xml']
  })
  const html = downloaded.bytes.toString('utf8')
  const { document } = parseHTML(html)
  for (const element of document.querySelectorAll('script, style, noscript, iframe')) element.remove()
  const visibleHeading = document.querySelector('article h1, main h1, h1')?.textContent?.trim()
  const fallbackRoot = document.querySelector('article, main')
  const fallbackContent = fallbackRoot?.outerHTML ?? ''
  const fallbackText = fallbackRoot?.textContent?.trim() ?? ''
  const readable = new Readability(document, { charThreshold: 20 }).parse()
  const readableContent = readable?.content || fallbackContent
  const readableText = readable?.textContent?.trim() || fallbackText
  if (!readableContent || !readableText) {
    throw new Error('No readable article body was found. Nothing was saved.')
  }
  const id = options.id ?? randomUUID()
  const articleAssetDirectory = join(assetsDirectory, id)
  const contentDocument = parseHTML(`<html><body>${readableContent}</body></html>`).document
  const assets: NonNullable<Article['assets']> = []
  let failedImages = 0
  const allImages = Array.from(contentDocument.querySelectorAll('img'))
  const images = allImages.slice(0, 20)
  for (const image of allImages.slice(20)) {
    image.replaceWith(contentDocument.createTextNode(`[${image.getAttribute('alt') || 'Image'} unavailable offline]`))
    failedImages += 1
  }
  for (const [index, image] of images.entries()) {
    const src = image.getAttribute('src')
    if (!src) {
      image.remove()
      failedImages += 1
      continue
    }
    try {
      const imageUrl = new URL(src, downloaded.finalUrl).href
      const downloadedImage = await downloadPublicResource(imageUrl, {
        fetchImpl: options.fetchImpl,
        resolveHost: options.resolveHost,
        maxBytes: 10 * 1024 * 1024,
        timeoutMs: 10_000,
        acceptedContentTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
      })
      const extension = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp'
      }[downloadedImage.contentType]
      if (!extension) throw new Error('Unsupported image type.')
      const storedFileName = `image-${index + 1}.${extension}`
      const storedPath = join(articleAssetDirectory, storedFileName)
      const temporaryPath = `${storedPath}.${process.pid}.tmp`
      await mkdir(articleAssetDirectory, { recursive: true })
      await writeFile(temporaryPath, downloadedImage.bytes)
      await rename(temporaryPath, storedPath)
      assets.push({
        storedFileName,
        mimeType: downloadedImage.contentType as NonNullable<Article['assets']>[number]['mimeType'],
        bytes: downloadedImage.bytes.length
      })
      image.setAttribute('src', `origin-asset://${id}/${storedFileName}`)
    } catch {
      image.replaceWith(contentDocument.createTextNode(`[${image.getAttribute('alt') || 'Image'} unavailable offline]`))
      failedImages += 1
    }
  }
  const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '*' })
  let markdown = turndown.turndown(contentDocument.body.innerHTML).trim()
  const title = visibleHeading || readable?.title?.trim() || new URL(downloaded.finalUrl).hostname
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  markdown = markdown.replace(new RegExp(`^#{1,6}\\s+${escapedTitle}\\s*`, 'i'), '').trim()
  markdown = `# ${title}\n\n${markdown}`
  if (!markdown.replace(/^# .*$/m, '').trim()) {
    throw new Error('No readable article body was found. Nothing was saved.')
  }
  const article: Article = {
    id,
    title,
    fileName: `${new URL(downloaded.finalUrl).hostname}.md`,
    markdown,
    importedAt: options.importedAt ?? new Date().toISOString(),
    sourceUrl: downloaded.finalUrl,
    assets
  }
  try {
    await store.update((state) => ({ ...state, articles: [article, ...state.articles] }))
  } catch (error) {
    await rm(articleAssetDirectory, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
  return {
    article,
    warnings: failedImages
      ? [`${failedImages} article image${failedImages === 1 ? '' : 's'} could not be saved for offline reading.`]
      : []
  }
}

export async function loadArticleAsset(
  article: Article,
  assetsDirectory: string,
  storedFileName: string
): Promise<ArticleAssetResult> {
  if (!/^image-\d+\.(?:jpg|png|gif|webp)$/.test(storedFileName)) {
    throw new Error('The saved article image reference is invalid.')
  }
  const asset = article.assets?.find((candidate) => candidate.storedFileName === storedFileName)
  if (!asset) throw new Error('This article image is no longer available offline.')
  const bytes = await readFile(join(assetsDirectory, article.id, storedFileName))
  if (bytes.length !== asset.bytes) throw new Error('The saved article image does not match its record.')
  return {
    dataUrl: `data:${asset.mimeType};base64,${bytes.toString('base64')}`,
    mimeType: asset.mimeType,
    bytes: bytes.length
  }
}

export async function deleteArticleWithAssets(
  store: LocalStore,
  articleId: string,
  assetsDirectory: string
): Promise<Awaited<ReturnType<LocalStore['read']>>> {
  if (!/^[A-Za-z0-9-]+$/.test(articleId)) throw new Error('Article id contains unsupported characters.')
  const updated = await store.update((state) => deleteArticleFromState(state, articleId))
  await rm(join(assetsDirectory, articleId), { recursive: true, force: true }).catch(() => undefined)
  return updated
}
