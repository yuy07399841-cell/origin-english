import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const projectDirectory = resolve(import.meta.dirname, '..')
const confirmationScreenshotPath = join(
  projectDirectory,
  'artifacts',
  'article-delete-confirmation.png'
)
const afterScreenshotPath = join(projectDirectory, 'artifacts', 'article-delete-after.png')

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
      // Electron may not have opened its DevTools endpoint yet.
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

async function launchElectron(userDataDirectory) {
  const port = await findFreePort()
  const executableOverride = process.env.ORIGIN_ENGLISH_EXECUTABLE_PATH?.trim()
  const electronPath = executableOverride
    ? resolve(executableOverride)
    : join(projectDirectory, 'node_modules', 'electron', 'dist', 'electron.exe')
  const electronArguments = executableOverride
    ? [`--remote-debugging-port=${port}`]
    : ['.', `--remote-debugging-port=${port}`]
  const childProcess = spawn(electronPath, electronArguments, {
    cwd: projectDirectory,
    env: {
      ...process.env,
      MIMO_API_KEY: '',
      ORIGIN_ENGLISH_USER_DATA_DIR: userDataDirectory
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  })
  let electronErrors = ''
  childProcess.stderr.setEncoding('utf8')
  childProcess.stderr.on('data', (chunk) => {
    electronErrors = `${electronErrors}${chunk}`.slice(-4000)
  })

  try {
    const websocketUrl = await waitForPage(port)
    const client = createCdpClient(websocketUrl)
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
        // The initial about:blank execution context can disappear while the app page loads.
      }
      if (!rendererReady) await new Promise((resolveWait) => setTimeout(resolveWait, 100))
    }
    if (!rendererReady) throw new Error('Timed out waiting for the complete application renderer.')
    return { childProcess, client, getErrors: () => electronErrors }
  } catch (error) {
    childProcess.kill()
    await waitForProcessExit(childProcess)
    if (electronErrors) console.error(electronErrors)
    throw error
  }
}

async function closeElectron(instance) {
  void instance.client.send('Browser.close').catch(() => undefined)
  await waitForProcessExit(instance.childProcess)
  instance.client.socket.close()
  if (instance.childProcess.exitCode === null) {
    instance.childProcess.kill()
    await waitForProcessExit(instance.childProcess)
  }
}

function checkedValue(evaluation) {
  if (evaluation.exceptionDetails) {
    throw new Error(
      evaluation.exceptionDetails.exception?.description ?? evaluation.exceptionDetails.text
    )
  }
  return JSON.parse(evaluation.result.value)
}

const temporaryPrefix = join(tmpdir(), 'origin-english-article-delete-')
const userDataDirectory = await mkdtemp(temporaryPrefix)
const appDataDirectory = join(userDataDirectory, 'origin-english')
const statePath = join(appDataDirectory, 'state.json')
let firstInstance
let secondInstance

