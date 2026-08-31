import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const [inputArg, outputArg] = process.argv.slice(2)

if (!inputArg || !outputArg) {
  throw new Error(
    'Usage: node scripts/build-simple-dictionary.mjs <pages-articles.xml> <output.data>'
  )
}

const inputPath = resolve(inputArg)
const outputPath = resolve(outputArg)
let xml
try {
  xml = await readFile(inputPath, 'utf8')
} catch (error) {
  if (error?.code === 'ENOENT') {
    throw new Error(
      'Simple English Wiktionary XML is not present. Download and decompress the official pages-articles dump from https://dumps.wikimedia.org/simplewiktionary/latest/ before rebuilding.'
    )
  }
  throw error
}

function decodeXml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim()
}

const labelTemplates = new Set([
  'countable',
  'uncountable',
  'transitive',
  'intransitive',
  'formal',
  'informal',
  'usually singular',
  'usually plural',
  'plural',
  'singular'
])

function cleanWikiText(value) {
  let text = value
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref\b[^>]*\/>/gi, '')
    .replace(/<!--([\s\S]*?)-->/g, '')

  for (let pass = 0; pass < 8 && /\{\{[^{}]*\}\}/.test(text); pass += 1) {
    text = text.replace(/\{\{([^{}]*)\}\}/g, (_, body) => {
      const parts = body.split('|').map((part) => part.trim())
      const name = (parts[0] ?? '').toLowerCase()
      if (name === 'context') {
        const label = parts.slice(1).filter((part) => part && !part.includes('=')).join(', ')
        return label ? `(${label})` : ''
      }
      if (labelTemplates.has(name)) return `(${name})`
      return ''
    })
  }

  return normalizeWhitespace(
    decodeXml(text)
      .replace(/\[\[([^\]|#]+)#?[^\]|]*(?:\|([^\]]+))?\]\]/g, (_, target, label) => label ?? target)
      .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1')
      .replace(/'{2,5}/g, '')
      .replace(/<[^>]+>/g, '')
  )
}

function partOfSpeechFromHeading(heading) {
  const normalized = heading.toLowerCase().trim()
  const accepted = new Map([
    ['noun', 'noun'],
    ['proper noun', 'proper noun'],
    ['verb', 'verb'],
    ['adjective', 'adjective'],
    ['adverb', 'adverb'],
    ['pronoun', 'pronoun'],
    ['preposition', 'preposition'],
    ['conjunction', 'conjunction'],
    ['determiner', 'determiner'],
    ['interjection', 'interjection'],
    ['article', 'article'],
    ['numeral', 'numeral']
  ])
  return accepted.get(normalized) ?? null
}

function extractInflection(text) {
  const match = text.match(
    /\{\{(?:present participle of|past tense and participle of|past participle of|past tense of|simple past of|plural of|comparative of|superlative of|third-person singular of)\|([^}|]+)/i
  )
  return match?.[1]?.trim().toLowerCase() ?? null
}

function parsePage(title, wikiText) {
  const lines = wikiText.split(/\r?\n/)
  const ipaMatch = wikiText.match(/\{\{IPA\|([^{}]+)\}\}/i)
  const phonetic = ipaMatch
    ? ipaMatch[1]
        .split('|')
        .map((part) => part.trim())
        .find((part) => part.startsWith('/') || part.startsWith('[')) ?? null
    : null
  const audioMatches = [...wikiText.matchAll(/\{\{audio\|([^|{}]+)\|[^{}]*\}\}/gi)]
  const audioFile =
    audioMatches
      .map((match) => match[1].trim())
      .find((file) => /\.(?:ogg|oga|mp3|wav)$/i.test(file)) ?? null

  let currentPartOfSpeech = null
  let currentSense = null
  let inflectionPartOfSpeech = null
  const sections = []

  for (const line of lines) {
    const heading = line.match(/^==\s*([^=]+?)\s*==\s*$/)
    if (heading) {
      currentPartOfSpeech = partOfSpeechFromHeading(heading[1])
      currentSense = null
      continue
    }
    if (!currentPartOfSpeech) continue

    const definitionMatch = line.match(/^#(?![:*#])\s*(.+)$/)
    if (definitionMatch) {
      if (extractInflection(definitionMatch[1])) {
        inflectionPartOfSpeech ??= currentPartOfSpeech
        continue
      }
      const definition = cleanWikiText(definitionMatch[1])
      if (!definition) continue
      let section = sections.find((candidate) => candidate.p === currentPartOfSpeech)
      if (!section) {
        section = { p: currentPartOfSpeech, d: [] }
        sections.push(section)
      }
      currentSense = { m: definition }
      section.d.push(currentSense)
      continue
    }

    const exampleMatch = line.match(/^#:\s*(.+)$/)
    if (exampleMatch && currentSense && !currentSense.e) {
      const example = cleanWikiText(exampleMatch[1])
      if (example) currentSense.e = example
    }
  }

  return {
    h: title,
    ...(phonetic ? { i: phonetic } : {}),
    ...(audioFile ? { a: audioFile } : {}),
    ...(extractInflection(wikiText) ? { l: extractInflection(wikiText) } : {}),
    ...(inflectionPartOfSpeech ? { q: inflectionPartOfSpeech } : {}),
    ...(sections.length ? { s: sections } : {})
  }
}

const entries = {}
const pagePattern = /<page>([\s\S]*?)<\/page>/g
let pageMatch

while ((pageMatch = pagePattern.exec(xml)) !== null) {
  const page = pageMatch[1]
  if (!/<ns>0<\/ns>/.test(page)) continue
  const titleMatch = page.match(/<title>([\s\S]*?)<\/title>/)
  const textMatch = page.match(/<text\b[^>]*>([\s\S]*?)<\/text>/)
  if (!titleMatch || !textMatch) continue

  const title = decodeXml(titleMatch[1]).trim()
  if (!/^[A-Za-z]+(?:['’-][A-Za-z]+)*$/.test(title)) continue

  const key = title.toLowerCase()
  const candidate = parsePage(title, decodeXml(textMatch[1]))
  const current = entries[key]
  const candidateScore = (candidate.s?.length ?? 0) * 10 + (candidate.a ? 2 : 0) + (candidate.i ? 1 : 0)
  const currentScore = current
    ? (current.s?.length ?? 0) * 10 + (current.a ? 2 : 0) + (current.i ? 1 : 0)
    : -1
  if (candidateScore > currentScore) entries[key] = candidate
}

const resolvedEntries = Object.fromEntries(
  Object.entries(entries).filter(([, entry]) => {
    if (entry.s?.some((section) => section.d.length)) return true
    const lemma = entry.l ? entries[entry.l] : null
    return Boolean(lemma?.s?.some((section) => section.d.length))
  })
)

const output = {
  schemaVersion: 1,
  source: 'Simple English Wiktionary',
  sourceUrl: 'https://simple.wiktionary.org/',
  dumpUrl:
    'https://dumps.wikimedia.org/simplewiktionary/latest/simplewiktionary-latest-pages-articles.xml.bz2',
  license: 'CC BY-SA 4.0; individual audio files retain their Wikimedia Commons licenses',
  entryCount: Object.keys(resolvedEntries).length,
  entries: resolvedEntries
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, JSON.stringify(output), 'utf8')
process.stdout.write(`Built ${output.entryCount} dictionary entries at ${outputPath}\n`)
