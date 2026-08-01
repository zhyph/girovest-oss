import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  LOCATION_SCOPED_MODELS,
  MANUALLY_SCOPED_MODELS,
  MODELS_WITH_LOCATION_ID_COLUMN,
} from './scopedClient.js'

const MODELS_PRISMA_PATH = path.join(import.meta.dirname, '../../prisma/models.prisma')

function modelsWithLocationIdFromSchema(): Set<string> {
  const source = fs.readFileSync(MODELS_PRISMA_PATH, 'utf-8')
  const modelBlocks = [...source.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)]
  const result = new Set<string>()
  for (const [, name, body] of modelBlocks) {
    if (/^\s*locationId\s+String/m.test(body!)) {
      result.add(name!.charAt(0).toLowerCase() + name!.slice(1))
    }
  }
  return result
}

describe('scopedDb model registry vs. models.prisma', () => {
  it('MODELS_WITH_LOCATION_ID_COLUMN matches every model that actually declares a locationId field', () => {
    const fromSchema = modelsWithLocationIdFromSchema()
    expect(MODELS_WITH_LOCATION_ID_COLUMN).toEqual(fromSchema)
  })

  it('every locationId-bearing model is registered in exactly one of the two lists', () => {
    const scoped = new Set(LOCATION_SCOPED_MODELS)
    const manual = new Set(Object.keys(MANUALLY_SCOPED_MODELS))
    for (const model of MODELS_WITH_LOCATION_ID_COLUMN) {
      const inScoped = scoped.has(model)
      const inManual = manual.has(model)
      expect(inScoped || inManual).toBe(true)
      expect(inScoped && inManual).toBe(false)
    }
  })
})
