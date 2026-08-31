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
    const selects = [...document.querySelectorAll('.definition-panel .speech-controls select')];
    const listenButton = document.querySelector('.definition-panel .panel-heading .icon-button');
    if (selects.length !== 2 || !listenButton) throw new Error('Speech controls were not found');
    const [voiceSelect, rateSelect] = selects;
    voiceSelect.value = 'system:en-US';
    voiceSelect.dispatchEvent(new Event('change', { bubbles: true }));
    rateSelect.value = '0.8';
    rateSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    let spoken = null;
    const originalSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
    const originalCancel = window.speechSynthesis.cancel.bind(window.speechSynthesis);
    window.speechSynthesis.cancel = () => {};
    window.speechSynthesis.speak = (utterance) => {
      spoken = { text: utterance.text, lang: utterance.lang, rate: utterance.rate };
    };
    try {
      listenButton.click();
    } finally {
      window.speechSynthesis.speak = originalSpeak;
      window.speechSynthesis.cancel = originalCancel;
    }
    return JSON.stringify({
      selectedVoice: voiceSelect.value,
      selectedRate: rateSelect.value,
      spoken
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
