import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const projectDirectory = resolve(import.meta.dirname, '..')

async function findFreePort() {
  const server = createServer()
  await new Promise((resolveReady, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveReady)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not allocate a CDP port.')
  await new Promise((resolveClosed) => server.close(resolveClosed))
  return address.port
}

async function waitForPage(port) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
        response.json()
      )
      const page = pages.find((candidate) => candidate.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      // Electron may still be starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error('Timed out waiting for the Electron renderer.')
}

function createCdpClient(websocketUrl) {
  const socket = new WebSocket(websocketUrl)
  const pending = new Map()
  let nextId = 1

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (!message.id || !pending.has(message.id)) return
    const { resolvePending, rejectPending } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) rejectPending(new Error(message.error.message))
    else resolvePending(message.result)
  })

  return {
    socket,
    ready: new Promise((resolveReady, rejectReady) => {
      socket.addEventListener('open', resolveReady, { once: true })
      socket.addEventListener('error', rejectReady, { once: true })
    }),
    send(method, params = {}) {
      const id = nextId++
      return new Promise((resolvePending, rejectPending) => {
        pending.set(id, { resolvePending, rejectPending })
        socket.send(JSON.stringify({ id, method, params }))
      })
    }
  }
}

async function waitForProcessExit(childProcess, timeoutMs = 5000) {
  if (childProcess.exitCode !== null) return
  await new Promise((resolveExit) => {
    const timeout = setTimeout(resolveExit, timeoutMs)
    childProcess.once('exit', () => {
      clearTimeout(timeout)
      resolveExit()
    })
  })
}

async function seedWordAudio(cacheDirectory, fileName, sourceWord) {
  const cacheKey = createHash('sha256').update(fileName.toLowerCase()).digest('hex')
  const audioFileName = `${cacheKey}.ogg`
  await writeFile(join(cacheDirectory, audioFileName), Uint8Array.from([79, 103, 103, 83]))
  await writeFile(
    join(cacheDirectory, `${cacheKey}.json`),
    JSON.stringify({
      sourceUrl: `https://commons.wikimedia.org/wiki/File:${fileName}`,
      license: 'Test cache only',
      artist: `${sourceWord} test speaker`,
      mimeType: 'audio/ogg',
      audioFileName
    }),
    'utf8'
  )
}

const temporaryPrefix = join(tmpdir(), 'origin-english-word-audio-prefetch-')
const userDataDirectory = await mkdtemp(temporaryPrefix)
const dataDirectory = join(userDataDirectory, 'origin-english')
const cacheDirectory = join(dataDirectory, 'word-audio-cache')
const port = await findFreePort()
const electronPath = join(projectDirectory, 'node_modules', 'electron', 'dist', 'electron.exe')
let electronProcess
let client
let electronErrors = ''

