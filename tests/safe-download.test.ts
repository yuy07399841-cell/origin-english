import { createServer } from 'node:http'
import { once } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { downloadPublicResource, requestPinned } from '../src/main/safe-download'

describe('public network connection boundary', () => {
  it('adapts a real Node HTTP 204 response without constructing a forbidden body', async () => {
    const server = createServer((_request, response) => response.writeHead(204).end())
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Test server address is unavailable.')
      const response = await requestPinned(
        new URL(`http://public.test:${address.port}/empty`),
        [{ address: '127.0.0.1', family: 4 }],
        new AbortController().signal
      )
      expect(response.status).toBe(204)
      expect(response.body).toBeNull()
    } finally {
      server.close()
      await once(server, 'close')
    }
  })

  it('closes a real Node HTTP 205 stream instead of draining an unbounded forbidden body', async () => {
    let writes = 0
    let connectionClosed = false
    const server = createServer((request, response) => {
      response.writeHead(205, { 'content-type': 'text/html', 'transfer-encoding': 'chunked' })
      const interval = setInterval(() => {
        writes += 1
        response.write('still streaming')
      }, 10)
      request.once('close', () => {
        connectionClosed = true
        clearInterval(interval)
      })
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Test server address is unavailable.')
      const response = await requestPinned(
        new URL(`http://public.test:${address.port}/streaming-empty`),
        [{ address: '127.0.0.1', family: 4 }],
        new AbortController().signal
      )
      expect(response.status).toBe(205)
      expect(response.body).toBeNull()
      await new Promise((resolve) => setTimeout(resolve, 80))
      expect(connectionClosed).toBe(true)
      expect(writes).toBeLessThan(4)
    } finally {
      server.closeAllConnections()
      server.close()
      await once(server, 'close')
    }
  })

  it('connects only through the addresses approved by the first DNS lookup', async () => {
    const resolveHost = vi.fn(async () => {
      if (resolveHost.mock.calls.length > 1) return [{ address: '127.0.0.1', family: 4 }]
      return [{ address: '93.184.216.34', family: 4 }]
    })
    const requestImpl = vi.fn(async (_url, addresses) => {
      expect(addresses).toEqual([{ address: '93.184.216.34', family: 4 }])
      return new Response('<article><p>Safe response</p></article>', {
        headers: { 'content-type': 'text/html' }
      })
    })

    await expect(downloadPublicResource('https://example.com/article', {
      resolveHost,
      requestImpl,
      maxBytes: 1_000,
      timeoutMs: 1_000,
      dnsTimeoutMs: 100,
      acceptedContentTypes: ['text/html']
    })).resolves.toMatchObject({ finalUrl: 'https://example.com/article' })
    expect(resolveHost).toHaveBeenCalledOnce()
    expect(requestImpl).toHaveBeenCalledOnce()
  })

  it('cancels an official response that redirects outside the approved host list', async () => {
    const cancelled = vi.fn()
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('redirect')) },
      cancel: cancelled
    })
    const requestImpl = vi.fn(async () => new Response(body, {
      status: 302,
      headers: { location: 'https://evil.example/component.exe' }
    }))

    await expect(downloadPublicResource('https://github.com/official/component.exe', {
      resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
      requestImpl,
      maxBytes: 1_000,
      timeoutMs: 1_000,
      acceptedContentTypes: ['application/octet-stream'],
      allowedHosts: ['github.com', 'release-assets.githubusercontent.com']
    })).rejects.toThrow(/outside the approved source list/i)
    expect(requestImpl).toHaveBeenCalledOnce()
    expect(cancelled).toHaveBeenCalledOnce()
  })

  it.each([
    ['100.64.0.1', 4],
    ['198.18.0.1', 4],
    ['203.0.113.1', 4],
    ['::ffff:127.0.0.1', 6],
    ['2001:db8::1', 6],
    ['fe80::1', 6]
  ])('rejects non-public address %s before connecting', async (address, family) => {
    const requestImpl = vi.fn()
    await expect(downloadPublicResource('https://blocked.example/resource', {
      resolveHost: async () => [{ address: String(address), family: Number(family) }],
      requestImpl,
      maxBytes: 1_000,
      timeoutMs: 1_000,
      dnsTimeoutMs: 100,
      acceptedContentTypes: ['text/html']
    })).rejects.toThrow(/private network/i)
    expect(requestImpl).not.toHaveBeenCalled()
  })

  it('times out a DNS lookup before any connection is attempted', async () => {
    const requestImpl = vi.fn()
    await expect(downloadPublicResource('https://slow.example/resource', {
      resolveHost: async () => new Promise(() => undefined),
      requestImpl,
      maxBytes: 1_000,
      timeoutMs: 1_000,
      dnsTimeoutMs: 20,
      acceptedContentTypes: ['text/html']
    })).rejects.toThrow(/DNS lookup timed out/i)
    expect(requestImpl).not.toHaveBeenCalled()
  })

  it.each([
    ['redirect', 302, 'text/html', '10'],
    ['HTTP error', 500, 'text/html', '10'],
    ['unsupported type', 200, 'application/octet-stream', '10'],
    ['declared oversized response', 200, 'text/html', '1001']
  ])('cancels the response body discarded after %s', async (_label, status, contentType, contentLength) => {
    const cancelled = vi.fn()
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('discard me')) },
      cancel: cancelled
    })
    const requestImpl = vi.fn(async () => new Response(body, {
      status,
      headers: {
        'content-type': contentType,
        'content-length': contentLength,
        ...(status === 302 ? { location: 'https://redirected.example/end' } : {})
      }
    }))
    const promise = downloadPublicResource('https://example.com/start', {
      resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
      requestImpl,
      maxBytes: 1_000,
      timeoutMs: 1_000,
      acceptedContentTypes: ['text/html'],
      maxRedirects: status === 302 ? 0 : 3
    })
    await expect(promise).rejects.toThrow()
    expect(cancelled).toHaveBeenCalledOnce()
  })
})
