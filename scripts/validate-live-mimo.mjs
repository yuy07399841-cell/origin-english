const websocketUrl = process.argv[2]

if (!websocketUrl) {
  throw new Error('A Chrome DevTools websocket URL is required.')
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
    const before = await window.originEnglish.getRuntimeStatus();
    const first = await window.originEnglish.defineWord({
      word: 'subtle',
      sentence: 'The author uses subtle changes in tone to reveal the character’s doubt.'
    });
    const second = await window.originEnglish.defineWord({
      word: 'sustained',
      sentence: 'Sustained attention helps a reader notice patterns across a long essay.'
    });
    const after = await window.originEnglish.getRuntimeStatus();
    return JSON.stringify({
      before,
      first: {
        word: first.word,
        partOfSpeech: first.partOfSpeech,
        definition: first.definition,
        usage: first.usage,
        source: first.source
      },
      second: {
        word: second.word,
        partOfSpeech: second.partOfSpeech,
        definition: second.definition,
        usage: second.usage,
        source: second.source
      },
      after
    });
  })()`,
  awaitPromise: true,
  returnByValue: true
})

socket.close()
if (evaluation.exceptionDetails) {
  throw new Error(evaluation.exceptionDetails.exception?.description ?? evaluation.exceptionDetails.text)
}
console.log(evaluation.result.value)
