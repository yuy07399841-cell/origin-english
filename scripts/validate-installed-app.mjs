import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'

const executablePath = process.argv[2]
const screenshotPath = process.argv[3]
const userDataDirectory = process.argv[4]

if (!executablePath || !screenshotPath) {
  throw new Error('Usage: node validate-installed-app.mjs <installed-exe> <screenshot-path>')
}

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
      const page = pages.find(
        (candidate) =>
          candidate.type === 'page' &&
          typeof candidate.url === 'string' &&
          candidate.url.includes('/out/renderer/index.html')
      )
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      // The installed application may still be starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error('Timed out waiting for the installed application renderer.')
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

function checkedValue(evaluation) {
  if (evaluation.exceptionDetails) {
    throw new Error(
      evaluation.exceptionDetails.exception?.description ?? evaluation.exceptionDetails.text
    )
  }
  return evaluation.result.value
}

async function evaluate(client, expression) {
  let lastError
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return checkedValue(
        await client.send('Runtime.evaluate', {
          expression,
          awaitPromise: true,
          returnByValue: true
        })
      )
    } catch (error) {
      lastError = error
      if (!(error instanceof Error) || !error.message.includes('Execution context was destroyed')) {
        throw error
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 250))
    }
  }
  throw lastError
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

const port = await findFreePort()
let applicationProcess
let client
let applicationErrors = ''

try {
  applicationProcess = spawn(resolve(executablePath), [`--remote-debugging-port=${port}`], {
    env: userDataDirectory
      ? { ...process.env, ORIGIN_ENGLISH_USER_DATA_DIR: resolve(userDataDirectory) }
      : process.env,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  })
  applicationProcess.stderr.setEncoding('utf8')
  applicationProcess.stderr.on('data', (chunk) => {
    applicationErrors = `${applicationErrors}${chunk}`.slice(-4000)
  })

  client = createCdpClient(await waitForPage(port))
  await client.ready
  await client.send('Runtime.enable')
  await client.send('Page.enable')

  const evaluation = await evaluate(
    client,
    `(async () => {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline && !document.querySelector('.library-page')) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!document.querySelector('.library-page')) {
        throw new Error('The installed application did not open the article library');
      }
      const state = await window.originEnglish.loadState();
      const runtimeStatus = await window.originEnglish.getRuntimeStatus();
      return JSON.stringify({
        title: document.title,
        schemaVersion: state.schemaVersion,
        articleCount: state.articles.length,
        listeningCount: state.listeningItems.length,
        savedWordCount: state.savedWords.length,
        lookupCount: state.lookupEvents.length,
        aiAvailability: runtimeStatus.aiAvailability,
        secureStorageAvailable: runtimeStatus.secureStorageAvailable,
        credentialStatus: runtimeStatus.credentialStatus,
        sentenceAudioEnabled: runtimeStatus.sentenceAudioEnabled,
        sentenceAudioGenerationCount: runtimeStatus.sentenceAudioGenerationCount,
        renderedArticleRows: document.querySelectorAll('.article-row').length,
        hasPrimaryImport: Boolean(document.querySelector('.topbar-import.primary-button')),
        hasAiServiceButton: Boolean(document.querySelector('.ai-service-button')),
        hasListeningApi: typeof window.originEnglish.transcribeListening === 'function',
        hasAiConfigurationApi: typeof window.originEnglish.configureAiServices === 'function'
      });
    })()`
  )

  const screenshot = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false
  })
  await mkdir(dirname(resolve(screenshotPath)), { recursive: true })
  await writeFile(resolve(screenshotPath), Buffer.from(screenshot.data, 'base64'))
  console.log(evaluation)
  void client.send('Browser.close').catch(() => undefined)
  await waitForProcessExit(applicationProcess)
} catch (error) {
  if (applicationErrors) console.error(applicationErrors)
  throw error
} finally {
  client?.socket.close()
  if (applicationProcess && applicationProcess.exitCode === null) {
    applicationProcess.kill()
    await waitForProcessExit(applicationProcess)
  }
}
