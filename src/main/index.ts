import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { firefoxManager } from './firefoxManager'

let quitting = false
let mainWindow: BrowserWindow | null = null
let driveWindow: BrowserWindow | null = null

function rendererPrefs() {
  return {
    preload: join(__dirname, '../preload/index.js'),
    sandbox: false,
    contextIsolation: true,
    nodeIntegration: false
  }
}

function loadRenderer(window: BrowserWindow, hash = ''): void {
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}${hash}`)
  } else if (hash) {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { hash: hash.replace(/^#/, '') })
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#0c0d10',
    title: 'FoxBox',
    autoHideMenuBar: true,
    webPreferences: rendererPrefs()
  })

  window.on('ready-to-show', () => {
    window.show()
  })

  window.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  window.on('closed', () => {
    mainWindow = null
    driveWindow?.close()
  })

  loadRenderer(window)
  return window
}

function createDriveWindow(): void {
  if (driveWindow && !driveWindow.isDestroyed()) {
    driveWindow.show()
    driveWindow.focus()
    return
  }
  driveWindow = new BrowserWindow({
    width: 1100,
    height: 740,
    minWidth: 640,
    minHeight: 420,
    backgroundColor: '#0c0d10',
    title: 'FoxBox Drive',
    autoHideMenuBar: true,
    webPreferences: rendererPrefs()
  })
  loadRenderer(driveWindow, '#drive')
  driveWindow.on('closed', () => {
    driveWindow = null
  })
}

function closeDriveWindow(): void {
  if (driveWindow && !driveWindow.isDestroyed()) driveWindow.close()
  driveWindow = null
}

function registerIpc(): void {
  ipcMain.handle('instances:spawn', () => firefoxManager.spawn())
  ipcMain.handle('instances:kill', (_event, id: string) => firefoxManager.kill(id))
  ipcMain.handle('instances:gotoAll', (_event, url: string) => firefoxManager.gotoAll(url))
  ipcMain.handle('instances:gotoOne', (_event, id: string, url: string) => firefoxManager.gotoOne(id, url))
  ipcMain.handle('instances:reload', (_event, id: string) => firefoxManager.reload(id))
  ipcMain.on(
    'instances:click',
    (
      _event,
      payload: { id: string; nx: number; ny: number; button?: 'left' | 'right' | 'middle'; double?: boolean }
    ) => firefoxManager.click(payload.id, payload.nx, payload.ny, payload.button, payload.double)
  )
  ipcMain.on('instances:move', (_event, payload: { id: string; nx: number; ny: number }) =>
    firefoxManager.move(payload.id, payload.nx, payload.ny)
  )
  ipcMain.on('instances:key', (_event, payload: { id: string; key: string; type: 'down' | 'up' | 'press' }) =>
    firefoxManager.key(payload.id, payload.key, payload.type)
  )
  ipcMain.on('instances:scroll', (_event, payload: { id: string; dx: number; dy: number }) =>
    firefoxManager.scroll(payload.id, payload.dx, payload.dy)
  )
  ipcMain.handle('instances:popOut', (_event, id: string) => firefoxManager.popOut(id))
  ipcMain.handle('instances:dock', (_event, id: string) => firefoxManager.dock(id))
  ipcMain.handle(
    'instances:interact',
    (_event, id: string, rect: { x: number; y: number; width: number; height: number }) =>
      firefoxManager.interact(id, rect)
  )
  ipcMain.handle('instances:stopInteract', (_event, id: string) => firefoxManager.stopInteract(id))
  ipcMain.handle('drive:open', () => {
    createDriveWindow()
  })
  ipcMain.handle('drive:close', () => {
    closeDriveWindow()
  })
  ipcMain.handle('alerts:setMuted', (_event, muted: boolean) => firefoxManager.setMuted(muted))
  ipcMain.handle('instances:setFocused', (_event, id: string | null) => firefoxManager.setFocused(id))
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.foxbox.app')

  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpc()
  mainWindow = createWindow()
  firefoxManager.attach(mainWindow)

  try {
    await firefoxManager.startDefaultFleet()
  } catch (error) {
    console.error('Default fleet failed', error)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
      firefoxManager.attach(mainWindow)
    }
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
