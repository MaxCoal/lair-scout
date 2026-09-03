import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  ClickPayload,
  LairScoutAPI,
  InstanceSnapshot,
  KeyPayload,
  MovePayload,
  QueueNotice,
  RamSnapshot,
  ScrollPayload
} from '@shared/types'

const api: LairScoutAPI = {
  spawn: () => ipcRenderer.invoke('instances:spawn'),
  scaleTo: (count) => ipcRenderer.invoke('instances:scaleTo', count),
  kill: (id) => ipcRenderer.invoke('instances:kill', id),
  restart: (id) => ipcRenderer.invoke('instances:restart', id),
  gotoAll: (url) => ipcRenderer.invoke('instances:gotoAll', url),
  rushCheckout: () => ipcRenderer.invoke('instances:rushCheckout'),
  gotoOne: (id, url) => ipcRenderer.invoke('instances:gotoOne', id, url),
  reload: (id) => ipcRenderer.invoke('instances:reload', id),
  click: (payload: ClickPayload) => {
    ipcRenderer.send('instances:click', payload)
  },
  key: (payload: KeyPayload) => {
    ipcRenderer.send('instances:key', payload)
  },
  scroll: (payload: ScrollPayload) => {
    ipcRenderer.send('instances:scroll', payload)
  },
  move: (payload: MovePayload) => {
    ipcRenderer.send('instances:move', payload)
  },
  popOut: (id) => ipcRenderer.invoke('instances:popOut', id),
  dock: (id) => ipcRenderer.invoke('instances:dock', id),
  interact: (id, rect) => ipcRenderer.invoke('instances:interact', id, rect),
  stopInteract: (id) => ipcRenderer.invoke('instances:stopInteract', id),
  openDriveWindow: () => ipcRenderer.invoke('drive:open'),
  closeDriveWindow: () => ipcRenderer.invoke('drive:close'),
  setMuted: (muted) => ipcRenderer.invoke('alerts:setMuted', muted),
  setFocused: (id) => ipcRenderer.invoke('instances:setFocused', id),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke('settings:save', settings),
  onUpdate: (cb) => {
    const listener = (_event: unknown, instances: InstanceSnapshot[]): void => cb(instances)
    ipcRenderer.on('instances:update', listener)
    return () => {
      ipcRenderer.removeListener('instances:update', listener)
    }
  },
  onAdmitted: (cb) => {
    const listener = (_event: unknown, id: string): void => cb(id)
    ipcRenderer.on('instances:admitted', listener)
    return () => {
      ipcRenderer.removeListener('instances:admitted', listener)
    }
  },
  onQueuePopped: (cb) => {
    const listener = (_event: unknown, id: string): void => cb(id)
    ipcRenderer.on('instances:queuePopped', listener)
    return () => {
      ipcRenderer.removeListener('instances:queuePopped', listener)
    }
  },
  onQueueMessage: (cb) => {
    const listener = (
      _event: unknown,
      payload: { foxId: string; notice: QueueNotice }
    ): void => cb(payload)
    ipcRenderer.on('instances:queueMessage', listener)
    return () => {
      ipcRenderer.removeListener('instances:queueMessage', listener)
    }
  },
  onRam: (cb) => {
    const listener = (_event: unknown, ram: RamSnapshot): void => cb(ram)
    ipcRenderer.on('stats:ram', listener)
    return () => {
      ipcRenderer.removeListener('stats:ram', listener)
    }
  },
  onSettings: (cb) => {
    const listener = (_event: unknown, settings: AppSettings): void => cb(settings)
    ipcRenderer.on('settings:update', listener)
    return () => {
      ipcRenderer.removeListener('settings:update', listener)
    }
  },
  quit: () => ipcRenderer.invoke('app:quit')
}

contextBridge.exposeInMainWorld('lairscout', api)
