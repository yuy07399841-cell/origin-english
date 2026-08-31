import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const projectDirectory = resolve(import.meta.dirname, '..')
const sampleAudioPath = join(
  projectDirectory,
  'artifacts',
  'tts-audition-long-sentence-165wpm',
  'mia-long-sentence-165wpm.wav'
)
const libraryScreenshotPath = join(projectDirectory, 'artifacts', 'article-library-ui.png')
const focusedScreenshotPath = join(projectDirectory, 'artifacts', 'focused-reading-ui.png')
const notebookScreenshotPath = join(projectDirectory, 'artifacts', 'sentence-audio-speeds-ui.png')
const sentence =
  'Although I had planned to leave early, I stayed by the window for a few more minutes, listening to the rain against the glass and wondering whether she would call before the last train left the station.'
const model = 'mimo-v2.5-tts'
const voice = 'Mia'
const style =
  'Read this sentence naturally at a steady, slightly relaxed pace of about 165 words per minute. Keep the same pace from beginning to end. Do not speed up in the final clause; keep it unhurried and clear.'

function cacheKey() {
  return createHash('sha256')
    .update([model, voice, style, sentence].join('\u0000'))
    .digest('hex')
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
      const page = pages.find((candidate) => candidate.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      // Electron may not have opened the DevTools endpoint yet.
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

const temporaryPrefix = join(tmpdir(), 'origin-english-sentence-audio-')
const userDataDirectory = await mkdtemp(temporaryPrefix)
const appDataDirectory = join(userDataDirectory, 'origin-english')
const cacheDirectory = join(appDataDirectory, 'sentence-audio-cache')
const port = await findFreePort()
const packagedExecutablePath = process.env.ORIGIN_ENGLISH_EXECUTABLE_PATH?.trim()
const electronPath = packagedExecutablePath
  ? resolve(packagedExecutablePath)
  : join(projectDirectory, 'node_modules', 'electron', 'dist', 'electron.exe')
const electronArguments = packagedExecutablePath
  ? [`--remote-debugging-port=${port}`]
  : [`.`, `--remote-debugging-port=${port}`]
let electronProcess
let client
let electronErrors = ''

try {
  await mkdir(cacheDirectory, { recursive: true })
  await copyFile(sampleAudioPath, join(cacheDirectory, `${cacheKey()}.wav`))
  await writeFile(
    join(appDataDirectory, 'state.json'),
    `${JSON.stringify(
      {
        schemaVersion: 4,
        uiLanguage: 'zh',
        articles: [
          {
            id: 'sentence-audio-validation-article',
            title: 'Natural sentence audio',
            fileName: 'sentence-audio-validation.md',
            markdown: `# Natural sentence audio\n\n${sentence}`,
            importedAt: '2026-08-30T08:00:00.000Z'
          },
          {
            id: 'second-validation-article',
            title: 'The habit of noticing',
            fileName: 'the-habit-of-noticing.md',
            markdown:
              '# The habit of noticing\n\nReading slowly helps us notice how a sentence moves and where its meaning changes.',
            importedAt: '2026-08-29T08:00:00.000Z'
          }
        ],
        listeningItems: [],
        savedWords: [
          {
            id: 'sentence-audio-validation-word',
            word: 'wondering',
            sentence,
            partOfSpeech: 'verb',
            definition: 'Thinking about something because you want to know more.',
            usage: 'The original sentence uses wondering for a continuing thought.',
            articleId: 'sentence-audio-validation-article',
            savedAt: '2026-08-30T08:05:00.000Z'
          }
        ],
        lookupEvents: []
      },
      null,
      2
    )}\n`,
    'utf8'
  )

  electronProcess = spawn(electronPath, electronArguments, {
    cwd: projectDirectory,
    env: {
      ...process.env,
      MIMO_API_KEY: 'sentence-audio-validation-placeholder',
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

  const libraryEvaluation = await client.send('Runtime.evaluate', {
    expression: `(async () => {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline && document.querySelectorAll('.article-row').length !== 2) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const rows = [...document.querySelectorAll('.article-row')];
      if (rows.length !== 2) throw new Error('The two-article library was not rendered');
      const bodyText = document.body.innerText;
      const forbidden = [
        '本地英英词典＋英汉词典',
        'MiMo Mia · 首次生成后保存在本机',
        '这些内容足够帮助你理解这个句子吗？'
      ];
      if (forbidden.some((text) => bodyText.includes(text))) {
        throw new Error('Removed temporary product copy is still visible in the library');
      }
      const state = await window.originEnglish.loadState();
      if (state.schemaVersion !== 4 || state.articles.length !== 2) {
        throw new Error('The renderer did not load a version 4 article library');
      }
      return JSON.stringify({
        titles: rows.map((row) => row.querySelector('strong')?.textContent?.trim()),
        articleCount: state.articles.length,
        schemaVersion: state.schemaVersion,
        hasPrimaryImport: Boolean(document.querySelector('.topbar-import.primary-button')),
        hasStatusBanner: Boolean(document.querySelector('.preview-banner'))
      });
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (libraryEvaluation.exceptionDetails) {
    throw new Error(
      libraryEvaluation.exceptionDetails.exception?.description ??
        libraryEvaluation.exceptionDetails.text
    )
  }
  const libraryScreenshot = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false
  })
  await mkdir(dirname(libraryScreenshotPath), { recursive: true })
  await writeFile(libraryScreenshotPath, Buffer.from(libraryScreenshot.data, 'base64'))
  await client.send('Runtime.evaluate', {
    expression: `document.querySelector('.article-row')?.click()`,
    returnByValue: true
  })

  const evaluation = await client.send('Runtime.evaluate', {
    expression: `(async () => {
      const waitFor = async (predicate, message, timeoutMs = 30000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const value = predicate();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error(message);
      };

      await waitFor(() => document.querySelector('article.reading-paper'), 'Reading article was not rendered');
      const probe = { plays: [], systemSpeechCount: 0, lastAudio: null };
      window.__sentenceAudioProbe = probe;
      HTMLMediaElement.prototype.play = function () {
        probe.lastAudio = this;
        probe.plays.push({
          sourcePrefix: this.src.slice(0, 24),
          playbackRate: this.playbackRate,
          preservesPitch: this.preservesPitch
        });
        return Promise.resolve();
      };
      window.speechSynthesis.speak = () => {
        probe.systemSpeechCount += 1;
      };

      const article = document.querySelector('article.reading-paper');
      const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
      let textNode = null;
      let start = -1;
      while (walker.nextNode()) {
        const content = walker.currentNode.textContent ?? '';
        const match = /\\bwondering\\b/i.exec(content);
        if (match) {
          textNode = walker.currentNode;
          start = match.index;
          break;
        }
      }
      if (!textNode) throw new Error('Validation word was not found');
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, start + 'wondering'.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      article.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

      const panel = await waitFor(
        () => document.querySelector('.definition-panel blockquote')?.textContent?.includes('Although')
          ? document.querySelector('.definition-panel')
          : null,
        'Definition panel was not rendered'
      );
      const readingListen = panel.querySelector('.panel-heading .icon-button');
      if (!readingListen || readingListen.disabled) throw new Error('Reading sentence audio was unavailable');
      readingListen.click();
      await waitFor(() => probe.plays.length === 1, 'Normal reading audio did not play');

      const slowerButton = [...panel.querySelectorAll('.sentence-playback-controls button')].find(
        (button) => button.textContent.trim().startsWith('稍慢')
      );
      if (!slowerButton) throw new Error('Slower sentence speed was not found');
      slowerButton.click();
      await waitFor(
        () => slowerButton.getAttribute('aria-pressed') === 'true',
        'Slower sentence speed did not become active'
      );
      if (probe.lastAudio.playbackRate !== 0.9 || probe.lastAudio.preservesPitch !== true) {
        throw new Error('Active sentence audio did not switch to 0.9 with pitch preservation');
      }
      readingListen.click();
      await waitFor(() => probe.plays.length === 2, 'Slower reading audio did not play');

      const articleRect = article.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      if (panelRect.left >= articleRect.left) {
        throw new Error('The definition panel is not to the left of the article');
      }
      if (document.querySelector('.topbar, .topbar-import, nav')) {
        throw new Error('Global application chrome remained visible in focused reading');
      }
      if (!document.querySelector('.back-button')) {
        throw new Error('The focused reader has no back button');
      }
      if (panel.querySelector('.panel-heading .eyebrow')?.textContent?.trim() !== '原句') {
        throw new Error('The sentence label was not changed to 原句');
      }
      const focusedText = document.body.innerText;
      if (
        focusedText.includes('MiMo Mia · 首次生成后保存在本机') ||
        focusedText.includes('这些内容足够帮助你理解这个句子吗？')
      ) {
        throw new Error('Removed explanation copy remained visible in focused reading');
      }
      return JSON.stringify({
        readingSentence: panel.querySelector('blockquote')?.textContent?.trim(),
        playback: probe.plays,
        systemSpeechCount: probe.systemSpeechCount,
        panelLeft: panelRect.left,
        articleLeft: articleRect.left,
        activeSpeedLabels: [...panel.querySelectorAll('.sentence-playback-controls button')].map((button) => ({
          label: button.textContent.trim(),
          pressed: button.getAttribute('aria-pressed')
        }))
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
  const focusedScreenshot = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false
  })
  await writeFile(focusedScreenshotPath, Buffer.from(focusedScreenshot.data, 'base64'))

  const notebookEvaluation = await client.send('Runtime.evaluate', {
    expression: `(async () => {
      const waitFor = async (predicate, message, timeoutMs = 30000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const value = predicate();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error(message);
      };
      const probe = window.__sentenceAudioProbe;
      document.querySelector('.back-button')?.click();
      await waitFor(() => document.querySelectorAll('.article-row').length === 2, 'Back did not restore the article library');
      const notebookButton = [...document.querySelectorAll('nav button')].find((button) =>
        button.textContent.includes('生词本')
      );
      if (!notebookButton) throw new Error('Notebook navigation was not found after returning');
      notebookButton.click();
      const detail = await waitFor(() => document.querySelector('.word-detail'), 'Notebook detail was not rendered');
      const notebookListen = [...detail.querySelectorAll('button')].find(
        (button) => button.textContent.trim() === '朗读原句'
      );
      if (!notebookListen || notebookListen.disabled) throw new Error('Notebook sentence audio was unavailable');
      notebookListen.click();
      await waitFor(() => probe.plays.length === 3, 'Notebook sentence audio did not play');

      const normalButton = [...detail.querySelectorAll('.sentence-playback-controls button')].find(
        (button) => button.textContent.trim().startsWith('正常')
      );
      if (!normalButton) throw new Error('Normal sentence speed was not found');
      normalButton.click();
      await waitFor(
        () => normalButton.getAttribute('aria-pressed') === 'true',
        'Normal sentence speed did not become active'
      );
      notebookListen.click();
      await waitFor(() => probe.plays.length === 4, 'Normal notebook sentence audio did not play');

      const runtimeStatus = await window.originEnglish.getRuntimeStatus();
      if (runtimeStatus.sentenceAudioGenerationCount !== 0) {
        throw new Error('The cache-only UI validation unexpectedly generated sentence audio');
      }
      return JSON.stringify({
        notebookWord: detail.querySelector('h2')?.textContent?.trim(),
        playback: probe.plays,
        systemSpeechCount: probe.systemSpeechCount,
        runtimeStatus,
        activeSpeedLabels: [...detail.querySelectorAll('.sentence-playback-controls button')].map((button) => ({
          label: button.textContent.trim(),
          pressed: button.getAttribute('aria-pressed')
        }))
      });
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (notebookEvaluation.exceptionDetails) {
    throw new Error(
      notebookEvaluation.exceptionDetails.exception?.description ??
        notebookEvaluation.exceptionDetails.text
    )
  }
  const notebookScreenshot = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false
  })
  await writeFile(notebookScreenshotPath, Buffer.from(notebookScreenshot.data, 'base64'))
  console.log(
    JSON.stringify({
      library: JSON.parse(libraryEvaluation.result.value),
      focusedReading: JSON.parse(evaluation.result.value),
      notebook: JSON.parse(notebookEvaluation.result.value)
    })
  )
  void client.send('Browser.close').catch(() => undefined)
  await waitForProcessExit(electronProcess)
} catch (error) {
  if (electronErrors) console.error(electronErrors)
  throw error
} finally {
  client?.socket.close()
  if (electronProcess && electronProcess.exitCode === null) {
    electronProcess.kill()
    await waitForProcessExit(electronProcess)
  }
  const resolvedTemporaryDirectory = resolve(userDataDirectory)
  const resolvedPrefix = resolve(tmpdir())
  if (
    resolvedTemporaryDirectory.startsWith(`${resolvedPrefix}\\origin-english-sentence-audio-`)
  ) {
    await rm(resolvedTemporaryDirectory, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100
    })
  }
}