try {
  await mkdir(appDataDirectory, { recursive: true })
  await writeFile(
    statePath,
    `${JSON.stringify(
      {
        schemaVersion: 4,
        uiLanguage: 'zh',
        articles: [
          {
            id: 'delete-this-article',
            title: 'Delete this article',
            fileName: 'delete-this.md',
            markdown: '# Delete this article\n\nThis article should be removed safely.',
            importedAt: '2026-08-30T10:00:00.000Z'
          },
          {
            id: 'keep-this-article',
            title: 'Keep this article',
            fileName: 'keep-this.md',
            markdown: '# Keep this article\n\nThis article should remain readable.',
            importedAt: '2026-08-30T09:00:00.000Z'
          }
        ],
        listeningItems: [],
        savedWords: [
          {
            id: 'word-from-deleted-article',
            word: 'safely',
            sentence: 'This article should be removed safely.',
            partOfSpeech: 'adverb',
            definition: 'in a way that avoids harm',
            usage: 'remove something safely',
            articleId: 'delete-this-article',
            savedAt: '2026-08-30T10:01:00.000Z'
          },
          {
            id: 'word-from-kept-article',
            word: 'remain',
            sentence: 'This article should remain readable.',
            partOfSpeech: 'verb',
            definition: 'to continue to exist',
            usage: 'remain readable',
            articleId: 'keep-this-article',
            savedAt: '2026-08-30T09:01:00.000Z'
          }
        ],
        lookupEvents: [
          {
            id: 'lookup-from-deleted-article',
            word: 'safely',
            sentence: 'This article should be removed safely.',
            articleId: 'delete-this-article',
            outcome: 'helpful',
            createdAt: '2026-08-30T10:01:00.000Z'
          },
          {
            id: 'lookup-from-kept-article',
            word: 'remain',
            sentence: 'This article should remain readable.',
            articleId: 'keep-this-article',
            outcome: 'unrated',
            createdAt: '2026-08-30T09:01:00.000Z'
          }
        ]
      },
      null,
      2
    )}\n`,
    'utf8'
  )
  const initialStateContent = await readFile(statePath, 'utf8')

  firstInstance = await launchElectron(userDataDirectory)
  const cancellationEvaluation = await firstInstance.client.send('Runtime.evaluate', {
    expression: `(async () => {
      const waitFor = async (predicate, message) => {
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
          const value = predicate();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error(message);
      };
      await waitFor(() => document.querySelectorAll('.article-row').length === 2, 'Two articles were not rendered');
      const deleteButtons = [...document.querySelectorAll('.article-delete-button')];
      if (deleteButtons.length !== 2) throw new Error('Delete controls were not rendered for both articles');
      deleteButtons[0].click();
      const dialog = await waitFor(() => document.querySelector('.confirm-dialog'), 'Delete confirmation did not appear');
      const dialogText = dialog.innerText;
      if (!dialogText.includes('Delete this article') || !dialogText.includes('生词本')) {
        throw new Error('Delete confirmation did not explain the target and learning-record policy');
      }
      const safeButton = dialog.querySelector('.secondary-button');
      if (document.activeElement !== safeButton) throw new Error('The safe cancel action was not focused by default');
      safeButton.click();
      await waitFor(() => !document.querySelector('.confirm-dialog'), 'Delete confirmation did not close after cancel');
      const state = await window.originEnglish.loadState();
      if (state.articles.length !== 2) throw new Error('Cancel changed the article library');
      return JSON.stringify({
        articleCountAfterCancel: state.articles.length,
        deleteButtonCount: deleteButtons.length,
        dialogText
      });
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  const cancellation = checkedValue(cancellationEvaluation)
  if ((await readFile(statePath, 'utf8')) !== initialStateContent) {
    throw new Error('Cancel changed the persisted state file.')
  }

  await firstInstance.client.send('Runtime.evaluate', {
    expression: `document.querySelector('.article-delete-button')?.click()`,
    returnByValue: true
  })
  const confirmationScreenshot = await firstInstance.client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false
  })
  await mkdir(dirname(confirmationScreenshotPath), { recursive: true })
  await writeFile(
    confirmationScreenshotPath,
    Buffer.from(confirmationScreenshot.data, 'base64')
  )

  const deletionEvaluation = await firstInstance.client.send('Runtime.evaluate', {
    expression: `(async () => {
      const waitFor = async (predicate, message) => {
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
          const value = predicate();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error(message);
      };
      const confirmButton = await waitFor(
        () => document.querySelector('.confirm-delete-button'),
        'Confirm-delete control was not rendered'
      );
      confirmButton.click();
      await waitFor(
        () => document.querySelectorAll('.article-row').length === 1 && !document.querySelector('.confirm-dialog'),
        'Confirmed deletion did not update the library'
      );
      const state = await window.originEnglish.loadState();
      if (state.articles.length !== 1 || state.articles[0].id !== 'keep-this-article') {
        throw new Error('The wrong article remained after deletion');
      }
      if (state.savedWords.length !== 2 || state.lookupEvents.length !== 2) {
        throw new Error('Deletion removed learning records');
      }
      if (state.savedWords[0].articleId !== null || state.lookupEvents[0].articleId !== null) {
        throw new Error('Deleted-article references were not detached');
      }
      if (
        state.savedWords[1].articleId !== 'keep-this-article' ||
        state.lookupEvents[1].articleId !== 'keep-this-article'
      ) {
        throw new Error('Unrelated article references changed');
      }
      return JSON.stringify({
        remainingArticleIds: state.articles.map((article) => article.id),
        savedWordCount: state.savedWords.length,
        lookupCount: state.lookupEvents.length,
        detachedWordArticleId: state.savedWords[0].articleId,
        detachedLookupArticleId: state.lookupEvents[0].articleId
      });
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  const deletion = checkedValue(deletionEvaluation)
  await closeElectron(firstInstance)
  firstInstance = undefined

  const persistedState = JSON.parse(await readFile(statePath, 'utf8'))
  if (persistedState.articles.length !== 1 || persistedState.savedWords.length !== 2) {
    throw new Error('The deletion result was not persisted after Electron closed.')
  }

  secondInstance = await launchElectron(userDataDirectory)
  const restartEvaluation = await secondInstance.client.send('Runtime.evaluate', {
    expression: `(async () => {
      const waitFor = async (predicate, message) => {
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
          const value = predicate();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error(message);
      };
      const row = await waitFor(
        () => document.querySelectorAll('.article-row').length === 1 ? document.querySelector('.article-row') : null,
        'The one-article library was not restored after restart'
      );
      if (!row.innerText.includes('Keep this article')) throw new Error('The kept article was not restored');
      const state = await window.originEnglish.loadState();
      const runtimeStatus = await window.originEnglish.getRuntimeStatus();
      const openButton = row.querySelector('.article-open-button');
      openButton.click();
      await waitFor(() => document.querySelector('article.reading-paper'), 'The remaining article could not be opened');
      return JSON.stringify({
        articleCountAfterRestart: state.articles.length,
        savedWordCountAfterRestart: state.savedWords.length,
        lookupCountAfterRestart: state.lookupEvents.length,
        remainingArticleOpened: document.body.innerText.includes('This article should remain readable.'),
        liveMimoEnabled: runtimeStatus.liveMimoEnabled,
        sentenceAudioEnabled: runtimeStatus.sentenceAudioEnabled
      });
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  const restart = checkedValue(restartEvaluation)
  await secondInstance.client.send('Runtime.evaluate', {
    expression: `document.querySelector('.back-button')?.click()`,
    returnByValue: true
  })
  await new Promise((resolveWait) => setTimeout(resolveWait, 200))
  const afterScreenshot = await secondInstance.client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false
  })
  await writeFile(afterScreenshotPath, Buffer.from(afterScreenshot.data, 'base64'))

  console.log(JSON.stringify({ cancellation, deletion, restart }))
  await closeElectron(secondInstance)
  secondInstance = undefined
} catch (error) {
  if (firstInstance?.getErrors()) console.error(firstInstance.getErrors())
  if (secondInstance?.getErrors()) console.error(secondInstance.getErrors())
  throw error
} finally {
  if (firstInstance) await closeElectron(firstInstance)
  if (secondInstance) await closeElectron(secondInstance)
  const resolvedTemporaryDirectory = resolve(userDataDirectory)
  const resolvedPrefix = resolve(tmpdir())
  if (resolvedTemporaryDirectory.startsWith(`${resolvedPrefix}\\origin-english-article-delete-`)) {
    await rm(resolvedTemporaryDirectory, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100
    })
  }
}
