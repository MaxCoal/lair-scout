import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { InstanceSnapshot, RamSnapshot } from '@shared/types'
import FleetBar from './components/FleetBar'
import Sidebar from './components/Sidebar'
import InstanceGrid from './components/InstanceGrid'
import FocusView from './components/FocusView'
import DrivePad from './components/DrivePad'

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

  useEffect(() => {
    return window.foxbox.onRam(setRam)
  }, [])

  useEffect(() => {
    return window.foxbox.onUpdate(setInstances)
  }, [])

  useEffect(() => {
    return window.foxbox.onAdmitted(() => {
      if (!muted) playTone(784, 1175)
    })
  }, [muted])

  useEffect(() => {
    return window.foxbox.onQueuePopped(() => {
      if (!muted) playTone(392, 784)
    })
  }, [muted])

  useEffect(() => {
    void window.foxbox.setFocused(focusedId)
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
      window.foxbox.key({
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

  const sendAll = (event: FormEvent): void => {
    event.preventDefault()
    void window.foxbox.gotoAll(url)
  }

  const rushCheckout = (): void => {
    if (rushing) return
    setRushing(true)
    void window.foxbox.rushCheckout().finally(() => setRushing(false))
  }

  const selectFox = (id: string, live: boolean): void => {
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
        onScaleTo={(next) => window.foxbox.scaleTo(next)}
        onToggleMute={() => {
          const next = !muted
          setMuted(next)
          void window.foxbox.setMuted(next)
        }}
        onToggleDriveAll={() => {
          setDriveAll((value) => {
            const next = !value
            setLiveId(null)
            if (next) void window.foxbox.openDriveWindow()
            else void window.foxbox.closeDriveWindow()
            return next
          })
        }}
        onOpenDriveWindow={() => window.foxbox.openDriveWindow()}
      />
      <div className="workspace">
        <Sidebar
          instances={instances}
          focusedId={focusedId}
          onFocus={(id) => selectFox(id, !driveAll)}
          onKill={(id) => {
            if (focusedId === id) setFocusedId(null)
            if (liveId === id) setLiveId(null)
            void window.foxbox.kill(id)
          }}
        />
        <main className="main">
          {instances.length >= 6 ? (
            <p className="warn">Each Chromium uses a lot of RAM. Scale down if the machine starts swapping.</p>
          ) : null}
          {driveAll ? (
            <div className="drive-layout">
              <p className="hint">
                Drive all is on. Use the zoomed view or the extra window on another monitor. Click a tile to choose which
                fox you watch.
              </p>
              <DrivePad fox={focused} fleetCount={instances.length} />
              <div className="drive-thumbs">
                <InstanceGrid
                  instances={instances}
                  driveAll={driveAll}
                  onFocus={(id) => selectFox(id, false)}
                  onGotoOne={(id) => window.foxbox.gotoOne(id, url)}
                />
              </div>
            </div>
          ) : focused && liveId === focused.id ? (
            <FocusView
              fox={focused}
              driveAll={false}
              fleetCount={instances.length}
              live
              onBack={() => {
                setLiveId(null)
                setFocusedId(null)
              }}
            />
          ) : (
            <InstanceGrid
              instances={instances}
              driveAll={false}
              onFocus={(id) => selectFox(id, true)}
              onGotoOne={(id) => window.foxbox.gotoOne(id, url)}
            />
          )}
        </main>
      </div>
    </div>
  )
}
