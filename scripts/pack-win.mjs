process.env.CSC_IDENTITY_AUTO_DISCOVERY ??= 'false'

const { spawnSync } = await import('node:child_process')
const target = process.argv[2] === 'dir' ? 'dir' : 'nsis'
const result = spawnSync('npx', ['electron-builder', '--win', target], {
  stdio: 'inherit',
  env: process.env,
  shell: true
})
process.exit(result.status ?? 1)
