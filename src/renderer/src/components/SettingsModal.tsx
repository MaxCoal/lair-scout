import { useEffect, useState, type FormEvent } from 'react'
import type { AppSettings, ShippingProfile, ThemeId } from '@shared/types'
import { applyTheme } from '../theme'

type Props = {
  open: boolean
  onClose: () => void
}

const THEMES: { id: ThemeId; label: string; blurb: string }[] = [
  { id: 'dungeon', label: 'Dungeon', blurb: 'Torchlight on stone' },
  { id: 'daylight', label: 'Daylight', blurb: 'Sun on the entrance' }
]

const EMPTY: ShippingProfile = {
  email: '',
  firstName: '',
  lastName: '',
  address1: '',
  address2: '',
  city: '',
  state: '',
  zip: ''
}

export default function SettingsModal({ open, onClose }: Props) {
  const [form, setForm] = useState<ShippingProfile>(EMPTY)
  const [theme, setTheme] = useState<ThemeId>('dungeon')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setSaved(false)
    void window.lairscout.getSettings().then((settings) => {
      setForm({
        email: settings.email,
        firstName: settings.firstName,
        lastName: settings.lastName,
        address1: settings.address1,
        address2: settings.address2,
        city: settings.city,
        state: settings.state,
        zip: settings.zip
      })
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
        setForm({
          email: settings.email,
          firstName: settings.firstName,
          lastName: settings.lastName,
          address1: settings.address1,
          address2: settings.address2,
          city: settings.city,
          state: settings.state,
          zip: settings.zip
        })
        setTheme(settings.theme)
        applyTheme(settings.theme)
        setSaved(true)
      })
      .finally(() => setSaving(false))
  }

  const patch = (key: keyof ShippingProfile, value: string): void => {
    setForm((current) => ({ ...current, [key]: value }))
    setSaved(false)
  }

  const onSave = (event: FormEvent): void => {
    event.preventDefault()
    void persist({ ...form, theme })
  }

  const onPickTheme = (next: ThemeId): void => {
    setTheme(next)
    applyTheme(next)
    void persist({ ...form, theme: next })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal checkout-modal"
        noValidate
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
          These map 1:1 to Secret Lair guest checkout. Saved on this machine and filled into every scout.
        </p>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(event) => patch('email', event.target.value)}
            placeholder="you@example.com"
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span>First name</span>
            <input
              autoComplete="given-name"
              value={form.firstName}
              onChange={(event) => patch('firstName', event.target.value)}
              placeholder="Jane"
            />
          </label>
          <label className="field">
            <span>Last name</span>
            <input
              autoComplete="family-name"
              value={form.lastName}
              onChange={(event) => patch('lastName', event.target.value)}
              placeholder="Doe"
            />
          </label>
        </div>
        <label className="field">
          <span>Address line 1</span>
          <input
            autoComplete="address-line1"
            value={form.address1}
            onChange={(event) => patch('address1', event.target.value)}
            placeholder="123 Main St"
          />
        </label>
        <label className="field">
          <span>Address line 2</span>
          <input
            autoComplete="address-line2"
            value={form.address2}
            onChange={(event) => patch('address2', event.target.value)}
            placeholder="Apt, suite (optional)"
          />
        </label>
        <div className="field-row city-row">
          <label className="field">
            <span>City</span>
            <input
              autoComplete="address-level2"
              value={form.city}
              onChange={(event) => patch('city', event.target.value)}
              placeholder="Springfield"
            />
          </label>
          <label className="field">
            <span>State</span>
            <input
              autoComplete="address-level1"
              value={form.state}
              onChange={(event) => patch('state', event.target.value.toUpperCase().slice(0, 2))}
              placeholder="IL"
              maxLength={2}
            />
          </label>
          <label className="field">
            <span>ZIP</span>
            <input
              autoComplete="postal-code"
              value={form.zip}
              onChange={(event) => patch('zip', event.target.value)}
              placeholder="62701"
            />
          </label>
        </div>
        <p className="checkout-preview">
          <span>Checkout preview</span>
          {[
            form.email,
            [form.firstName, form.lastName].filter(Boolean).join(' '),
            form.address1,
            form.address2,
            [form.city, [form.state, form.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
          ]
            .filter(Boolean)
            .join(' · ') || 'Fill the fields above — they map to Email, First name, Last name, and Address line 1 on the cart page.'}
        </p>
        <div className="top-actions" style={{ justifyContent: 'flex-end' }}>
          {saved ? <span className="hint">Saved. Checkout fields fill when the cart page is open.</span> : null}
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
