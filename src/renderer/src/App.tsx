import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { AppMode, FullAutoStatus, InstanceSnapshot, QueueNotice, RamSnapshot } from '@shared/types'
import FleetBar from './components/FleetBar'
import FullAutoPanel from './components/FullAutoPanel'
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
const DISMISSED_NOTICE_CAP = 80

let toneContext: AudioContext | null = null

const IDLE_AUTO: FullAutoStatus = {
  phase: 'idle',
  productQuery: '',
  foilHint: 'any',
  goLiveAt: 0,
  warmupMinutes: 5,
  fleetSize: 2,
  maxOrders: 1,
  qtyPerOrder: 1,
  matchedTitle: '',
  matchedUrl: '',
  ordersConfirmed: 0,
  candidates: [],
  hasCvv: false,
  debugDumps: false,
  dumpDir: ''
}

function playTone(startHz: number, endHz: number): void {
  const ctx = toneContext ?? new AudioContext()
  toneContext = ctx
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
  const [mode, setMode] = useState<AppMode>('manual')
  const [fullAuto, setFullAuto] = useState<FullAutoStatus>(IDLE_AUTO)
  const [instanceSort, setInstanceSort] = useState<InstanceSort>('id')
  const [dismissedNotices, setDismissedNotices] = useState<string[]>([])

  useEffect(() => {
    void window.lairscout.getSettings().then((settings) => applyTheme(settings.theme))
    return window.lairscout.onSettings((settings) => applyTheme(settings.theme))
  }, [])

  useEffect(() => {
    void window.lairscout.getFullAuto().then(setFullAuto)
    return window.lairscout.onFullAuto(setFullAuto)
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
    return window.lairscout.onOrderConfirmed(() => {
      if (!muted) playTone(523, 1568)
    })
  }, [muted])

  useEffect(() => {
    void window.lairscout.setFocused(focusedId)
  }, [focusedId])

  useEffect(() => {
    if (!driveAll || liveId) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (settingsOpen) return
      const el = event.target
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return
      if (el instanceof HTMLElement && (el.isContentEditable || el.closest('button, [role="button"], a'))) return
      if (event.key === 'Tab') return
      if (event.key === 'Escape') {
        if (focusedId) {
          setLiveId(null)
          setFocusedId(null)
        }
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
  }, [driveAll, focusedId, liveId, settingsOpen])

  const focused = useMemo(
    () =>
      instances.find((scout) => scout.id === focusedId) ??
      instances.find((scout) => scout.focused) ??
      instances[0] ??
      null,
    [instances, focusedId]
  )

  const sorted = useMemo(() => sortInstances(instances, instanceSort), [instances, instanceSort])

  const queueNotices = useMemo(() => {
    const hidden = new Set(dismissedNotices)
    const byId = new Map<string, QueueNotice>()
    for (const scout of instances) {
      const notice = scout.queueNotice
      if (!notice?.text) continue
      const key = `${notice.id}|${notice.text}`
      if (hidden.has(key) || byId.has(key)) continue
      byId.set(key, notice)
    }
    return [...byId.values()]
  }, [instances, dismissedNotices])

  const autoLocked =
    fullAuto.phase !== 'idle' &&
    fullAuto.phase !== 'aborted' &&
    fullAuto.phase !== 'done' &&
    fullAuto.phase !== 'error'

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
        <DrivePad instance={focused} fleetCount={instances.length} standalone />
      </div>
    )
  }

  return (
    <div className="shell">
      <div className="chrome">
        <FleetBar
          url={url}
          count={instances.length}
          ram={ram}
          muted={muted}
          driveAll={driveAll}
          mode={mode}
          onMode={setMode}
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
          fleetLocked={autoLocked}
        />
        {mode === 'auto' ? <FullAutoPanel fleetSize={instances.length} status={fullAuto} /> : null}
      </div>
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
          actionsLocked={autoLocked}
        />
        <main className={`main ${focused && liveId === focused.id ? 'locked' : ''}`}>
          {queueNotices.map((notice) => (
            <QueueNoticeBox
              key={`${notice.id}|${notice.text}`}
              notice={notice}
              onDismiss={() =>
                setDismissedNotices((ids) =>
                  [...ids, `${notice.id}|${notice.text}`].slice(-DISMISSED_NOTICE_CAP)
                )
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
              <DrivePad instance={focused} fleetCount={instances.length} />
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
              instance={focused}
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
