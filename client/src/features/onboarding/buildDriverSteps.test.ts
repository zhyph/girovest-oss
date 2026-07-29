import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildDriverSteps } from './buildDriverSteps.ts'

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
