import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildDriverSteps } from './buildDriverSteps.ts'
import { TOURS } from './tours.ts'
import tourCopy from '../../locales/pt-BR/tour.json'

function addAnchor(selectorValue: string) {
  const el = document.createElement('div')
  el.setAttribute('data-tour', selectorValue)
  document.body.appendChild(el)
  return el
}

function fakeTranslate(key: string) {
  return `t:${key}`
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('buildDriverSteps', () => {
  it('inclui apenas os passos cujo elemento existe no DOM', () => {
    addAnchor('clients.create')
    addAnchor('clients.table')
    // 'clients.search' intentionally omitted

    const steps = buildDriverSteps('clients', fakeTranslate)

    expect(steps.map((step) => step.element)).toEqual(['[data-tour="clients.create"]', '[data-tour="clients.table"]'])
  })

  it('resolve título e descrição via a função de tradução fornecida', () => {
    addAnchor('clients.create')

    const steps = buildDriverSteps('clients', fakeTranslate)

    expect(steps[0].popover).toEqual({
      title: 't:clients.steps.create.title',
      description: 't:clients.steps.create.description',
    })
  })

  it('retorna lista vazia quando nenhum elemento da seção está presente', () => {
    const steps = buildDriverSteps('products', fakeTranslate)
    expect(steps).toEqual([])
  })

  it('chama a tradução com as chaves esperadas', () => {
    addAnchor('dashboard.title')
    const t = vi.fn(fakeTranslate)

    buildDriverSteps('dashboard', t)

    expect(t).toHaveBeenCalledWith('dashboard.steps.title.title')
    expect(t).toHaveBeenCalledWith('dashboard.steps.title.description')
  })
})

/*
  A step whose copy is missing does not fail loudly — driver.js happily shows
  the raw key as its title. Registering the anchor and writing the two lines
  are separate edits in separate files, which is exactly the pair that gets
  half-done.
*/
describe('every registered step has copy', () => {
  it('finds a title and a description for each anchor in every section', () => {
    for (const [section, steps] of Object.entries(TOURS)) {
      for (const step of steps) {
        const copy = (
          tourCopy as unknown as Record<
            string,
            { steps?: Record<string, { title?: string; description?: string }> }
          >
        )[section]?.steps?.[step.anchor]
        expect(copy?.title, `missing title for ${section}.${step.anchor}`).toBeTruthy()
        expect(copy?.description, `missing description for ${section}.${step.anchor}`).toBeTruthy()
      }
    }
  })
})
