import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDirectory, '..')
const manifestPath = join(projectRoot, 'resources', 'transcription-assets.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const allowedArguments = new Set(['--check'])
const unknownArguments = process.argv.slice(2).filter((argument) => !allowedArguments.has(argument))

if (unknownArguments.length > 0) {
  throw new Error(`Unknown argument: ${unknownArguments.join(', ')}`)
}

const checkOnly = process.argv.includes('--check')
const fromPortablePath = (value) => join(...value.split('/'))
const targetRoot = join(projectRoot, fromPortablePath(manifest.targetRoot))
const modelTargetPath = join(targetRoot, manifest.model.fileName)
const runtimeTargetDirectory = join(
  targetRoot,
  fromPortablePath(manifest.runtime.targetDirectory)
)

async function sha256File(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function inspectFile(filePath, expected) {
  let fileStats
  try {
    fileStats = await stat(filePath)
  } catch {
    return { ok: false, reason: 'missing' }
  }

  if (!fileStats.isFile()) return { ok: false, reason: 'not a file' }
  if (expected.bytes && fileStats.size !== expected.bytes) {
    return {
      ok: false,
      reason: `size ${fileStats.size} does not match ${expected.bytes}`
    }
  }

  const actualSha256 = await sha256File(filePath)
  if (actualSha256.toLowerCase() !== expected.sha256.toLowerCase()) {
    return { ok: false, reason: `SHA-256 ${actualSha256} does not match the manifest` }
  }

  return { ok: true, bytes: fileStats.size, sha256: actualSha256 }
}

async function verifyAssets() {
  const results = []
  results.push({
    label: manifest.model.fileName,
    path: modelTargetPath,
    ...(await inspectFile(modelTargetPath, manifest.model))
  })

  for (const file of manifest.runtime.files) {
    const filePath = join(runtimeTargetDirectory, file.name)
    results.push({
      label: file.name,
      path: filePath,
      ...(await inspectFile(filePath, file))
    })
  }

  return results
}

function printFailures(results) {
  for (const result of results.filter((entry) => !entry.ok)) {
    console.error(`- ${result.label}: ${result.reason}`)
  }
}

function progressTransform(label, expectedBytes) {
  let received = 0
  let nextReport = 0.1
  return new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length
      if (expectedBytes > 0 && received / expectedBytes >= nextReport) {
        console.log(`${label}: ${Math.min(100, Math.floor((received / expectedBytes) * 100))}%`)
        nextReport += 0.1
      }
      callback(null, chunk)
    }
  })
}

async function downloadFile(url, destinationPath, label, expectedBytes) {
  console.log(`Downloading ${label} from its pinned upstream source...`)
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'Origin-English-transcription-assets/0.2.0' }
  })
  if (!response.ok || !response.body) {
    throw new Error(`Download failed for ${label}: HTTP ${response.status}`)
  }

  await pipeline(
    Readable.fromWeb(response.body),
    progressTransform(label, expectedBytes),
    createWriteStream(destinationPath, { flags: 'wx' })
  )

  const downloadedStats = await stat(destinationPath)
  if (expectedBytes > 0 && downloadedStats.size !== expectedBytes) {
    throw new Error(
      `${label} downloaded ${downloadedStats.size} bytes; expected ${expectedBytes}.`
    )
  }
}

function quotePowerShellLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`
}

async function expandArchive(archivePath, destinationPath) {
  if (process.platform !== 'win32') {
    throw new Error('The pinned whisper.cpp runtime archive is prepared only for Windows x64.')
  }

  const command = [
    "$ErrorActionPreference = 'Stop'",
    `Expand-Archive -LiteralPath ${quotePowerShellLiteral(archivePath)} -DestinationPath ${quotePowerShellLiteral(destinationPath)} -Force`
  ].join('; ')

  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { shell: false, stdio: 'inherit', windowsHide: true }
    )
    child.once('error', rejectPromise)
    child.once('exit', (code) => {
      if (code === 0) resolvePromise()
      else rejectPromise(new Error(`Expand-Archive exited with code ${code}.`))
    })
  })
}

async function findExtractedRuntimeDirectory(extractionRoot) {
  const direct = join(extractionRoot, fromPortablePath(manifest.runtime.archiveDirectory))
  try {
    if ((await stat(join(direct, 'whisper-cli.exe'))).isFile()) return direct
  } catch {
    // Some archives include one additional top-level directory.
  }

  for (const entry of await readdir(extractionRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const nested = join(
      extractionRoot,
      entry.name,
      fromPortablePath(manifest.runtime.archiveDirectory)
    )
    try {
      if ((await stat(join(nested, 'whisper-cli.exe'))).isFile()) return nested
    } catch {
      // Continue looking for the fixed Release directory.
    }
  }

  throw new Error('The whisper.cpp archive does not contain the expected Release directory.')
}

async function verifyRuntimeSource(runtimeSourceDirectory) {
  const failures = []
  for (const file of manifest.runtime.files) {
    const result = await inspectFile(join(runtimeSourceDirectory, file.name), file)
    if (!result.ok) failures.push(`${file.name}: ${result.reason}`)
  }
  if (failures.length > 0) {
    throw new Error(`The downloaded whisper.cpp runtime failed verification:\n${failures.join('\n')}`)
  }
}

async function prepareAssets() {
  const current = await verifyAssets()
  if (current.every((entry) => entry.ok)) {
    console.log('Transcription assets are already present and match the pinned manifest.')
    return
  }

  printFailures(current)
  await mkdir(targetRoot, { recursive: true })
  const temporaryRoot = join(targetRoot, `.prepare-assets-${process.pid}-${Date.now()}`)
  await mkdir(temporaryRoot, { recursive: true })

  try {
    const currentModel = current.find((entry) => entry.label === manifest.model.fileName)
    if (!currentModel?.ok) {
      const temporaryModel = join(temporaryRoot, manifest.model.fileName)
      await downloadFile(
        manifest.model.sourceUrl,
        temporaryModel,
        manifest.model.fileName,
        manifest.model.bytes
      )
      const verifiedModel = await inspectFile(temporaryModel, manifest.model)
      if (!verifiedModel.ok) {
        throw new Error(`Downloaded model verification failed: ${verifiedModel.reason}`)
      }
      await copyFile(temporaryModel, modelTargetPath)
    }

    if (current.some((entry) => entry.label !== manifest.model.fileName && !entry.ok)) {
      const archiveName = basename(new URL(manifest.runtime.archiveUrl).pathname)
      const archivePath = join(temporaryRoot, archiveName)
      const extractionRoot = join(temporaryRoot, 'runtime')
      await downloadFile(
        manifest.runtime.archiveUrl,
        archivePath,
        `${manifest.runtime.name} ${manifest.runtime.build}`,
        manifest.runtime.archiveBytes
      )
      await mkdir(extractionRoot, { recursive: true })
      await expandArchive(archivePath, extractionRoot)
      const runtimeSourceDirectory = await findExtractedRuntimeDirectory(extractionRoot)
      await verifyRuntimeSource(runtimeSourceDirectory)
      await mkdir(runtimeTargetDirectory, { recursive: true })
      for (const file of manifest.runtime.files) {
        await copyFile(
          join(runtimeSourceDirectory, file.name),
          join(runtimeTargetDirectory, file.name)
        )
      }
    }

    const finalResults = await verifyAssets()
    if (finalResults.some((entry) => !entry.ok)) {
      printFailures(finalResults)
      throw new Error('Transcription assets are still incomplete after preparation.')
    }
    console.log('Transcription assets were prepared and verified successfully.')
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

if (checkOnly) {
  const results = await verifyAssets()
  if (results.some((entry) => !entry.ok)) {
    printFailures(results)
    console.error('Run `npm run transcription:prepare` before local transcription or packaging.')
    process.exitCode = 1
  } else {
    const totalBytes = results.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0)
    console.log(
      `Transcription assets verified: ${results.length} files, ${totalBytes} bytes, whisper.cpp ${manifest.runtime.version} (${manifest.runtime.build}).`
    )
  }
} else {
  await prepareAssets()
}
