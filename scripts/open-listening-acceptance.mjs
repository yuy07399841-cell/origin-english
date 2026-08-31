import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const projectDirectory = resolve(import.meta.dirname, '..')
const userDataDirectory = join(
  projectDirectory,
  '.validation',
  'listening-acceptance',
  'user-data'
)
await access(join(userDataDirectory, 'origin-english', 'state.json'))

const electronPath = join(projectDirectory, 'node_modules', 'electron', 'dist', 'electron.exe')
const child = spawn(electronPath, ['.'], {
  cwd: projectDirectory,
  detached: true,
  env: {
    ...process.env,
    MIMO_API_KEY: '',
    ORIGIN_ENGLISH_USER_DATA_DIR: userDataDirectory
  },
  stdio: 'ignore',
  windowsHide: true
})
child.unref()
console.log(JSON.stringify({ pid: child.pid, userDataDirectory }))
