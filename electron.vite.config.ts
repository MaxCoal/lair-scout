import { resolve } from 'node:path'
import { cpSync, mkdirSync } from 'node:fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

const sharedAlias = {
  '@shared': resolve('src/shared')
}

function copyRuntimeFiles(): Plugin {
  const files = ['win32.ps1', 'win32-host.ps1', 'foxWorker.cjs']
  const copy = (): void => {
    mkdirSync('out/main', { recursive: true })
    for (const name of files) cpSync(`src/main/${name}`, `out/main/${name}`)
  }
  return {
    name: 'copy-runtime-files',
    buildStart: copy,
    closeBundle: copy,
    configureServer(server) {
      copy()
      for (const name of files) server.watcher.add(resolve(`src/main/${name}`))
      server.watcher.on('change', (file) => {
        const norm = file.replace(/\\/g, '/')
        if (files.some((name) => norm.endsWith(`src/main/${name}`))) copy()
      })
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyRuntimeFiles()],
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
