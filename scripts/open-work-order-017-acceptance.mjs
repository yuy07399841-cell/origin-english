import { constants } from 'node:fs'
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'

const projectDirectory = resolve(import.meta.dirname, '..')
const sourceUserData = join(projectDirectory, '.validation', 'listening-acceptance', 'user-data')
const sourceDataDirectory = join(sourceUserData, 'origin-english')
const sourceStatePath = join(sourceDataDirectory, 'state.json')
const acceptanceRoot = join(projectDirectory, '.validation', 'work-order-017-acceptance')
const targetUserData = join(acceptanceRoot, 'user-data')
const targetDataDirectory = join(targetUserData, 'origin-english')
const targetStatePath = join(targetDataDirectory, 'state.json')

await access(sourceStatePath)
let targetReady = true
try {
  await access(targetStatePath)
} catch {
  targetReady = false
}

if (!targetReady) {
  const sourceState = JSON.parse(await readFile(sourceStatePath, 'utf8'))
  const listeningItem = sourceState.listeningItems?.[0]
  if (!listeningItem?.storedFileName || listeningItem.transcript?.sentences?.length !== 113) {
    throw new Error('The frozen 113-sentence acceptance fixture is not available.')
  }
  const targetMediaPath = join(
    targetDataDirectory,
    'listening-media',
    listeningItem.storedFileName
  )
  await mkdir(dirname(targetMediaPath), { recursive: true })
  await copyFile(
    join(sourceDataDirectory, 'listening-media', listeningItem.storedFileName),
    targetMediaPath,
    constants.COPYFILE_EXCL
  )
  sourceState.articles = [
    {
      id: 'work-order-017-layout',
      title: 'A calm reading layout',
      fileName: 'work-order-017-layout.md',
      markdown:
        '# A calm reading layout\n\nThe article remains the primary reading surface, while the dictionary card stays on the right for quick reference.',
      importedAt: '2026-08-31T09:00:00.000Z'
    },
    ...(sourceState.articles ?? [])
  ]
  await writeFile(targetStatePath, `${JSON.stringify(sourceState, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx'
  })
}

const electronPath = join(projectDirectory, 'node_modules', 'electron', 'dist', 'electron.exe')
const child = spawn(electronPath, ['.'], {
  cwd: projectDirectory,
  detached: true,
  env: {
    ...process.env,
    MIMO_API_KEY: '',
    ORIGIN_ENGLISH_USER_DATA_DIR: targetUserData
  },
  stdio: 'ignore',
  windowsHide: true
})
child.unref()
console.log(
  JSON.stringify({
    pid: child.pid,
    userDataDirectory: targetUserData,
    sentenceCount: 113,
    includesReadingLayoutArticle: true
  })
)
