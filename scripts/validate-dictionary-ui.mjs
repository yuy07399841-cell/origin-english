import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const websocketUrl = process.argv[2]
const screenshotPath = process.argv[3]
const selectedWord = process.argv[4] ?? 'noticing'

if (!websocketUrl) {
  throw new Error('Usage: node validate-dictionary-ui.mjs <websocket-url> [screenshot-path]')
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
    const waitFor = async (predicate, message, timeoutMs = 20000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const value = predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(message);
    };

    const article = await waitFor(
      () => document.querySelector('article.reading-paper'),
      'Reading article was not found'
    );
    const target = ${JSON.stringify(selectedWord)};
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
    if (!textNode || start < 0) throw new Error('Validation word was not found');

    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + target.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    article.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    await waitFor(
      () =>
        document.querySelector('.source-badge')?.textContent?.includes('Simple English Wiktionary') &&
        document.querySelector('.word-line h2')?.textContent?.trim().toLowerCase() === target.toLowerCase(),
      'Local dictionary result was not rendered'
    );

    const panel = document.querySelector('.definition-panel');
    const wordAudioButton = [...panel.querySelectorAll('button')].find(
      (button) => button.textContent.trim() === 'Word audio'
    );
    const chineseHintButton = [...panel.querySelectorAll('button')].find(
      (button) => button.textContent.trim() === 'Show Chinese hint'
    );
    const hintWasHidden = panel.querySelector('.chinese-hint') === null;
    const audioResult = await window.originEnglish.getWordAudio(target);
    const audio = new Audio(audioResult.dataUrl);
    const runtimeStatus = await window.originEnglish.getRuntimeStatus();

    return JSON.stringify({
      selectedText: selection.toString(),
      runtimeStatus,
      sourceBadge: panel.querySelector('.source-badge')?.textContent?.trim(),
      word: panel.querySelector('.word-line h2')?.textContent?.trim(),
      partOfSpeech: panel.querySelector('.word-line span')?.textContent?.trim(),
      phonetic: panel.querySelector('.word-line i')?.textContent?.trim() ?? null,
      definition: panel.querySelector('.definition-copy')?.textContent?.trim(),
      usage: panel.querySelector('.usage-box p')?.textContent?.trim() ?? null,
      wordAudioButtonVisible: Boolean(wordAudioButton),
      chineseHintButtonVisible: Boolean(chineseHintButton),
      chineseHintHiddenByDefault: hintWasHidden,
      audioMimeSupport: audio.canPlayType('audio/ogg'),
      audioDataUrlPrefix: audioResult.dataUrl.slice(0, 22),
      audioSourceUrl: audioResult.sourceUrl,
      audioLicense: audioResult.license,
      audioArtist: audioResult.artist
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
