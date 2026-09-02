import { useEffect, useState, type FormEvent } from 'react'
import type { ShippingProfile } from '@shared/types'

type Props = {
  open: boolean
  onClose: () => void
}

export default function SettingsModal({ open, onClose }: Props) {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setSaved(false)
    void window.foxbox.getSettings().then((profile) => {
      setName(profile.name)
      setAddress(profile.address)
    })
  }, [open])

  if (!open) return null

  const onSave = (event: FormEvent): void => {
    event.preventDefault()
    setSaving(true)
    void window.foxbox
      .saveSettings({ name, address })
      .then((profile) => {
        setName(profile.name)
        setAddress(profile.address)
        setSaved(true)
      })
      .finally(() => setSaving(false))
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        onClick={(event) => event.stopPropagation()}
        onSubmit={onSave}
      >
        <div className="modal-head">
          <strong>Autofill</strong>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close settings">
            ×
          </button>
        </div>
        <p className="hint">
          Saved on this machine only. Name and address are filled into checkout forms on every fox.
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
