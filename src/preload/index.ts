import { contextBridge, ipcRenderer } from 'electron'
import type {
  ClickPayload,
  FoxboxAPI,
  InstanceSnapshot,
  KeyPayload,
  MovePayload,
  ScrollPayload
} from '@shared/types'

const api: FoxboxAPI = {
  spawn: () => ipcRenderer.invoke('instances:spawn'),
  kill: (id) => ipcRenderer.invoke('instances:kill', id),
  gotoAll: (url) => ipcRenderer.invoke('instances:gotoAll', url),
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
  }
}

contextBridge.exposeInMainWorld('foxbox', api)
