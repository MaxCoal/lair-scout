import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { InstanceSnapshot, QueueNotice, RamSnapshot } from '@shared/types'
import FleetBar from './components/FleetBar'
import Sidebar from './components/Sidebar'
import InstanceGrid from './components/InstanceGrid'
import FocusView from './components/FocusView'
import DrivePad from './components/DrivePad'
import SettingsModal from './components/SettingsModal'
import QueueNoticeBox from './components/QueueNoticeBox'
import { nextInstanceSort, sortInstances, type InstanceSort } from './sortInstances'
import { applyTheme } from './theme'

const DEFAULT_URL = 'https://secretlair.wizards.com/us'
const IS_DRIVE_PAD = window.location.hash === '#drive'

function playTone(startHz: number, endHz: number): void {
  const ctx = new AudioContext()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'triangle'
  osc.frequency.value = startHz
  gain.gain.value = 0.05
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start()
  osc.frequency.exponentialRampToValueAtTime(endHz, ctx.currentTime + 0.18)
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4)
  osc.stop(ctx.currentTime + 0.42)
}

export default function App() {
  const [instances, setInstances] = useState<InstanceSnapshot[]>([])
  const [url, setUrl] = useState(DEFAULT_URL)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [liveId, setLiveId] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [driveAll, setDriveAll] = useState(false)
  const [ram, setRam] = useState<RamSnapshot | null>(null)
  const [rushing, setRushing] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [instanceSort, setInstanceSort] = useState<InstanceSort>('id')
  const [dismissedNotices, setDismissedNotices] = useState<string[]>([])

  useEffect(() => {
    void window.lairscout.getSettings().then((settings) => applyTheme(settings.theme))
    return window.lairscout.onSettings((settings) => applyTheme(settings.theme))
  }, [])

  useEffect(() => {
    return window.lairscout.onRam(setRam)
  }, [])

  useEffect(() => {
    return window.lairscout.onUpdate(setInstances)
  }, [])

  useEffect(() => {
    return window.lairscout.onAdmitted(() => {
      if (!muted) playTone(784, 1175)
    })
  }, [muted])

  useEffect(() => {
    return window.lairscout.onQueuePopped(() => {
      if (!muted) playTone(392, 784)
    })
  }, [muted])

  useEffect(() => {
    return window.lairscout.onQueueMessage(({ notice }) => {
      if (muted) return
      if (notice.kind === 'stock') {
        playTone(196, 392)
        window.setTimeout(() => playTone(392, 262), 200)
        return
      }
      playTone(523, 784)
      window.setTimeout(() => playTone(784, 1046), 180)
    })
  }, [muted])

  useEffect(() => {
    void window.lairscout.setFocused(focusedId)
  }, [focusedId])

  useEffect(() => {
    if (!driveAll || liveId) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      if (event.key === 'Escape' && focusedId) {
        setLiveId(null)
        setFocusedId(null)
        return
      }
      if (event.type === 'keydown' && event.repeat) return
      event.preventDefault()
      window.lairscout.key({
        id: '*',
        key: event.key,
        type: event.type === 'keyup' ? 'up' : 'down'
      })
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [driveAll, focusedId, liveId])

  const focused = useMemo(
    () =>
      instances.find((fox) => fox.id === focusedId) ??
      instances.find((fox) => fox.focused) ??
      instances[0] ??
      null,
    [instances, focusedId]
  )

  const sorted = useMemo(() => sortInstances(instances, instanceSort), [instances, instanceSort])

  const queueNotices = useMemo(() => {
    const hidden = new Set(dismissedNotices)
    const byId = new Map<string, QueueNotice>()
    for (const fox of instances) {
      const notice = fox.queueNotice
      if (!notice?.text) continue
      const key = `${notice.id}|${notice.text}`
      if (hidden.has(key) || byId.has(key)) continue
      byId.set(key, notice)
    }
    return [...byId.values()]
  }, [instances, dismissedNotices])

  const sendAll = (event: FormEvent): void => {
    event.preventDefault()
    void window.lairscout.gotoAll(url)
  }

  const rushCheckout = (): void => {
    if (rushing) return
    setRushing(true)
    void window.lairscout.rushCheckout().finally(() => setRushing(false))
  }

  const restartScout = (id: string): void => {
    if (liveId === id) setLiveId(null)
    void window.lairscout.restart(id)
  }

  const selectScout = (id: string, live: boolean): void => {
    setFocusedId(id)
    setLiveId(live ? id : null)
  }

  if (IS_DRIVE_PAD) {
    return (
      <div className="shell drive-shell">
        <DrivePad fox={focused} fleetCount={instances.length} standalone />
      </div>
    )
  }

  return (
    <div className="shell">
      <FleetBar
        url={url}
        count={instances.length}
        ram={ram}
        muted={muted}
        driveAll={driveAll}
        onUrl={setUrl}
        onSendAll={sendAll}
        onRushCheckout={rushCheckout}
        rushing={rushing}
        onScaleTo={(next) => window.lairscout.scaleTo(next)}
        onToggleMute={() => {
          const next = !muted
          setMuted(next)
          void window.lairscout.setMuted(next)
        }}
        onToggleDriveAll={() => {
          setDriveAll((value) => {
            const next = !value
            setLiveId(null)
            if (!next) void window.lairscout.closeDriveWindow()
            return next
          })
        }}
        onOpenDriveWindow={() => window.lairscout.openDriveWindow()}
        onOpenSettings={() => setSettingsOpen(true)}
        instanceSort={instanceSort}
        onCycleInstanceSort={() => setInstanceSort((value) => nextInstanceSort(value))}
        onQuit={() => void window.lairscout.quit()}
      />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <div className="workspace">
        <Sidebar
          instances={sorted}
          focusedId={focusedId}
          onFocus={(id) => selectScout(id, !driveAll)}
          onRestart={restartScout}
          onKill={(id) => {
            if (focusedId === id) setFocusedId(null)
            if (liveId === id) setLiveId(null)
            void window.lairscout.kill(id)
          }}
        />
        <main className={`main ${focused && liveId === focused.id ? 'locked' : ''}`}>
          {queueNotices.map((notice) => (
            <QueueNoticeBox
              key={`${notice.id}|${notice.text}`}
              notice={notice}
              onDismiss={() =>
                setDismissedNotices((ids) => [...ids, `${notice.id}|${notice.text}`])
              }
            />
          ))}
          {instances.length >= 6 ? (
            <p className="warn">Each Chromium uses a lot of RAM. Scale down if the machine starts swapping.</p>
          ) : null}
          {driveAll ? (
            <div className="drive-layout">
              <p className="hint">
                Drive all is on. Clicks, scroll, and keys go to every scout. Open Drive window only if you want this on
                another monitor.
              </p>
              <DrivePad fox={focused} fleetCount={instances.length} />
              <div className="drive-thumbs">
                <InstanceGrid
                  instances={sorted}
                  driveAll={driveAll}
                  onFocus={(id) => selectScout(id, false)}
                  onGotoOne={(id) => window.lairscout.gotoOne(id, url)}
                  onRestart={restartScout}
                />
              </div>
            </div>
          ) : focused && liveId === focused.id ? (
            <FocusView
              fox={focused}
              driveAll={false}
              fleetCount={instances.length}
              live
              onRestart={restartScout}
              onBack={() => {
                setLiveId(null)
                setFocusedId(null)
              }}
            />
          ) : (
            <InstanceGrid
              instances={sorted}
              driveAll={false}
              onFocus={(id) => selectScout(id, true)}
              onGotoOne={(id) => window.lairscout.gotoOne(id, url)}
              onRestart={restartScout}
            />
          )}
        </main>
      </div>
    </div>
  )
}
