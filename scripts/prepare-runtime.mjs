import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = join(root, 'resources', 'runtime')
const browsers = join(dest, 'browsers')
const nodeDest = join(dest, process.platform === 'win32' ? 'node.exe' : 'node')

rmSync(dest, { recursive: true, force: true })
mkdirSync(join(dest, 'pw'), { recursive: true })
mkdirSync(browsers, { recursive: true })

cpSync(process.execPath, nodeDest)
cpSync(join(root, 'src/main/scoutWorker.cjs'), join(dest, 'scoutWorker.cjs'))
cpSync(join(root, 'src/main/win32-host.ps1'), join(dest, 'win32-host.ps1'))

// Named `pw` instead of `node_modules` so electron-builder extraResources will copy it.
for (const pkg of ['playwright', 'playwright-core']) {
  const from = join(root, 'node_modules', pkg)
  if (!existsSync(from)) throw new Error(`Missing ${pkg}. Run npm install first.`)
  cpSync(from, join(dest, 'pw', pkg), { recursive: true, dereference: true })
}

const cache =
  process.env.PLAYWRIGHT_BROWSERS_PATH ||
  (process.platform === 'win32'
    ? join(homedir(), 'AppData', 'Local', 'ms-playwright')
    : join(homedir(), '.cache', 'ms-playwright'))

if (existsSync(cache)) {
  for (const name of readdirSync(cache)) {
    if (!/^(chromium-|ffmpeg-|winldd-)/.test(name)) continue
    const from = join(cache, name)
    if (!statSync(from).isDirectory()) continue
    cpSync(from, join(browsers, name), { recursive: true, dereference: true })
  }
}

const cli = join(root, 'node_modules', 'playwright', 'cli.js')
execFileSync(process.execPath, [cli, 'install', 'chromium'], {
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers },
  stdio: 'inherit'
})

for (const name of readdirSync(browsers)) {
  if (!name.startsWith('chromium_headless_shell')) continue
  rmSync(join(browsers, name), { recursive: true, force: true })
}

const hasChromium = readdirSync(browsers).some((name) => name.startsWith('chromium-'))
if (!existsSync(nodeDest) || !hasChromium) {
  throw new Error('Runtime bundle is missing node or Chromium')
}

console.log(`Runtime ready at ${dest}`)
