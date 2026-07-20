import { describe, it, expect } from 'vitest'
import path from 'path'
import { resolveServerCwd } from './main.ts'

describe('resolveServerCwd', () => {
  it('resolves to the server workspace relative to the electron app root', () => {
    const result = resolveServerCwd('/home/user/dress-store-app/client')
    expect(result).toBe(path.resolve('/home/user/dress-store-app/client', '..', 'server'))
  })
})
