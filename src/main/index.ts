import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { firefoxManager } from './firefoxManager'

let quitting = false

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#0c0d10',
    title: 'FoxBox',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

function registerIpc(): void {
  ipcMain.handle('instances:spawn', () => firefoxManager.spawn())
  ipcMain.handle('instances:kill', (_event, id: string) => firefoxManager.kill(id))
  ipcMain.handle('instances:gotoAll', (_event, url: string) => firefoxManager.gotoAll(url))
  ipcMain.handle('instances:gotoOne', (_event, id: string, url: string) => firefoxManager.gotoOne(id, url))
  ipcMain.handle('instances:reload', (_event, id: string) => firefoxManager.reload(id))
  ipcMain.handle(
    'instances:click',
    (
      _event,
      payload: { id: string; nx: number; ny: number; button?: 'left' | 'right' | 'middle'; double?: boolean }
    ) => firefoxManager.click(payload.id, payload.nx, payload.ny, payload.button, payload.double)
  )
  ipcMain.handle('instances:move', (_event, payload: { id: string; nx: number; ny: number }) =>
    firefoxManager.move(payload.id, payload.nx, payload.ny)
  )
  ipcMain.handle('instances:key', (_event, payload: { id: string; key: string; type: 'down' | 'up' | 'press' }) =>
    firefoxManager.key(payload.id, payload.key, payload.type)
  )
  ipcMain.handle('instances:scroll', (_event, payload: { id: string; dx: number; dy: number }) =>
    firefoxManager.scroll(payload.id, payload.dx, payload.dy)
  )
  ipcMain.handle('instances:popOut', (_event, id: string) => firefoxManager.popOut(id))
  ipcMain.handle('instances:dock', (_event, id: string) => firefoxManager.dock(id))
  ipcMain.handle('alerts:setMuted', (_event, muted: boolean) => firefoxManager.setMuted(muted))
  ipcMain.handle('instances:setFocused', (_event, id: string | null) => firefoxManager.setFocused(id))
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.foxbox.app')

  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpc()
  const window = createWindow()
  firefoxManager.attach(window)

  try {
    await firefoxManager.startDefaultFleet()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox(
      'FoxBox could not start Firefox',
      `${message}\n\nIf Playwright Firefox is missing, run:\n  npx playwright install firefox`
    )
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  void firefoxManager.shutdown().finally(() => {
    app.exit(0)
  })
})
