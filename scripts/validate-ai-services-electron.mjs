import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const projectDirectory = resolve(import.meta.dirname, '..')
const artifactsDirectory = join(projectDirectory, 'artifacts')
const localScreenshotPath = join(artifactsDirectory, 'ai-services-local-mode.png')
const readyScreenshotPath = join(artifactsDirectory, 'ai-services-ready.png')
const readyPanelScreenshotPath = join(artifactsDirectory, 'ai-services-ready-panel.png')
const summaryPath = join(artifactsDirectory, 'ai-services-validation-summary.json')
const textKey = 'electron-text-key-not-real'
const audioKey = 'electron-audio-key-not-real'

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
      // Electron may still be starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error('Timed out waiting for the Electron renderer.')
}

function createCdpClient(websocketUrl) {
  const socket = new WebSocket(websocketUrl)
  const pending = new Map()
  const events = []
  let nextId = 1
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (!message.id) {
      events.push(message)
      return
    }
    if (!pending.has(message.id)) return
    const { resolvePending, rejectPending } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) rejectPending(new Error(message.error.message))
    else resolvePending(message.result)
  })
  return {
    socket,
    events,
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

async function saveScreenshot(client, filePath) {
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png' })
  await writeFile(filePath, Buffer.from(screenshot.data, 'base64'))
}

async function waitForProcessExit(childProcess, timeoutMs = 8_000) {
  if (childProcess.exitCode !== null) return
  await new Promise((resolveExit) => {
    const timeout = setTimeout(resolveExit, timeoutMs)
    childProcess.once('exit', () => {
      clearTimeout(timeout)
      resolveExit()
    })
  })
}

const userDataDirectory = await mkdtemp(join(tmpdir(), 'origin-ai-services-electron-'))
const dataDirectory = join(userDataDirectory, 'origin-english')
const settingsPath = join(dataDirectory, 'ai-services.json')
const port = await findFreePort()
const electronPath = join(projectDirectory, 'node_modules', 'electron', 'dist', 'electron.exe')
let electronProcess
let client
let electronErrors = ''

try {
  await mkdir(dataDirectory, { recursive: true })
  await writeFile(
    join(dataDirectory, 'state.json'),
    `${JSON.stringify(
      {
        schemaVersion: 4,
        uiLanguage: 'zh',
        articles: [],
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
    electronErrors = `${electronErrors}${chunk}`.slice(-8_000)
  })

  client = createCdpClient(await waitForPage(port))
  await client.ready
  await client.send('Runtime.enable')
  await client.send('Page.enable')
  await client.send('Network.enable')

  const localState = await evaluate(
    client,
    `(async () => {
      const waitFor = async (predicate, message, timeoutMs = 30000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const value = await predicate();
          if (value) return value;
          await new Promise((resolveWait) => setTimeout(resolveWait, 80));
        }
        throw new Error(message);
      };
      const dialog = await waitFor(
        () => document.querySelector('.ai-settings-dialog'),
        'AI onboarding did not open'
      );
      const body = dialog.innerText;
      for (const required of ['选择你需要的 AI 能力', '无需 API，始终可用', '本地 Small.EN 转写']) {
        if (!body.includes(required)) throw new Error('Missing onboarding copy: ' + required);
      }
      const status = await window.originEnglish.getRuntimeStatus();
      if (status.aiAvailability !== 'local' || status.aiOnboardingDismissed !== false) {
        throw new Error('Initial AI status is not local onboarding mode');
      }
      const statusButton = document.querySelector('.ai-service-button');
      if (!statusButton?.innerText.includes('本地模式')) throw new Error('Local status pill is missing');
      const topbar = document.querySelector('.topbar');
      const backdrop = document.querySelector('.ai-settings-backdrop');
      const topbarRect = topbar.getBoundingClientRect();
      const backdropRect = backdrop.getBoundingClientRect();
      const dialogRect = dialog.getBoundingClientRect();
      const statusStyle = getComputedStyle(statusButton);
      const dialogStyle = getComputedStyle(dialog);
      if (Math.abs(backdropRect.top - topbarRect.bottom) > 1) {
        throw new Error('AI settings backdrop overlaps or detaches from the title bar');
      }
      if (Math.abs(dialogRect.top - topbarRect.bottom) > 1 || Math.abs(dialogRect.right - innerWidth) > 1) {
        throw new Error('AI settings dialog is not attached below the title bar at the right edge');
      }
      if (parseFloat(statusStyle.borderRadius) < 14) {
        throw new Error('AI service status is not rendered as a rounded control');
      }
      if (dialogStyle.borderTopRightRadius !== '0px' || dialogStyle.borderBottomRightRadius !== '0px') {
        throw new Error('AI settings dialog does not join the right window edge cleanly');
      }
      return JSON.stringify({
        status,
        methods: Object.keys(window.originEnglish).filter((key) => key.toLowerCase().includes('ai')),
        bodyText: body,
        layout: {
          titlebarBottom: topbarRect.bottom,
          backdropTop: backdropRect.top,
          dialogTop: dialogRect.top,
          dialogRight: dialogRect.right,
          statusBorderRadius: statusStyle.borderRadius
        }
      });
    })()`
  )
  console.log('stage: local onboarding rendered')
  if (JSON.stringify(localState).includes(textKey) || JSON.stringify(localState).includes(audioKey)) {
    throw new Error('A test credential appeared before configuration.')
  }
  await saveScreenshot(client, localScreenshotPath)

  const compactLayout = await evaluate(
    client,
    `(async () => {
      const waitFor = async (predicate, message, timeoutMs = 5000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const value = predicate();
          if (value) return value;
          await new Promise((resolveWait) => setTimeout(resolveWait, 80));
        }
        throw new Error(message);
      };
      window.resizeTo(960, 800);
      await waitFor(() => innerWidth <= 1000, 'Electron window did not enter the compact width');
      const geometry = await waitFor(() => {
        const topbarBottom = document.querySelector('.topbar').getBoundingClientRect().bottom;
        const backdropTop = document.querySelector('.ai-settings-backdrop').getBoundingClientRect().top;
        const dialogRight = document.querySelector('.ai-settings-dialog').getBoundingClientRect().right;
        if (
          Math.abs(backdropTop - topbarBottom) <= 1 &&
          Math.abs(dialogRight - innerWidth) <= 1 &&
          document.documentElement.clientWidth === innerWidth
        ) {
          return { topbarBottom, backdropTop, dialogRight };
        }
        return null;
      }, 'Compact AI settings geometry did not settle below the title bar');
      window.resizeTo(1320, 880);
      await waitFor(() => innerWidth >= 1200, 'Electron window did not restore the desktop width');
      return JSON.stringify(geometry);
    })()`
  )
  console.log('stage: compact title bar geometry verified', compactLayout)

  const textOnlyState = await evaluate(
    client,
    `(async () => {
      const waitFor = async (predicate, message, timeoutMs = 30000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const value = await predicate();
          if (value) return value;
          await new Promise((resolveWait) => setTimeout(resolveWait, 80));
        }
        throw new Error(message);
      };
      const dialog = document.querySelector('.ai-settings-dialog');
      const provider = dialog.querySelector('select');
      provider.value = 'openai-compatible';
      provider.dispatchEvent(new Event('change', { bubbles: true }));
      await waitFor(() => dialog.querySelector('input[type="url"]'), 'Custom provider fields did not open');
      const url = dialog.querySelector('input[type="url"]');
      const fields = [...dialog.querySelectorAll('input[type="text"]')];
      const key = dialog.querySelector('input[type="password"]');
      const setValue = (input, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      setValue(url, 'https://models.example.test/v1');
      setValue(fields[0], 'learner-model');
      setValue(key, ${JSON.stringify(textKey)});
      dialog.querySelector('form').requestSubmit();
      await waitFor(() => !document.querySelector('.ai-settings-dialog'), 'Text settings did not save');
      await waitFor(
        () => document.querySelector('.ai-service-button')?.innerText.includes('文本 AI 已连接'),
        'Text-only status did not appear'
      );
      const status = await window.originEnglish.getRuntimeStatus();
      if (status.aiAvailability !== 'text-only' || status.textAiProvider !== 'openai-compatible') {
        throw new Error('Text-only runtime status is incorrect');
      }
      return JSON.stringify(status);
    })()`
  )
  console.log('stage: text AI configured')
  if (JSON.stringify(textOnlyState).includes(textKey)) {
    throw new Error('The runtime status returned the text test key.')
  }
  const textOnlySettings = await readFile(settingsPath, 'utf8')
  if (textOnlySettings.includes(textKey) || textOnlySettings.includes(audioKey)) {
    throw new Error('The settings file contains a plaintext test key.')
  }

  const readyState = await evaluate(
    client,
    `(async () => {
      const waitFor = async (predicate, message, timeoutMs = 30000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const value = await predicate();
          if (value) return value;
          await new Promise((resolveWait) => setTimeout(resolveWait, 80));
        }
        throw new Error(message);
      };
      document.querySelector('.ai-service-button').click();
      const dialog = await waitFor(() => document.querySelector('.ai-settings-dialog'), 'Settings did not reopen');
      const toggle = dialog.querySelector('.ai-toggle-row input');
      toggle.click();
      const audioKeyInput = await waitFor(
        () => [...dialog.querySelectorAll('input[type="password"]')][1],
        'Separate MiMo audio key field did not appear'
      );
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(audioKeyInput, ${JSON.stringify(audioKey)});
      audioKeyInput.dispatchEvent(new Event('input', { bubbles: true }));
      dialog.querySelector('form').requestSubmit();
      await waitFor(() => !document.querySelector('.ai-settings-dialog'), 'Ready settings did not save');
      await waitFor(
        () => document.querySelector('.ai-service-button')?.innerText.includes('全部就绪'),
        'Ready status did not appear'
      );
      const status = await window.originEnglish.getRuntimeStatus();
      if (status.aiAvailability !== 'ready' || !status.textAiEnabled || !status.sentenceAudioEnabled) {
        throw new Error('Ready runtime status is incorrect');
      }
      const readyButton = document.querySelector('.ai-service-button');
      const readyDot = readyButton?.querySelector(':scope > span:first-child');
      if (!readyDot || getComputedStyle(readyDot).backgroundColor !== 'rgb(79, 128, 105)') {
        throw new Error('Ready status light is not green');
      }
      return JSON.stringify(status);
    })()`
  )
  console.log('stage: natural voice configured')
  if (JSON.stringify(readyState).includes(textKey) || JSON.stringify(readyState).includes(audioKey)) {
    throw new Error('The ready runtime status returned a test key.')
  }
  const readySettings = await readFile(settingsPath, 'utf8')
  if (readySettings.includes(textKey) || readySettings.includes(audioKey)) {
    throw new Error('The ready settings file contains a plaintext test key.')
  }
  await saveScreenshot(client, readyScreenshotPath)

  await evaluate(
    client,
    `(async () => {
      const deadline = Date.now() + 5000;
      document.querySelector('.ai-service-button').click();
      while (Date.now() < deadline) {
        if (document.querySelector('.ai-settings-dialog')) return true;
        await new Promise((resolveWait) => setTimeout(resolveWait, 80));
      }
      throw new Error('Ready settings panel did not reopen for visual verification');
    })()`
  )
  await saveScreenshot(client, readyPanelScreenshotPath)
  await evaluate(
    client,
    `(async () => {
      const deadline = Date.now() + 5000;
      document.querySelector('.ai-settings-close').click();
      while (Date.now() < deadline) {
        if (!document.querySelector('.ai-settings-dialog')) return true;
        await new Promise((resolveWait) => setTimeout(resolveWait, 80));
      }
      throw new Error('Ready settings panel did not close after visual verification');
    })()`
  )

  const finalState = await evaluate(
    client,
    `(async () => {
      const waitFor = async (predicate, message, timeoutMs = 30000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const value = await predicate();
          if (value) return value;
          await new Promise((resolveWait) => setTimeout(resolveWait, 80));
        }
        throw new Error(message);
      };
      const en = [...document.querySelectorAll('.language-switch button')].find((button) => button.textContent.trim() === 'EN');
      en.click();
      await waitFor(() => document.querySelector('.ai-service-button')?.innerText.includes('All ready'), 'English status did not render');
      document.querySelector('.ai-service-button').click();
      const dialog = await waitFor(() => document.querySelector('.ai-settings-dialog'), 'English settings did not open');
      if (!dialog.innerText.includes('Always available locally') || !dialog.innerText.includes('Natural sentence audio')) {
        throw new Error('English AI settings copy is incomplete');
      }
      const disconnect = [...dialog.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Disconnect all AI services');
      disconnect.click();
      const confirm = await waitFor(
        () => [...dialog.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Disconnect and remove keys'),
        'Disconnect confirmation did not appear'
      );
      confirm.click();
      await waitFor(() => !document.querySelector('.ai-settings-dialog'), 'Disconnect did not close settings');
      await waitFor(() => document.querySelector('.ai-service-button')?.innerText.includes('Local mode'), 'Local mode did not return');
      const status = await window.originEnglish.getRuntimeStatus();
      if (status.aiAvailability !== 'local' || status.configurationSource !== 'stored') {
        throw new Error('Disconnect did not persist explicit local mode');
      }
      const state = await window.originEnglish.loadState();
      if (state.uiLanguage !== 'en' || state.schemaVersion !== 4) throw new Error('Local app state regressed');
      return JSON.stringify({ status, state });
    })()`
  )
  console.log('stage: English UI and disconnect verified')
  if (JSON.stringify(finalState).includes(textKey) || JSON.stringify(finalState).includes(audioKey)) {
    throw new Error('The final renderer result returned a test key.')
  }
  const finalSettings = await readFile(settingsPath, 'utf8')
  const stateFile = await readFile(join(dataDirectory, 'state.json'), 'utf8')
  for (const secret of [textKey, audioKey]) {
    if (finalSettings.includes(secret) || stateFile.includes(secret)) {
      throw new Error('A plaintext test key remained on disk after disconnect.')
    }
  }

  const externalRequests = client.events
    .filter((event) => event.method === 'Network.requestWillBeSent')
    .map((event) => event.params?.request?.url)
    .filter((url) => /^https?:/i.test(url))
    .filter((url) => !url.startsWith(`http://127.0.0.1:${port}/`))
  if (externalRequests.length) {
    throw new Error(`Unexpected external requests: ${externalRequests.join(', ')}`)
  }

  const summary = {
    checkedAt: new Date().toISOString(),
    initial: localState.status.aiAvailability,
    textOnly: textOnlyState.aiAvailability,
    ready: readyState.aiAvailability,
    final: finalState.status.aiAvailability,
    secureStorageAvailable: readyState.secureStorageAvailable,
    externalRequestCount: externalRequests.length,
    plaintextCredentialFound: false,
    screenshots: [localScreenshotPath, readyScreenshotPath, readyPanelScreenshotPath]
  }
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ...summary, summaryPath }, null, 2))
} finally {
  client?.socket.close()
  if (electronProcess && electronProcess.exitCode === null) {
    electronProcess.kill()
    await waitForProcessExit(electronProcess)
    if (electronProcess.exitCode === null) electronProcess.kill('SIGKILL')
  }
  await rm(userDataDirectory, { recursive: true, force: true })
  if (electronErrors.trim()) process.stderr.write(electronErrors)
}
