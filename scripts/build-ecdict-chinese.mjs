import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const [csvArg, simpleDictionaryArg, outputArg] = process.argv.slice(2)

if (!csvArg || !simpleDictionaryArg || !outputArg) {
  throw new Error(
    'Usage: node scripts/build-ecdict-chinese.mjs <ecdict.csv> <simple-wiktionary.data> <output.data>'
  )
}

async function readRequired(path, label) {
  try {
    return await readFile(path)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(label + ' is missing at ' + path)
    }
    throw error
  }
}

function* csvRows(text) {
  let row = []
  let field = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        field += character
      }
      continue
    }

    if (character === '"') {
      quoted = true
    } else if (character === ',') {
      row.push(field)
      field = ''
    } else if (character === '\n') {
      row.push(field.endsWith('\r') ? field.slice(0, -1) : field)
      yield row
      row = []
      field = ''
    } else {
      field += character
    }
  }

  if (field.length || row.length) {
    row.push(field.endsWith('\r') ? field.slice(0, -1) : field)
    yield row
  }
}

function normalizeWord(value) {
  return value.trim().toLocaleLowerCase('en-US')
}

function cleanTranslation(value) {
  const lines = value
    .replace(/\\n/g, '\n')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line && !/^\[网络\]/.test(line))
    .slice(0, 4)
  return lines.join('\n')
}

const csvPath = resolve(csvArg)
const simpleDictionaryPath = resolve(simpleDictionaryArg)
const outputPath = resolve(outputArg)
const [csvBytes, simpleBytes] = await Promise.all([
  readRequired(csvPath, 'ECDICT CSV'),
  readRequired(simpleDictionaryPath, 'Simple English dictionary')
])
const simpleDictionary = JSON.parse(simpleBytes.toString('utf8'))
if (
  simpleDictionary?.schemaVersion !== 1 ||
  !simpleDictionary.entries ||
  typeof simpleDictionary.entries !== 'object'
) {
  throw new Error('The Simple English dictionary resource is invalid.')
}

const targetHeadwords = new Set()
for (const [key, rawEntry] of Object.entries(simpleDictionary.entries)) {
  const entry = rawEntry && typeof rawEntry === 'object' ? rawEntry : {}
  const headword =
    typeof entry.l === 'string' && entry.l.trim()
      ? entry.l
      : typeof entry.h === 'string' && entry.h.trim()
        ? entry.h
        : key
  targetHeadwords.add(normalizeWord(headword))
}

const text = csvBytes.toString('utf8')
const rows = csvRows(text)
const header = rows.next().value
if (!header) throw new Error('ECDICT CSV has no header.')
const wordIndex = header.indexOf('word')
const translationIndex = header.indexOf('translation')
if (wordIndex < 0 || translationIndex < 0) {
  throw new Error('ECDICT CSV is missing word or translation columns.')
}

const translations = new Map()
for (const row of rows) {
  const word = normalizeWord(row[wordIndex] ?? '')
  if (!word || !targetHeadwords.has(word) || translations.has(word)) continue
  const translation = cleanTranslation(row[translationIndex] ?? '')
  if (translation) translations.set(word, translation)
}

const entries = Object.fromEntries(
  [...translations.entries()].sort(([left], [right]) => left.localeCompare(right))
)
const output = {
  schemaVersion: 1,
  source: 'ECDICT',
  sourceUrl: 'https://github.com/skywind3000/ECDICT',
  license: 'MIT',
  sourceSha256: createHash('sha256').update(csvBytes).digest('hex'),
  targetHeadwordCount: targetHeadwords.size,
  entryCount: translations.size,
  entries
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, JSON.stringify(output), 'utf8')
const coverage = targetHeadwords.size
  ? ((translations.size / targetHeadwords.size) * 100).toFixed(1)
  : '0.0'
process.stdout.write(
  'Built ' +
    translations.size +
    ' local Chinese references for ' +
    targetHeadwords.size +
    ' headwords (' +
    coverage +
    '% coverage) at ' +
    outputPath +
    '\n'
)
