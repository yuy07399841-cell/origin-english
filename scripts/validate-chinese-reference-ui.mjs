import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const websocketUrl = process.argv[2]
const screenshotPath = process.argv[3]
const selectedWord = process.argv[4] ?? 'noticing'

if (!websocketUrl) {
  throw new Error(
    'Usage: node validate-chinese-reference-ui.mjs <websocket-url> [screenshot-path] [word]'
  )
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
      const candidateStart = content.toLowerCase().indexOf(target.toLowerCase());
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

    const panel = await waitFor(
      () => {
        const candidate = document.querySelector('.definition-panel');
        const source = candidate?.querySelector('.source-badge')?.textContent ?? '';
        const word = candidate?.querySelector('.word-line h2')?.textContent?.trim().toLowerCase();
        return source.includes('Simple English Wiktionary') && word === target.toLowerCase()
          ? candidate
          : null;
      },
      'Local English dictionary result was not rendered'
    );

    const hintHiddenBeforeClick = panel.querySelector('.chinese-hint') === null;
    const button = [...panel.querySelectorAll('button')].find(
      (candidate) => candidate.textContent.trim() === 'Show Chinese reference'
    );
    if (!button) throw new Error('Chinese reference button was not rendered');
    button.click();

    const hint = await waitFor(
      () => {
        const candidate = panel.querySelector('.chinese-hint');
        return candidate &&
          candidate.textContent.includes('Local Chinese reference · ECDICT') &&
          !candidate.textContent.includes('Preparing')
          ? candidate
          : null;
      },
      'Local ECDICT reference was not rendered after the click'
    );
    const runtimeStatus = await window.originEnglish.getRuntimeStatus();

    return JSON.stringify({
      selectedText: selection.toString(),
      word: panel.querySelector('.word-line h2')?.textContent?.trim(),
      englishSource: panel.querySelector('.source-badge')?.textContent?.trim(),
      englishDefinition: panel.querySelector('.definition-copy')?.textContent?.trim(),
      chineseReferenceHiddenByDefault: hintHiddenBeforeClick,
      chineseSource: hint.querySelector('span')?.textContent?.trim(),
      chineseReference: hint.querySelector('p')?.textContent?.trim(),
      runtimeStatus
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
