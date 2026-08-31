const websocketUrl = process.argv[2]
const selectedWord = process.argv[3]

if (!websocketUrl || !selectedWord) {
  throw new Error('Usage: node select-word-in-ui.mjs <websocket-url> <word>')
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
const evaluation = await send('Runtime.evaluate', {
  expression: `(async () => {
    const article = document.querySelector('article.reading-paper');
    if (!article) throw new Error('Reading article was not found');
    const target = ${JSON.stringify(selectedWord)};
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    let textNode = null;
    let start = -1;
    while (walker.nextNode()) {
      const content = walker.currentNode.textContent ?? '';
      const match = new RegExp('\\\\b' + target.replace(/[.*+?^$\\{\\}()|[\\]\\\\]/g, '\\\\$&') + '\\\\b', 'i').exec(content);
      if (match) {
        textNode = walker.currentNode;
        start = match.index;
        break;
      }
    }
    if (!textNode || start < 0) throw new Error('Selected word was not found');
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + target.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    article.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const text = document.body.innerText;
      if (text.includes('MiMo 实时语境释义') || text.includes('Live contextual meaning · MiMo')) {
        return JSON.stringify({
          selectedText: selection.toString(),
          runtimeStatus: await window.originEnglish.getRuntimeStatus(),
          bodyText: text.slice(0, 1500),
          voices: window.speechSynthesis.getVoices()
            .filter((voice) => /^en(?:[-_]|$)/i.test(voice.lang))
            .map((voice) => ({ name: voice.name, lang: voice.lang, default: voice.default }))
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error('Timed out waiting for the live definition');
  })()`,
  awaitPromise: true,
  returnByValue: true
})

socket.close()
if (evaluation.exceptionDetails) {
  throw new Error(evaluation.exceptionDetails.exception?.description ?? evaluation.exceptionDetails.text)
}
console.log(evaluation.result.value)