try {
  await mkdir(cacheDirectory, { recursive: true })
  await seedWordAudio(cacheDirectory, 'en-us-noticing.ogg', 'noticing')
  await seedWordAudio(cacheDirectory, 'en-us-notice.ogg', 'notice')
  await writeFile(
    join(dataDirectory, 'state.json'),
    `${JSON.stringify(
      {
        schemaVersion: 4,
        uiLanguage: 'zh',
        articles: [
          {
            id: 'word-audio-prefetch-article',
            title: 'Word form recordings',
            fileName: 'word-form-recordings.md',
            markdown:
              '# Word form recordings\n\nShe notices small changes while noticing how the room grows quiet.',
            importedAt: '2026-08-30T11:00:00.000Z'
          }
        ],
        listeningItems: [],
        savedWords: [],
        lookupEvents: []
      },
      null,
      2
    )}\n`,
    'utf8'
  )

  electronProcess = spawn(electronPath, ['.', `--remote-debugging-port=${port}`], {
    cwd: projectDirectory,
    env: {
      ...process.env,
      MIMO_API_KEY: '',
      ORIGIN_ENGLISH_USER_DATA_DIR: userDataDirectory
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  })
  electronProcess.stderr.setEncoding('utf8')
  electronProcess.stderr.on('data', (chunk) => {
    electronErrors = `${electronErrors}${chunk}`.slice(-4000)
  })

  const websocketUrl = await waitForPage(port)
  client = createCdpClient(websocketUrl)
  await client.ready
  await client.send('Runtime.enable')
  await client.send('Page.enable')

  const readyDeadline = Date.now() + 30_000
  let rendererReady = false
  while (Date.now() < readyDeadline && !rendererReady) {
    try {
      const evaluation = await client.send('Runtime.evaluate', {
        expression:
          "document.readyState === 'complete' && Boolean(window.originEnglish) && Boolean(document.querySelector('.app-shell'))",
        returnByValue: true
      })
      rendererReady = evaluation.result.value === true
    } catch {
      // The initial execution context may disappear while the file page loads.
    }
    if (!rendererReady) await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  if (!rendererReady) throw new Error('Timed out waiting for the complete application renderer.')

  const evaluation = await client.send('Runtime.evaluate', {
    expression: `(async () => {
      const waitFor = async (predicate, message, timeoutMs = 10000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const value = predicate();
          if (value) return value;
          await new Promise((resolveWait) => setTimeout(resolveWait, 50));
        }
        throw new Error(message);
      };

      document.querySelector('.article-open-button').click();
      const article = await waitFor(
        () => document.querySelector('article.reading-paper'),
        'Reading article was not found'
      );

      const probe = { playCalls: [], constructorCalls: [] };
      window.Audio = class ValidationAudio {
        constructor(source) {
          this.src = source;
          probe.constructorCalls.push(source.slice(0, 22));
        }
        play() {
          probe.playCalls.push(this.src.slice(0, 22));
          return Promise.resolve();
        }
        pause() {}
      };

      const selectAndPlay = async (target) => {
        const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
        let textNode = null;
        let start = -1;
        while (walker.nextNode()) {
          const content = walker.currentNode.textContent ?? '';
          const candidateStart = content.indexOf(target);
          if (candidateStart >= 0) {
            textNode = walker.currentNode;
            start = candidateStart;
            break;
          }
        }
        if (!textNode || start < 0) throw new Error('Validation word was not found: ' + target);

        const range = document.createRange();
        range.setStart(textNode, start);
        range.setEnd(textNode, start + target.length);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        article.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

        const panel = await waitFor(
          () => {
            const candidate = document.querySelector('.definition-panel');
            return candidate?.querySelector('.word-line h2')?.textContent?.trim().toLowerCase() ===
              target.toLowerCase()
              ? candidate
              : null;
          },
          'Definition did not appear for ' + target
        );
        await new Promise((resolveWait) => setTimeout(resolveWait, 500));
        const button = [...panel.querySelectorAll('button')].find(
          (candidate) => candidate.textContent.trim() === '单词发音'
        );
        if (!button) throw new Error('Word audio button was not ready for ' + target);
        const startedAt = performance.now();
        button.click();
        const attribution = await waitFor(
          () => panel.querySelector('.audio-attribution')?.textContent?.trim(),
          'Audio attribution did not appear for ' + target
        );
        return {
          word: panel.querySelector('.word-line h2')?.textContent?.trim(),
          attribution,
          clickToAttributionMs: Math.round(performance.now() - startedAt),
          buttonText: button.textContent.trim()
        };
      };

      const exact = await selectAndPlay('noticing');
      const fallback = await selectAndPlay('notices');
      const state = await window.originEnglish.loadState();
      const runtimeStatus = await window.originEnglish.getRuntimeStatus();

      if (exact.attribution.includes('词典原型')) {
        throw new Error('Exact-form recording was incorrectly labeled as a fallback.');
      }
      if (!fallback.attribution.includes('词典原型：notice')) {
        throw new Error('Headword fallback was not disclosed.');
      }
      if (probe.playCalls.length !== 2) throw new Error('Expected two explicit playback calls.');
      if (runtimeStatus.liveMimoEnabled) throw new Error('MiMo must remain disabled in validation.');

      return JSON.stringify({
        exact,
        fallback,
        probe,
        lookupEventCount: state.lookupEvents.length,
        liveMimoEnabled: runtimeStatus.liveMimoEnabled
      });
    })()`,
    awaitPromise: true,
    returnByValue: true
  })

  if (evaluation.exceptionDetails) {
    throw new Error(
      evaluation.exceptionDetails.exception?.description ?? evaluation.exceptionDetails.text
    )
  }
  console.log(evaluation.result.value)
} catch (error) {
  if (electronErrors) console.error(electronErrors)
  throw error
} finally {
  if (client) {
    void client.send('Browser.close').catch(() => undefined)
  }
  if (electronProcess) {
    await waitForProcessExit(electronProcess)
    if (electronProcess.exitCode === null) {
      electronProcess.kill()
      await waitForProcessExit(electronProcess)
    }
  }
  client?.socket.close()
  const resolvedTemporaryDirectory = resolve(userDataDirectory)
  const resolvedPrefix = resolve(tmpdir())
  if (resolvedTemporaryDirectory.startsWith(`${resolvedPrefix}\\origin-english-word-audio-prefetch-`)) {
    await rm(resolvedTemporaryDirectory, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100
    })
  }
}
