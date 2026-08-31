import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const websocketUrl = process.argv[2]
const screenshotPath = process.argv[3]

if (!websocketUrl) {
  throw new Error('Usage: node validate-notebook-audio-ui.mjs <websocket-url> [screenshot-path]')
}

const socket = new WebSocket(websocketUrl)
const pending = new Map()
let nextId = 1

socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (!message.id || !pending.has(message.id)) return
  const { resolve, reject } = pending.get(message.id)
  pending.delete(message.id)
  if (message.error) reject(new Error(message.error.message))
  else resolve(message.result)
})

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

function send(method, params = {}) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

await send('Runtime.enable')
await send('Page.enable')
const evaluation = await send('Runtime.evaluate', {
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

    const notebookButton = await waitFor(
      () => [...document.querySelectorAll('nav button')].find((button) =>
        button.textContent.includes('生词本')
      ),
      'Notebook navigation was not found'
    );
    notebookButton.click();

    const detail = await waitFor(
      () => document.querySelector('.word-detail'),
      'Notebook word detail was not rendered'
    );
    const selectedWord = detail.querySelector('h2')?.textContent?.trim();
    const sentence = detail.querySelector('blockquote')?.textContent?.trim();
    if (selectedWord !== 'subtle') throw new Error('Unexpected selected notebook word');

    const probe = { mediaPlays: [], systemSpeechCount: 0 };
    window.__notebookAudioProbe = probe;
    HTMLMediaElement.prototype.play = function () {
      probe.mediaPlays.push({
        sourcePrefix: this.src.slice(0, 32),
        playbackRate: this.playbackRate,
        preservesPitch: this.preservesPitch
      });
      return Promise.resolve();
    };
    window.speechSynthesis.speak = () => {
      probe.systemSpeechCount += 1;
    };

    const wordAudioButton = [...detail.querySelectorAll('button')].find(
      (button) => button.textContent.trim() === '单词发音'
    );
    if (!wordAudioButton) throw new Error('Dictionary word-audio button was not found');
    wordAudioButton.click();

    const attribution = await waitFor(
      () => detail.querySelector('.audio-attribution')?.textContent?.trim(),
      'Dictionary recording attribution was not rendered'
    );
    const afterWordAudio = {
      mediaPlayCount: probe.mediaPlays.length,
      systemSpeechCount: probe.systemSpeechCount
    };

    const sentenceButton = [...detail.querySelectorAll('button')].find(
      (button) => button.textContent.trim() === '朗读原句'
    );
    if (!sentenceButton || sentenceButton.disabled) {
      throw new Error('MiMo sentence-audio button was not available');
    }
    sentenceButton.click();
    await waitFor(
      () => probe.mediaPlays.length === 2,
      'MiMo sentence audio was not played'
    );

    const slowerButton = [...detail.querySelectorAll('.sentence-playback-controls button')].find(
      (button) => /^(稍慢|Slower)/.test(button.textContent.trim())
    );
    if (!slowerButton) throw new Error('Slower sentence speed was not found');
    slowerButton.click();
    await waitFor(
      () => slowerButton.getAttribute('aria-pressed') === 'true',
      'Slower sentence speed did not become active'
    );
    sentenceButton.click();
    await waitFor(
      () => probe.mediaPlays.length === 3,
      'Slower MiMo sentence audio was not played'
    );

    return JSON.stringify({
      selectedWord,
      sentence,
      wordAudioButton: wordAudioButton.textContent.trim(),
      sentenceAudioButton: sentenceButton.textContent.trim(),
      attribution,
      afterWordAudio,
      mediaPlays: probe.mediaPlays,
      finalSystemSpeechCount: probe.systemSpeechCount,
      runtimeStatus: await window.originEnglish.getRuntimeStatus()
    });
  })()`,
  awaitPromise: true,
  returnByValue: true
})

if (screenshotPath) {
  const screenshot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false
  })
  await mkdir(dirname(screenshotPath), { recursive: true })
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'))
}

socket.close()
if (evaluation.exceptionDetails) {
  throw new Error(evaluation.exceptionDetails.exception?.description ?? evaluation.exceptionDetails.text)
}
console.log(evaluation.result.value)
