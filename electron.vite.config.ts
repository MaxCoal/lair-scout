import { resolve } from 'node:path'
import { cpSync, mkdirSync } from 'node:fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

const sharedAlias = {
  '@shared': resolve('src/shared')
}

function copyWin32Script(): Plugin {
  const copy = (): void => {
    mkdirSync('out/main', { recursive: true })
    cpSync('src/main/win32.ps1', 'out/main/win32.ps1')
    cpSync('src/main/win32-host.ps1', 'out/main/win32-host.ps1')
    cpSync('src/main/foxWorker.cjs', 'out/main/foxWorker.cjs')
  }
  return {
    name: 'copy-win32-ps1',
    buildStart: copy,
    closeBundle: copy
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyWin32Script()],
    resolve: { alias: sharedAlias }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAlias }
  },
  renderer: {
    resolve: {
      alias: {
        ...sharedAlias,
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
