import { describe, expect, it } from 'vitest'
import {
  pickLocalMatch,
  productIdFromUrl,
  scoreHits,
  scoreProduct,
  type ProductHit
} from '../src/main/productMatch'

describe('productIdFromUrl', () => {
  it('extracts the product id', () => {
    expect(productIdFromUrl('https://secretlair.wizards.com/us/product/12345/black-panther')).toBe('12345')
  })
})

describe('scoreProduct', () => {
  it('scores an exact title highly', () => {
    expect(scoreProduct('Black Panther Foil', 'Secret Lair x Black Panther Foil Edition', 'foil')).toBeGreaterThan(0.5)
  })

  it('penalizes foil mismatch', () => {
    const foil = scoreProduct('Black Panther', 'Black Panther Foil', 'foil')
    const non = scoreProduct('Black Panther', 'Black Panther Foil', 'nonfoil')
    expect(foil).toBeGreaterThan(non)
  })
})

describe('pickLocalMatch', () => {
  const hits: ProductHit[] = [
    { url: 'https://secretlair.wizards.com/us/product/1/black-panther-foil', title: 'Black Panther Foil' },
    { url: 'https://secretlair.wizards.com/us/product/2/old-drop', title: 'Some Other Drop' }
  ]

  it('picks a unique high-scoring new listing', () => {
    const candidates = scoreHits('Black Panther Foil', 'foil', hits, new Set())
    const match = pickLocalMatch(candidates)
    expect(match?.url).toContain('/product/1')
  })

  it('returns null when nothing is close', () => {
    const candidates = scoreHits('Completely Unrelated Query', 'any', hits, new Set())
    expect(pickLocalMatch(candidates)).toBeNull()
  })
})
