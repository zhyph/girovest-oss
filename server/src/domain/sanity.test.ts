import { describe, it, expect } from 'vitest'
import { addOne } from './sanity.js'

describe('addOne', () => {
  it('adds one to a number', () => {
    expect(addOne(1)).toBe(2)
  })
})
