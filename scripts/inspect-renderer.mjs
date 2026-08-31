import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const websocketUrl = process.argv[2]
const screenshotPath = process.argv[3]

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
await send('Page.enable')
const evaluation = await send('Runtime.evaluate', {
  expression: `(async () => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    const status = await window.originEnglish?.getRuntimeStatus?.();
    return JSON.stringify({
      title: document.title,
      bridgeAvailable: typeof window.originEnglish === 'object',
      runtimeStatus: status,
      bodyText: document.body.innerText.slice(0, 500)
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
  throw new Error(evaluation.exceptionDetails.text)
}
console.log(evaluation.result.value)
