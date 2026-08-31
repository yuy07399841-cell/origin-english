import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const projectDirectory = resolve(import.meta.dirname, '..')
const sampleAudioPath = join(projectDirectory, 'artifacts', 'tts-audition', 'mia.wav')
const screenshotPath = join(projectDirectory, 'artifacts', 'listening-module-ui.png')

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

async function waitForProcessExit(childProcess, timeoutMs = 10_000) {
  if (childProcess.exitCode !== null) return
  await new Promise((resolveExit) => {
    const timeout = setTimeout(resolveExit, timeoutMs)
    childProcess.once('exit', () => {
      clearTimeout(timeout)
      resolveExit()
    })
  })
}

function checkedValue(evaluation) {
  if (evaluation.exceptionDetails) {
    throw new Error(
      evaluation.exceptionDetails.exception?.description ?? evaluation.exceptionDetails.text
    )
  }
  return JSON.parse(evaluation.result.value)
}

const temporaryPrefix = join(tmpdir(), 'origin-english-listening-')
const userDataDirectory = await mkdtemp(temporaryPrefix)
const dataDirectory = join(userDataDirectory, 'origin-english')
const mediaDirectory = join(dataDirectory, 'listening-media')
const storedFileName = 'audio-abc123.wav'
const storedPath = join(mediaDirectory, storedFileName)
const sourceStats = await stat(sampleAudioPath)
const port = await findFreePort()
const electronPath = join(projectDirectory, 'node_modules', 'electron', 'dist', 'electron.exe')
let electronProcess
let client
let electronErrors = ''

