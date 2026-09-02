import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { InstanceSnapshot } from '@shared/types'
import FleetBar from './components/FleetBar'
import Sidebar from './components/Sidebar'
import InstanceGrid from './components/InstanceGrid'
import FocusView from './components/FocusView'

const DEFAULT_URL = 'https://secretlair.wizards.com/us'

function playAdmitTone(): void {
  const ctx = new AudioContext()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'triangle'
  osc.frequency.value = 784
  gain.gain.value = 0.05
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start()
  osc.frequency.exponentialRampToValueAtTime(1175, ctx.currentTime + 0.18)
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4)
  osc.stop(ctx.currentTime + 0.42)
}

export default function App() {
  const [instances, setInstances] = useState<InstanceSnapshot[]>([])
  const [url, setUrl] = useState(DEFAULT_URL)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)

  useEffect(() => {
    return window.foxbox.onUpdate(setInstances)
  }, [])

  useEffect(() => {
    return window.foxbox.onAdmitted(() => {
      if (!muted) playAdmitTone()
    })
  }, [muted])

  useEffect(() => {
    void window.foxbox.setFocused(focusedId)
  }, [focusedId])

  const focused = useMemo(
    () => instances.find((fox) => fox.id === focusedId) ?? null,
    [instances, focusedId]
  )

  const sendAll = (event: FormEvent): void => {
    event.preventDefault()
    void window.foxbox.gotoAll(url)
  }

  return (
    <div className="shell">
      <FleetBar
        url={url}
        count={instances.length}
        muted={muted}
        onUrl={setUrl}
        onSendAll={sendAll}
        onSpawn={() => window.foxbox.spawn()}
        onKillLast={() => {
          const last = instances.at(-1)
          if (last) void window.foxbox.kill(last.id)
        }}
        onToggleMute={() => {
          const next = !muted
          setMuted(next)
          void window.foxbox.setMuted(next)
        }}
      />
      <div className="workspace">
        <Sidebar
          instances={instances}
          focusedId={focusedId}
          onFocus={setFocusedId}
          onKill={(id) => {
            if (focusedId === id) setFocusedId(null)
            void window.foxbox.kill(id)
          }}
        />
        <main className="main">
          {instances.length >= 6 ? (
            <p className="warn">Each Firefox uses a lot of RAM. Scale down if the machine starts swapping.</p>
          ) : null}
          {focused ? (
            <FocusView fox={focused} onBack={() => setFocusedId(null)} />
          ) : (
            <InstanceGrid
              instances={instances}
              url={url}
              onFocus={setFocusedId}
              onGotoOne={(id) => window.foxbox.gotoOne(id, url)}
            />
          )}
        </main>
      </div>
    </div>
  )
}
