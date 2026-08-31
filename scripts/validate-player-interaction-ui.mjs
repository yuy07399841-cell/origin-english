import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const projectDirectory = resolve(import.meta.dirname, '..')
const sampleAudioPath = join(projectDirectory, 'artifacts', 'tts-audition', 'mia.wav')
const listeningScreenshotPath = join(projectDirectory, 'artifacts', 'player-interaction-ui.png')
const readingScreenshotPath = join(projectDirectory, 'artifacts', 'reading-right-panel-ui.png')

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

function checkedValue(evaluation) {
  if (evaluation.exceptionDetails) {
    throw new Error(
      evaluation.exceptionDetails.exception?.description ?? evaluation.exceptionDetails.text
    )
  }
  return JSON.parse(evaluation.result.value)
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

const firstSentences = [
  {
    id: 'sentence-one',
    text: 'The first sentence has a padded ending.',
    startMs: 0,
    endMs: 2000
  },
  {
    id: 'sentence-two',
    text: 'The second sentence starts inside that padded ending.',
    startMs: 1800,
    endMs: 4000
  }
]
const remainingSentences = Array.from({ length: 485 }, (_, index) => ({
  id: `sentence-${index + 3}`,
  text: `Layout validation sentence ${index + 3}.`,
  startMs: 4000 + index * 2,
  endMs: 4001 + index * 2
}))
const sentences = [...firstSentences, ...remainingSentences]
const temporaryPrefix = join(tmpdir(), 'origin-english-player-ui-')
const userDataDirectory = await mkdtemp(temporaryPrefix)
const dataDirectory = join(userDataDirectory, 'origin-english')
const mediaDirectory = join(dataDirectory, 'listening-media')
const storedFileName = 'audio-acde017.wav'
const sourceStats = await stat(sampleAudioPath)
const port = await findFreePort()
const electronPath = join(projectDirectory, 'node_modules', 'electron', 'dist', 'electron.exe')
let electronProcess
let client
let electronErrors = ''

try {
  await mkdir(mediaDirectory, { recursive: true })
  await copyFile(sampleAudioPath, join(mediaDirectory, storedFileName))
  await writeFile(
    join(dataDirectory, 'state.json'),
    `${JSON.stringify(
      {
        schemaVersion: 4,
        uiLanguage: 'zh',
        articles: [
          {
            id: 'layout-article',
            title: 'A calm reading layout',
            fileName: 'calm-reading.md',
            markdown:
              '# A calm reading layout\n\nThe article should remain the primary reading surface while a dictionary card stays on the right.',
            importedAt: '2026-08-31T08:30:00.000Z'
          }
        ],
        listeningItems: [
          {
            id: 'player-ui',
            title: '播放器交互验收',
            fileName: 'mia.wav',
            storedFileName,
            mimeType: 'audio/wav',
            bytes: sourceStats.size,
            importedAt: '2026-08-31T08:30:00.000Z',
            transcript: {
              model: 'small.en',
              durationMs: 5000,
              createdAt: '2026-08-31T08:30:00.000Z',
              sentences
            }
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
  const readyDeadline = Date.now() + 30_000
  let rendererReady = false
  while (Date.now() < readyDeadline && !rendererReady) {
    try {
      const readyEvaluation = await client.send('Runtime.evaluate', {
        expression:
          "document.readyState === 'complete' && Boolean(window.originEnglish) && Boolean(document.querySelector('.app-shell'))",
        returnByValue: true
      })
      rendererReady = readyEvaluation.result.value === true
    } catch {
      // The initial about:blank context can disappear while the final renderer loads.
    }
    if (!rendererReady) await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  if (!rendererReady) throw new Error('Timed out waiting for the complete application renderer.')

  const listeningEvaluation = await client.send('Runtime.evaluate', {
    expression: `(async () => {
      const waitFor = async (predicate, message, timeoutMs = 30000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const value = await predicate();
          if (value) return value;
          await new Promise((resolveWait) => setTimeout(resolveWait, 50));
        }
        throw new Error(message);
      };
      const press = (target, key, code, repeat = false) => {
        const event = new KeyboardEvent('keydown', {
          key,
          code,
          repeat,
          bubbles: true,
          cancelable: true
        });
        const allowed = target.dispatchEvent(event);
        return { allowed, defaultPrevented: event.defaultPrevented };
      };

      await waitFor(
        () => document.readyState === 'complete' && window.originEnglish && document.querySelector('.app-shell'),
        'Application shell did not load'
      );
      const listeningNav = [...document.querySelectorAll('nav button')].find(
        (button) => button.textContent.trim() === '听力'
      );
      if (!listeningNav) throw new Error('Listening navigation was not rendered');
      listeningNav.click();
      const row = await waitFor(() => document.querySelector('.listening-row'), 'Listening row did not render');
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
        'Managed WAV did not load'
      );
      let fakePaused = true;
      Object.defineProperty(audio, 'paused', { configurable: true, get: () => fakePaused });
      audio.play = function () {
        fakePaused = false;
        this.dispatchEvent(new Event('play'));
        return Promise.resolve();
      };
      audio.pause = function () {
        fakePaused = true;
        this.dispatchEvent(new Event('pause'));
      };

      const transcriptButton = workspace.querySelector('.transcript-toggle');
      transcriptButton.click();
      const transcriptPanel = await waitFor(
        () => document.querySelector('.transcript-panel'),
        'Transcript panel did not expand'
      );
      const rows = [...transcriptPanel.querySelectorAll('.sentence-row')];
      if (rows.length !== 487) throw new Error('The 487-sentence layout fixture did not render');

      const count = transcriptPanel.querySelector('.sentence-count');
      const countNumber = count?.querySelector('.sentence-count-number');
      const countUnit = count?.querySelector('.sentence-count-unit');
      if (countNumber?.textContent !== '487' || countUnit?.textContent.trim() !== '句话') {
        throw new Error('Sentence count was not split into number and unit');
      }
      const countStyle = getComputedStyle(count);
      if (countStyle.alignItems !== 'baseline' || /Georgia/i.test(countStyle.fontFamily)) {
        throw new Error('Sentence count does not use the unified baseline layout');
      }

      const controls = [...workspace.querySelectorAll('.player-controls button')];
      const seekControls = controls.filter((button) => button.classList.contains('seek-control'));
      const playToggle = workspace.querySelector('.play-toggle');
      if (
        controls.length !== 3 ||
        seekControls.length !== 2 ||
        !playToggle?.querySelector('svg') ||
        seekControls.some((button) => button.querySelector('svg'))
      ) {
        throw new Error('Player controls do not use plain seek labels with an icon-only play button');
      }
      const seekLabels = seekControls.map(
        (button) => button.querySelector('.seek-ten-label')?.textContent
      );
      if (seekLabels.join(',') !== '−10,+10') {
        throw new Error('Seek controls do not show minus and plus ten labels');
      }
      const seekLabelCenterOffsets = seekControls.map((button) => {
        const buttonRect = button.getBoundingClientRect();
        const labelRect = button.querySelector('.seek-ten-label').getBoundingClientRect();
        return {
          x: Math.abs(labelRect.left + labelRect.width / 2 - (buttonRect.left + buttonRect.width / 2)),
          y: Math.abs(labelRect.top + labelRect.height / 2 - (buttonRect.top + buttonRect.height / 2))
        };
      });
      if (seekLabelCenterOffsets.some(({ x, y }) => x > 0.5 || y > 0.5)) {
        throw new Error('Seek labels are not centered in their buttons');
      }
      if (playToggle.getAttribute('aria-label') !== '播放') throw new Error('Initial play icon state is wrong');

      if (transcriptPanel.querySelector('.sentence-play-button')) {
        throw new Error('The removed sentence play control is still rendered');
      }
      const timeButtons = [...transcriptPanel.querySelectorAll('.sentence-time-button')];
      if (timeButtons.length !== rows.length) throw new Error('Each sentence needs one time navigation control');
      const secondButton = timeButtons[1];
      secondButton.click();
      secondButton.focus();
      await waitFor(
        () => rows[1].classList.contains('active') && !rows[0].classList.contains('active'),
        'Time navigation did not highlight the most recently started sentence'
      );
      await waitFor(
        () => playToggle.getAttribute('aria-label') === '暂停',
        'Play icon did not change to pause'
      );

      const firstSpace = press(secondButton, ' ', 'Space');
      await waitFor(() => playToggle.getAttribute('aria-label') === '播放', 'Space did not pause playback');
      if (!firstSpace.defaultPrevented || firstSpace.allowed) throw new Error('Space default action was not prevented');
      if (!rows[1].classList.contains('active')) throw new Error('Paused timeline highlight changed unexpectedly');

      const secondSpace = press(secondButton, ' ', 'Space');
      await waitFor(() => playToggle.getAttribute('aria-label') === '暂停', 'Space did not resume playback');
      if (!secondSpace.defaultPrevented || secondSpace.allowed) throw new Error('Resume space was not consumed');
      if (!rows[1].classList.contains('active')) throw new Error('Resumed timeline highlight changed unexpectedly');

      const repeatedSpace = press(secondButton, ' ', 'Space', true);
      if (repeatedSpace.defaultPrevented || playToggle.getAttribute('aria-label') !== '暂停') {
        throw new Error('Repeated space toggled playback');
      }

      audio.currentTime = 4.2;
      audio.dispatchEvent(new Event('timeupdate'));
      await new Promise((resolveWait) => setTimeout(resolveWait, 75));
      if (playToggle.getAttribute('aria-label') !== '暂停' || fakePaused) {
        throw new Error('Main audio stopped at a sentence end instead of continuing');
      }

      const left = press(secondButton, 'ArrowLeft', 'ArrowLeft');
      await waitFor(
        () => rows[0].classList.contains('active') && Math.abs(audio.currentTime) < 0.05,
        'Left arrow did not seek back ten seconds and restore timeline highlighting'
      );
      if (!left.defaultPrevented || left.allowed) throw new Error('Left arrow default action was not prevented');
      const leftArrowTime = audio.currentTime;
      const right = press(secondButton, 'ArrowRight', 'ArrowRight');
      await waitFor(() => audio.currentTime > 0.5, 'Right arrow did not seek forward ten seconds');
      if (!right.defaultPrevented || right.allowed) throw new Error('Right arrow default action was not prevented');
      const rightArrowTime = audio.currentTime;
      press(secondButton, 'ArrowLeft', 'ArrowLeft');
      await waitFor(() => Math.abs(audio.currentTime) < 0.05, 'Second left arrow did not return to the start');
      secondButton.click();
      await waitFor(
        () => rows[1].classList.contains('active') && playToggle.getAttribute('aria-label') === '暂停',
        'Final screenshot state did not return to the clicked second sentence'
      );

      const listeningPanel = document.querySelector('.focused-listening-layout > .definition-panel');
      const numberRect = countNumber.getBoundingClientRect();
      const unitRect = countUnit.getBoundingClientRect();
      return JSON.stringify({
        sentenceCount: rows.length,
        activeAfterTimeNavigation: 2,
        continuousPastSentenceEnd: !fakePaused,
        shortcutSpacePrevented: firstSpace.defaultPrevented,
        repeatedSpaceIgnored: !repeatedSpace.defaultPrevented,
        leftArrowCurrentTime: leftArrowTime,
        rightArrowCurrentTime: rightArrowTime,
        seekLabels,
        seekLabelCenterOffsets,
        playerLabels: controls.map((button) => button.getAttribute('aria-label')),
        countFontFamily: countStyle.fontFamily,
        countAlignItems: countStyle.alignItems,
        countBottomDifference: Math.abs(numberRect.bottom - unitRect.bottom),
        viewportWidth: window.innerWidth,
        listeningPanelWidth: listeningPanel.getBoundingClientRect().width,
        listeningPanelStickyTop: getComputedStyle(listeningPanel).top
      });
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  const listeningResult = checkedValue(listeningEvaluation)
  const listeningScreenshot = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false
  })
  await mkdir(dirname(listeningScreenshotPath), { recursive: true })
  await writeFile(listeningScreenshotPath, Buffer.from(listeningScreenshot.data, 'base64'))

  const readingEvaluation = await client.send('Runtime.evaluate', {
    expression: `(async () => {
      const waitFor = async (predicate, message, timeoutMs = 30000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const value = await predicate();
          if (value) return value;
          await new Promise((resolveWait) => setTimeout(resolveWait, 50));
        }
        throw new Error(message);
      };
      document.querySelector('.back-button').click();
      const readingNav = await waitFor(
        () => [...document.querySelectorAll('nav button')].find((button) => button.textContent.trim() === '阅读'),
        'Reading navigation did not return'
      );
      readingNav.click();
      await waitFor(() => readingNav.classList.contains('active'), 'Reading view did not become active');
      const articleButton = await waitFor(
        () => document.querySelector('.article-row .article-open-button'),
        'Article row did not render'
      );
      articleButton.click();
      const layout = await waitFor(
        () => document.querySelector('.focused-reading-layout'),
        'Focused reading layout did not open'
      );
      const article = layout.querySelector('.focused-article-column');
      const panel = layout.querySelector('.definition-panel');
      const articleRect = article.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      if (articleRect.left >= panelRect.left || articleRect.right >= panelRect.left) {
        throw new Error('Reading dictionary panel is not to the right of the article');
      }
      if (Math.abs(panelRect.width - 340) > 1) throw new Error('Reading panel width is not 340px');
      if (getComputedStyle(panel).top !== '76px') throw new Error('Reading panel sticky top differs from listening');
      return JSON.stringify({
        viewportWidth: window.innerWidth,
        articleLeft: articleRect.left,
        articleRight: articleRect.right,
        panelLeft: panelRect.left,
        panelWidth: panelRect.width,
        panelStickyTop: getComputedStyle(panel).top,
        gridTemplateColumns: getComputedStyle(layout).gridTemplateColumns
      });
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  const readingResult = checkedValue(readingEvaluation)
  const readingScreenshot = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false
  })
  await writeFile(readingScreenshotPath, Buffer.from(readingScreenshot.data, 'base64'))

  console.log(
    JSON.stringify({
      listening: listeningResult,
      reading: readingResult,
      screenshots: [listeningScreenshotPath, readingScreenshotPath]
    })
  )
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
  if (resolvedTemporaryDirectory.startsWith(`${resolvedPrefix}\\origin-english-player-ui-`)) {
    await rm(resolvedTemporaryDirectory, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100
    })
  }
}
