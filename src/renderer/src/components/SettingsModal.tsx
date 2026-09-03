import { useEffect, useState, type FormEvent } from 'react'
import type { AppSettings, ThemeId } from '@shared/types'
import { applyTheme } from '../theme'

type Props = {
  open: boolean
  onClose: () => void
}

const THEMES: { id: ThemeId; label: string; blurb: string }[] = [
  { id: 'dungeon', label: 'Dungeon', blurb: 'Torchlight on stone' },
  { id: 'daylight', label: 'Daylight', blurb: 'Sun on the entrance' }
]

export default function SettingsModal({ open, onClose }: Props) {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [theme, setTheme] = useState<ThemeId>('dungeon')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setSaved(false)
    void window.lairscout.getSettings().then((settings) => {
      setName(settings.name)
      setAddress(settings.address)
      setPhone(settings.phone ?? '')
      setTheme(settings.theme)
      applyTheme(settings.theme)
    })
  }, [open])

  if (!open) return null

  const persist = (next: AppSettings): Promise<void> => {
    setSaving(true)
    return window.lairscout
      .saveSettings(next)
      .then((settings) => {
        setName(settings.name)
        setAddress(settings.address)
        setPhone(settings.phone ?? '')
        setTheme(settings.theme)
        applyTheme(settings.theme)
        setSaved(true)
      })
      .finally(() => setSaving(false))
  }

  const onSave = (event: FormEvent): void => {
    event.preventDefault()
    void persist({ name, address, phone, theme })
  }

  const onPickTheme = (next: ThemeId): void => {
    setTheme(next)
    applyTheme(next)
    void persist({ name, address, phone, theme: next })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        onClick={(event) => event.stopPropagation()}
        onSubmit={onSave}
      >
        <div className="modal-head">
          <strong>Settings</strong>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close settings">
            ×
          </button>
        </div>
        <label className="field">
          <span>Theme</span>
          <div className="theme-picks">
            {THEMES.map((option) => (
              <button
                key={option.id}
                className={`btn theme-pick ${theme === option.id ? 'active' : ''}`}
                type="button"
                onClick={() => onPickTheme(option.id)}
              >
                <span className={`theme-swatch ${option.id}`} />
                <strong>{option.label}</strong>
                <small>{option.blurb}</small>
              </button>
            ))}
          </div>
        </label>
        <p className="hint">
          Saved on this machine only. Name and address are filled into checkout forms on every scout.
        </p>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Jane Doe" />
        </label>
        <label className="field">
          <span>Address</span>
          <textarea
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            rows={4}
            placeholder={'123 Main St\nSpringfield, IL 62701'}
          />
        </label>
        <label className="field">
          <span>Phone</span>
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="555-867-5309"
            inputMode="tel"
          />
        </label>
        <div className="top-actions" style={{ justifyContent: 'flex-end' }}>
          {saved ? <span className="hint">Saved. Live boxes will autofill on the next checkout page.</span> : null}
          <button className="btn" type="button" onClick={onClose}>
            Close
          </button>
          <button className="btn primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}
