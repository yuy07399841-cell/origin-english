import { isIP, type LookupFunction } from 'node:net'
import { lookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Readable } from 'node:stream'

export interface ResolvedAddress {
  address: string
  family: number
}

export interface DownloadOptions {
  fetchImpl?: typeof fetch
  requestImpl?: PinnedRequest
  resolveHost?: (host: string) => Promise<ResolvedAddress[]>
  maxBytes: number
  timeoutMs: number
  acceptedContentTypes: string[]
  maxRedirects?: number
  dnsTimeoutMs?: number
  allowedHosts?: string[]
  onProgress?: (downloadedBytes: number, totalBytes: number | null) => void
  signal?: AbortSignal
}

export type PinnedRequest = (
  url: URL,
  approvedAddresses: readonly ResolvedAddress[],
  signal: AbortSignal
) => Promise<Response>

export interface DownloadedResource {
  bytes: Buffer
  contentType: string
  finalUrl: string
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true
  return parts.some((part) => part < 0 || part > 255) ||
    parts[0] === 0 || parts[0] === 10 || parts[0] === 127 ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) ||
    (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) ||
    (parts[0] === 192 && parts[1] === 88 && parts[2] === 99) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) ||
    (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) ||
    (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) || parts[0] >= 224
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) return isPrivateIpv4(address)
  const normalized = address.toLowerCase()
  if (normalized.startsWith('::ffff:')) return isPrivateIpv4(normalized.slice(7))
  return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') ||
    normalized.startsWith('fd') || /^fe[89ab]/.test(normalized) || normalized.startsWith('ff') ||
    normalized.startsWith('2001:db8:') || normalized === '2001:db8::' || normalized.startsWith('100::')
}

async function resolveWithTimeout(
  host: string,
  resolveHost: (host: string) => Promise<ResolvedAddress[]>,
  timeoutMs: number
): Promise<ResolvedAddress[]> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      resolveHost(host),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('DNS lookup timed out.')), timeoutMs)
      })
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function resolvePublicUrl(
  rawUrl: string,
  resolveHost: (host: string) => Promise<ResolvedAddress[]>,
  dnsTimeoutMs: number
): Promise<{ url: URL; addresses: ResolvedAddress[] }> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('Enter a valid public URL.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS URLs are supported.')
  }
  if (url.username || url.password) throw new Error('URLs with embedded credentials are not supported.')
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) {
    throw new Error('Local and private network destinations are blocked.')
  }
  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname, family: isIP(url.hostname) }]
    : await resolveWithTimeout(url.hostname, resolveHost, dnsTimeoutMs)
  if (!addresses.length || addresses.some((entry) =>
    (entry.family !== 4 && entry.family !== 6) || isPrivateAddress(entry.address)
  )) {
    throw new Error('Local and private network destinations are blocked.')
  }
  return { url, addresses }
}

export async function validatePublicUrl(
  rawUrl: string,
  resolveHost: (host: string) => Promise<ResolvedAddress[]>,
  dnsTimeoutMs = 5_000
): Promise<URL> {
  return (await resolvePublicUrl(rawUrl, resolveHost, dnsTimeoutMs)).url
}

