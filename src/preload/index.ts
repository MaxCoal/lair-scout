import { contextBridge, ipcRenderer } from 'electron'
import type {
  ClickPayload,
  FoxboxAPI,
  InstanceSnapshot,
  KeyPayload,
  MovePayload,
  RamSnapshot,
  ScrollPayload
} from '@shared/types'

const api: FoxboxAPI = {
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
  onRam: (cb) => {
    const listener = (_event: unknown, ram: RamSnapshot): void => cb(ram)
    ipcRenderer.on('stats:ram', listener)
    return () => {
      ipcRenderer.removeListener('stats:ram', listener)
    }
  }
}

contextBridge.exposeInMainWorld('foxbox', api)
