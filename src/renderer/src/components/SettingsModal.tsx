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

function maskNumber(last4: string): string {
  return last4 ? `•••• •••• •••• ${last4}` : ''
}

export default function SettingsModal({ open, onClose }: Props) {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [theme, setTheme] = useState<ThemeId>('dungeon')
  const [cardHolderName, setCardHolderName] = useState('')
  const [cardNumber, setCardNumber] = useState('')
  const [cardExpiry, setCardExpiry] = useState('')
  const [hasCard, setHasCard] = useState(false)
  const [llmApiKey, setLlmApiKey] = useState('')
  const [hasLlmKey, setHasLlmKey] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const applySettings = (settings: AppSettings): void => {
    setName(settings.name)
    setAddress(settings.address)
    setPhone(settings.phone ?? '')
    setEmail(settings.email ?? '')
    setTheme(settings.theme)
    setCardHolderName(settings.cardHolderName || settings.name)
    setCardNumber(settings.hasCard ? maskNumber(settings.cardLast4) : '')
    setCardExpiry(settings.cardExpiry || '')
    setHasCard(settings.hasCard)
    setHasLlmKey(settings.hasLlmKey)
    setLlmApiKey('')
    applyTheme(settings.theme)
  }

  useEffect(() => {
    if (!open) return
    setSaved(false)
    setError('')
    void window.lairscout.getSettings().then(applySettings)
  }, [open])

  if (!open) return null

  const persist = (next: {
    name: string
    address: string
    phone: string
    email: string
    theme: ThemeId
    cardHolderName: string
    cardNumber: string
    cardExpiry: string
    llmApiKey: string
  }): Promise<void> => {
    setSaving(true)
    setError('')
    return window.lairscout
      .saveSettings(next)
      .then((settings) => {
        applySettings(settings)
        setSaved(true)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setSaving(false))
  }

  const onSave = (event: FormEvent): void => {
    event.preventDefault()
    void persist({ name, address, phone, email, theme, cardHolderName, cardNumber, cardExpiry, llmApiKey })
  }

  const onPickTheme = (next: ThemeId): void => {
    setTheme(next)
    applyTheme(next)
    void persist({ name, address, phone, email, theme: next, cardHolderName, cardNumber, cardExpiry, llmApiKey })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal settings-modal"
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
          Saved on this machine only. Name, email, and address are filled into checkout forms on every scout.
        </p>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Jane Doe" />
        </label>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="jane@example.com"
            autoComplete="email"
          />
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
        <p className="hint">
          Card number and expiry are encrypted on this PC. CVV is never saved — enter it when you Arm Full Auto.
        </p>
        <label className="field">
          <span>Name on card</span>
          <input
            value={cardHolderName}
            onChange={(event) => setCardHolderName(event.target.value)}
            placeholder={name || 'Jane Doe'}
            autoComplete="cc-name"
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Card number</span>
            <input
              value={cardNumber}
              onChange={(event) => setCardNumber(event.target.value)}
              placeholder={hasCard ? maskNumber('0000') : '4242 4242 4242 4242'}
              inputMode="numeric"
              autoComplete="cc-number"
            />
          </label>
          <label className="field">
            <span>Expiry</span>
            <input
              value={cardExpiry}
              onChange={(event) => setCardExpiry(event.target.value)}
              placeholder="MM/YY"
              autoComplete="cc-exp"
            />
          </label>
        </div>
        <label className="field">
          <span>Optional AI key (OpenAI)</span>
          <input
            type="password"
            value={llmApiKey}
            onChange={(event) => setLlmApiKey(event.target.value)}
            placeholder={hasLlmKey ? 'Saved — paste a new key to replace' : 'Used only if two products look similar'}
            autoComplete="off"
          />
        </label>
        <div className="top-actions" style={{ justifyContent: 'flex-end' }}>
          {error ? <span className="hint">{error}</span> : null}
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
