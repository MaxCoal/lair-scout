import { describe, expect, it } from 'vitest'
import {
  composePersonName,
  normalizeShipping,
  parseAddressBlob,
  shippingReady,
  splitPersonName
} from '@shared/shipping'

describe('splitPersonName', () => {
  it('splits first and remaining names', () => {
    expect(splitPersonName('Jane Q Doe')).toEqual({ firstName: 'Jane', lastName: 'Q Doe' })
  })
})

describe('composePersonName', () => {
  it('joins names and falls back', () => {
    expect(composePersonName('Jane', 'Doe')).toBe('Jane Doe')
    expect(composePersonName('', '', 'Pat')).toBe('Pat')
  })
})

describe('parseAddressBlob', () => {
  it('parses a city/state/zip line', () => {
    expect(parseAddressBlob('Springfield, IL 62701')).toEqual({
      address1: '',
      address2: '',
      city: 'Springfield',
      state: 'IL',
      zip: '62701'
    })
  })

  it('parses a single city/state/zip line with street', () => {
    expect(parseAddressBlob('123 Main St, Springfield, IL 62701')).toEqual({
      address1: '123 Main St',
      address2: '',
      city: 'Springfield',
      state: 'IL',
      zip: '62701'
    })
  })

  it('parses a multiline address', () => {
    expect(parseAddressBlob('123 Main St\nApt 4\nSpringfield, IL 62701')).toEqual({
      address1: '123 Main St',
      address2: 'Apt 4',
      city: 'Springfield',
      state: 'IL',
      zip: '62701'
    })
  })
})

describe('normalizeShipping', () => {
  it('fills structured fields from a blob and composed name', () => {
    const ship = normalizeShipping({
      name: 'Jane Doe',
      email: 'jane@example.com',
      address: '123 Main St\nSpringfield, IL 62701'
    })
    expect(ship.firstName).toBe('Jane')
    expect(ship.lastName).toBe('Doe')
    expect(ship.address1).toBe('123 Main St')
    expect(ship.city).toBe('Springfield')
    expect(ship.state).toBe('IL')
    expect(ship.zip).toBe('62701')
    expect(ship.country).toBe('US')
  })
})

describe('shippingReady', () => {
  it('requires name, email, and street', () => {
    expect(
      shippingReady({
        name: 'Jane Doe',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        address: '',
        address1: '123 Main St',
        address2: '',
        city: 'Springfield',
        state: 'IL',
        zip: '62701',
        country: 'US',
        phone: ''
      })
    ).toBe(true)
    expect(shippingReady(normalizeShipping({}))).toBe(false)
  })
})
