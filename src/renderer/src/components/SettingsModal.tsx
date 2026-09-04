import { useEffect, useState, type FormEvent } from 'react'
import type { AppSettings, ThemeId } from '@shared/types'
import { normalizeShipping } from '@shared/shipping'
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
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [address1, setAddress1] = useState('')
  const [address2, setAddress2] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zip, setZip] = useState('')
  const [country, setCountry] = useState('US')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [theme, setTheme] = useState<ThemeId>('dungeon')
  const [cardHolderName, setCardHolderName] = useState('')
  const [cardNumber, setCardNumber] = useState('')
  const [cardExpiry, setCardExpiry] = useState('')
  const [hasCard, setHasCard] = useState(false)
  const [cardLast4, setCardLast4] = useState('')
  const [llmApiKey, setLlmApiKey] = useState('')
  const [hasLlmKey, setHasLlmKey] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const applySettings = (settings: AppSettings): void => {
    const ship = normalizeShipping(settings)
    setFirstName(ship.firstName)
    setLastName(ship.lastName)
    setAddress1(ship.address1)
    setAddress2(ship.address2)
    setCity(ship.city)
    setState(ship.state)
    setZip(ship.zip)
    setCountry(ship.country || 'US')
    setPhone(ship.phone)
    setEmail(ship.email)
    setTheme(settings.theme)
    setCardHolderName(settings.cardHolderName || ship.name)
    setCardNumber(settings.hasCard ? maskNumber(settings.cardLast4) : '')
    setCardExpiry(settings.cardExpiry || '')
    setHasCard(settings.hasCard)
    setCardLast4(settings.cardLast4 || '')
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

  const shippingFields = () =>
    normalizeShipping({
      firstName,
      lastName,
      address1,
      address2,
      city,
      state,
      zip,
      country,
      phone,
      email
    })

  const persist = (next: ReturnType<typeof shippingFields> & {
    theme: ThemeId
    cardHolderName: string
    cardNumber: string
    cardExpiry: string
    llmApiKey: string
    clearCard?: boolean
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
    void persist({ ...shippingFields(), theme, cardHolderName, cardNumber, cardExpiry, llmApiKey })
  }

  const onPickTheme = (next: ThemeId): void => {
    setTheme(next)
    applyTheme(next)
    void persist({ ...shippingFields(), theme: next, cardHolderName, cardNumber, cardExpiry, llmApiKey })
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
          Saved on this machine only. Fields match Secret Lair checkout so Full Auto fills the same boxes you see in
          the scout.
        </p>
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
        <div className="field-row names">
          <label className="field">
            <span>First name</span>
            <input
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              placeholder="Jane"
              autoComplete="given-name"
            />
          </label>
          <label className="field">
            <span>Last name</span>
            <input
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              placeholder="Doe"
              autoComplete="family-name"
            />
          </label>
        </div>
        <label className="field">
          <span>Address line 1</span>
          <input
            value={address1}
            onChange={(event) => setAddress1(event.target.value.slice(0, 25))}
            placeholder="123 Main St"
            autoComplete="address-line1"
            maxLength={25}
          />
        </label>
        <label className="field">
          <span>
            Address line 2 <em className="opt">optional</em>
          </span>
          <input
            value={address2}
            onChange={(event) => setAddress2(event.target.value.slice(0, 25))}
            placeholder="Apt, suite, unit"
            autoComplete="address-line2"
            maxLength={25}
          />
        </label>
        <div className="field-row country-zip">
          <label className="field">
            <span>Country</span>
            <select value={country} onChange={(event) => setCountry(event.target.value)} autoComplete="country">
              <option value="US">United States</option>
            </select>
          </label>
          <label className="field">
            <span>Zip code</span>
            <input
              value={zip}
              onChange={(event) => setZip(event.target.value.toUpperCase())}
              placeholder="62701"
              autoComplete="postal-code"
            />
          </label>
        </div>
        <div className="field-row city-state">
          <label className="field">
            <span>City</span>
            <input
              value={city}
              onChange={(event) => setCity(event.target.value)}
              placeholder="Springfield"
              autoComplete="address-level2"
            />
          </label>
          <label className="field">
            <span>State</span>
            <input
              value={state}
              onChange={(event) => setState(event.target.value.toUpperCase().slice(0, 2))}
              placeholder="IL"
              autoComplete="address-level1"
              maxLength={2}
            />
          </label>
        </div>
        <label className="field">
          <span>Phone</span>
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="5558675309"
            inputMode="tel"
            autoComplete="tel"
          />
        </label>
        <p className="hint">
          Card number and expiry are encrypted on this PC. CVV is never saved — enter it when you Arm Full Auto.
          Phone is sent as digits only.
        </p>
        <button
          className="btn ghost"
          type="button"
          onClick={() => {
            if (hasCard && cardLast4 !== '4242') {
              const ok = window.confirm(
                'This replaces the card saved in Settings with the Stripe test card 4242. Continue?'
              )
              if (!ok) return
            }
            const ship = shippingFields()
            void persist({
              ...ship,
              firstName: ship.firstName || 'Test',
              lastName: ship.lastName || 'Buyer',
              name: ship.name || 'Test Buyer',
              email: ship.email || 'test@example.com',
              address1: ship.address1 || '123 Test St',
              city: ship.city || 'Springfield',
              state: ship.state || 'IL',
              zip: ship.zip || '62701',
              country: ship.country || 'US',
              phone: ship.phone || '5550100',
              theme,
              cardHolderName: cardHolderName || ship.name || 'Test Buyer',
              cardNumber: '4242424242424242',
              cardExpiry: '12/30',
              llmApiKey
            })
          }}
        >
          Use test card
        </button>
        {hasCard ? (
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              if (!window.confirm('Remove the saved card from this PC?')) return
              void persist({
                ...shippingFields(),
                theme,
                cardHolderName: '',
                cardNumber: '',
                cardExpiry: '',
                llmApiKey,
                clearCard: true
              })
            }}
          >
            Clear saved card
          </button>
        ) : null}
        <label className="field">
          <span>Name on card</span>
          <input
            value={cardHolderName}
            onChange={(event) => setCardHolderName(event.target.value)}
            placeholder={firstName || lastName ? `${firstName} ${lastName}`.trim() : 'Jane Doe'}
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
          {saved ? <span className="hint">Saved. Restart scouts if a run is already armed.</span> : null}
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