try {
  await mkdir(mediaDirectory, { recursive: true })
  await copyFile(sampleAudioPath, storedPath)
  await writeFile(
    join(dataDirectory, 'state.json'),
    `${JSON.stringify(
      {
        schemaVersion: 4,
        uiLanguage: 'zh',
        articles: [],
        listeningItems: [
          {
            id: 'abc123',
            title: 'Small.EN 本地试听样本',
            fileName: 'mia.wav',
            storedFileName,
            mimeType: 'audio/wav',
            bytes: sourceStats.size,
            importedAt: '2026-08-30T13:00:00.000Z',
            transcript: null
          }
        ],
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
    electronErrors = `${electronErrors}${chunk}`.slice(-8000)
  })

  const websocketUrl = await waitForPage(port)
  client = createCdpClient(websocketUrl)
  await client.ready
  await client.send('Runtime.enable')
  await client.send('Page.enable')

  const evaluation = await client.send('Runtime.evaluate', {
    expression: `(async () => {
      const waitFor = async (predicate, message, timeoutMs = 180000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const value = await predicate();
          if (value) return value;
          await new Promise((resolveWait) => setTimeout(resolveWait, 100));
        }
        throw new Error(message);
      };

      await waitFor(() => document.querySelector('.app-shell'), 'Application shell did not load');
      const listeningNav = [...document.querySelectorAll('nav button')].find((button) =>
        button.textContent.trim() === '听力'
      );
      if (!listeningNav) throw new Error('Listening navigation was not rendered');
      listeningNav.click();
      const row = await waitFor(() => document.querySelector('.listening-row'), 'Listening library row did not render');
      row.querySelector('.article-open-button').click();

      const workspace = await waitFor(
        () => document.querySelector('.listening-workspace'),
        'Focused listening workspace did not open'
      );
      const audio = await waitFor(
        () => {
          const candidate = workspace.querySelector('audio');
          return candidate?.src?.startsWith('data:audio/wav;base64,') ? candidate : null;
        },
        'Managed WAV did not load into the player'
      );
      const rateLabels = [...workspace.querySelectorAll('.listening-rate button')].map((button) =>
        button.textContent.trim()
      );
      if (rateLabels.join(',') !== '0.75×,1×,1.25×') throw new Error('Playback rates changed');
      if (workspace.querySelectorAll('.player-controls button').length !== 3) {
        throw new Error('Play and ten-second controls were not rendered');
      }

      const transcriptButton = workspace.querySelector('.transcript-toggle');
      transcriptButton.click();
      const readyButton = await waitFor(
        () => {
          const candidate = document.querySelector('.transcript-toggle');
          return candidate?.textContent.trim() === '展开逐句文本' ? candidate : null;
        },
        'Local Small.EN transcription did not complete'
      );
      const stateAfterTranscription = await window.originEnglish.loadState();
      const transcript = stateAfterTranscription.listeningItems[0].transcript;
      if (!transcript?.sentences?.length) throw new Error('Transcript was not persisted');
      readyButton.click();
      const sentenceRows = await waitFor(
        () => document.querySelectorAll('.sentence-row').length
          ? [...document.querySelectorAll('.sentence-row')]
          : null,
        'Sentence list did not expand'
      );
      if (sentenceRows.length !== transcript.sentences.length) {
        throw new Error('Rendered sentence count differs from persisted transcript');
      }

      const playbackProbe = [];
      HTMLMediaElement.prototype.play = function () {
        playbackProbe.push({ currentTime: this.currentTime, playbackRate: this.playbackRate });
        return Promise.resolve();
      };
      sentenceRows[0].querySelector('.sentence-play-button').click();
      await waitFor(() => playbackProbe.length === 1, 'Sentence play did not target the original audio');
      const expectedStart = transcript.sentences[0].startMs / 1000;
      if (Math.abs(playbackProbe[0].currentTime - expectedStart) > 0.05) {
        throw new Error('Sentence play did not seek to the stored start time');
      }

      const sentenceText = sentenceRows[0].querySelector('p');
      const match = /[A-Za-z]+(?:['’][A-Za-z]+)?/.exec(sentenceText.textContent ?? '');
      if (!match || !sentenceText.firstChild) throw new Error('No selectable transcript word was found');
      const range = document.createRange();
      range.setStart(sentenceText.firstChild, match.index);
      range.setEnd(sentenceText.firstChild, match.index + match[0].length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.querySelector('.transcript-panel').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      const definitionPanel = await waitFor(
        () => document.querySelector('.definition-panel .word-line')?.closest('.definition-panel'),
        'Transcript word did not open the dictionary card'
      );
      if (definitionPanel.querySelector('.panel-heading .icon-button')) {
        throw new Error('Listening dictionary card incorrectly includes original-sentence TTS');
      }
      if (definitionPanel.querySelector('.sentence-playback-controls')) {
        throw new Error('Listening dictionary card incorrectly includes sentence speed controls');
      }
      const saveButton = definitionPanel.querySelector('.primary-button.wide');
      saveButton.click();
      const finalState = await waitFor(async () => {
        const state = await window.originEnglish.loadState();
        return state.savedWords.length === 1 ? state : null;
      }, 'Transcript word was not saved to the notebook');
      const runtimeStatus = await window.originEnglish.getRuntimeStatus();
      if (runtimeStatus.liveMimoEnabled) throw new Error('MiMo was unexpectedly enabled');

      return JSON.stringify({
        audioSourcePrefix: audio.src.slice(0, 26),
        rateLabels,
        transcriptSentenceCount: transcript.sentences.length,
        transcriptText: transcript.sentences.map((sentence) => sentence.text).join(' '),
        firstSentence: transcript.sentences[0],
        sentencePlayback: playbackProbe[0],
        selectedWord: definitionPanel.querySelector('.word-line h2')?.textContent?.trim(),
        savedWordCount: finalState.savedWords.length,
        listeningCardHasSentenceTts: Boolean(definitionPanel.querySelector('.panel-heading .icon-button')),
        liveMimoEnabled: runtimeStatus.liveMimoEnabled
      });
    })()`,
    awaitPromise: true,
    returnByValue: true
  })

  const result = checkedValue(evaluation)
  const screenshot = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false
  })
  await mkdir(dirname(screenshotPath), { recursive: true })
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'))
  const persistedState = JSON.parse(await readFile(join(dataDirectory, 'state.json'), 'utf8'))
  if (!persistedState.listeningItems[0].transcript || persistedState.savedWords.length !== 1) {
    throw new Error('Listening state did not persist to disk')
  }
  console.log(JSON.stringify(result))
} catch (error) {
  if (electronErrors) console.error(electronErrors)
  throw error
} finally {
  if (client) void client.send('Browser.close').catch(() => undefined)
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
  if (resolvedTemporaryDirectory.startsWith(`${resolvedPrefix}\\origin-english-listening-`)) {
    await rm(resolvedTemporaryDirectory, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100
    })
  }
}