export const requestPinned: PinnedRequest = async (url, approvedAddresses, signal) => {
  const pinnedLookup: LookupFunction = (_hostname, lookupOptions, callback) => {
    const family = typeof lookupOptions.family === 'number' && lookupOptions.family !== 0
      ? lookupOptions.family
      : null
    const candidates = family
      ? approvedAddresses.filter((entry) => entry.family === family)
      : [...approvedAddresses]
    if (!candidates.length) {
      callback(Object.assign(new Error('No approved address matches the requested family.'), { code: 'ENOTFOUND' }), '', 0)
      return
    }
    if (lookupOptions.all) {
      callback(null, candidates.map((entry) => ({ address: entry.address, family: entry.family })))
    } else {
      callback(null, candidates[0].address, candidates[0].family)
    }
  }
  return new Promise<Response>((resolve, reject) => {
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest
    const request = transport(url, {
      method: 'GET',
      signal,
      lookup: pinnedLookup,
      headers: {
        'User-Agent': 'OriginEnglish/0.2 (+local learning import)',
        'Accept-Encoding': 'identity'
      }
    }, (incoming) => {
      try {
        const headers = new Headers()
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) value.forEach((entry) => headers.append(name, entry))
          else if (value !== undefined) headers.set(name, String(value))
        }
        const status = incoming.statusCode ?? 500
        const hasForbiddenBody = status === 204 || status === 205 || status === 304
        if (hasForbiddenBody) incoming.destroy()
        resolve(new Response(
          hasForbiddenBody ? null : Readable.toWeb(incoming) as ReadableStream<Uint8Array>,
          { status, headers }
        ))
      } catch (error) {
        incoming.destroy()
        reject(error)
      }
    })
    request.on('error', reject)
    request.end()
  })
}

export async function downloadPublicResource(
  rawUrl: string,
  options: DownloadOptions
): Promise<DownloadedResource> {
  const resolveHost = options.resolveHost ?? (async (host) => lookup(host, { all: true }))
  let resolved = await resolvePublicUrl(rawUrl, resolveHost, options.dnsTimeoutMs ?? 5_000)
  const assertAllowedHost = (url: URL): void => {
    if (options.allowedHosts && !options.allowedHosts.includes(url.hostname.toLowerCase())) {
      throw new Error('The download redirected to a host outside the approved source list.')
    }
  }
  assertAllowedHost(resolved.url)
  const controller = new AbortController()
  let timedOut = false
  const abortFromCaller = (): void => controller.abort()
  if (options.signal?.aborted) controller.abort()
  else options.signal?.addEventListener('abort', abortFromCaller, { once: true })
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs)
  try {
    for (let redirect = 0; redirect <= (options.maxRedirects ?? 3); redirect += 1) {
      const response = options.requestImpl
        ? await options.requestImpl(resolved.url, resolved.addresses, controller.signal)
        : options.fetchImpl
          ? await options.fetchImpl(resolved.url, {
              redirect: 'manual',
              signal: controller.signal,
              headers: { 'User-Agent': 'OriginEnglish/0.2 (+local learning import)' }
            })
          : await requestPinned(resolved.url, resolved.addresses, controller.signal)
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location || redirect === (options.maxRedirects ?? 3)) {
          await response.body?.cancel().catch(() => undefined)
          throw new Error('The URL redirected too many times.')
        }
        await response.body?.cancel().catch(() => undefined)
        resolved = await resolvePublicUrl(
          new URL(location, resolved.url).href,
          resolveHost,
          options.dnsTimeoutMs ?? 5_000
        )
        assertAllowedHost(resolved.url)
        continue
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new Error(`The source returned HTTP ${response.status}.`)
      }
      const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
      if (!options.acceptedContentTypes.some((accepted) => contentType === accepted)) {
        await response.body?.cancel().catch(() => undefined)
        throw new Error(`The source returned unsupported content (${contentType || 'unknown'}).`)
      }
      const declared = Number(response.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > options.maxBytes) {
        await response.body?.cancel().catch(() => undefined)
        throw new Error(`The download exceeds the ${options.maxBytes} byte limit.`)
      }
      if (!response.body) throw new Error('The source returned an empty response.')
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let total = 0
      const expectedTotal = Number.isFinite(declared) && declared >= 0 ? declared : null
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > options.maxBytes) {
          await reader.cancel()
          throw new Error(`The download exceeds the ${options.maxBytes} byte limit.`)
        }
        chunks.push(value)
        options.onProgress?.(total, expectedTotal)
      }
      if (total === 0) throw new Error('The source returned an empty response.')
      return { bytes: Buffer.concat(chunks), contentType, finalUrl: resolved.url.href }
    }
    throw new Error('The URL redirected too many times.')
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(timedOut ? 'The download timed out.' : 'The download was cancelled.')
    }
    throw error
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abortFromCaller)
  }
}
