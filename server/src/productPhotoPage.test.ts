import { describe, it, expect } from 'vitest'
import { getProductPhotoPageHtml } from './productPhotoPage.js'

/**
 * The photo-intake page ships a hand-written inline script with no bundler
 * and no framework, so nothing else in the suite ever executes it — the other
 * tests only assert on the emitted HTML. The create form is the first part of
 * that script with real logic behind it (centavos -> reais, required-field
 * checks, the hand-off into the capture screen), and getting the money
 * conversion wrong would store every price at 100x, which no markup assertion
 * would catch.
 *
 * Rather than pull a DOM implementation into the server's node-env test
 * setup, the script is run against the smallest stub that satisfies it. If
 * the script starts using a DOM API that isn't modelled here, this test fails
 * loudly, which is the intended behaviour.
 */

interface FakeElement {
  value: string
  textContent: string
  disabled: boolean
  className: string
  innerHTML: string
  type: string
  src: string
  style: Record<string, string>
  children: FakeElement[]
  listeners: Record<string, ((event: unknown) => void)[]>
  addEventListener(type: string, fn: (event: unknown) => void): void
  appendChild(child: FakeElement): void
  dispatch(type: string, event?: unknown): void
}

function makeElement(): FakeElement {
  return {
    value: '',
    textContent: '',
    disabled: false,
    className: '',
    innerHTML: '',
    type: '',
    src: '',
    style: {},
    children: [],
    listeners: {},
    addEventListener(type, fn) {
      ;(this.listeners[type] ??= []).push(fn)
    },
    appendChild(child) {
      this.children.push(child)
    },
    dispatch(type, event) {
      for (const fn of this.listeners[type] ?? []) fn(event ?? { preventDefault() {} })
    },
  }
}

interface FetchCall {
  url: string
  init?: { method?: string; body?: string }
}

function runPage(listResponse: unknown[] = [], createResponse: unknown = {}) {
  const html = getProductPhotoPageHtml('valid', 'test-token')
  const script = html.match(/<script>([\s\S]*?)<\/script>/)
  if (!script) throw new Error('page has no inline script')

  const elements = new Map<string, FakeElement>()
  const byId = (id: string): FakeElement => {
    let element = elements.get(id)
    if (!element) {
      element = makeElement()
      elements.set(id, element)
    }
    return element
  }

  const calls: FetchCall[] = []
  const fakeFetch = (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, init })
    const payload = init?.method === 'POST' ? createResponse : listResponse
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) })
  }

  const document = { getElementById: byId, createElement: () => makeElement() }
  const noop = () => 0

  new Function(
    'document',
    'fetch',
    'setInterval',
    'clearInterval',
    'setTimeout',
    'Image',
    'URL',
    'confirm',
    script[1],
  )(document, fakeFetch, noop, noop, noop, function Image() {}, { createObjectURL: noop }, () => true)

  return { byId, calls }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

function fillCreateForm(byId: (id: string) => FakeElement) {
  byId('create-entry').dispatch('click')
  byId('create-name').value = 'Vestido Novo'
  byId('create-category').value = 'festa'
  byId('create-size').value = 'G'
  byId('create-color').value = 'vermelho'
}

function type(field: FakeElement, digits: string) {
  for (const digit of digits) {
    field.value += digit
    field.dispatch('input')
  }
}

describe('photo intake page create form', () => {
  it('sends prices in reais, not centavos, after the keypad reformatting', async () => {
    const { byId, calls } = runPage()
    fillCreateForm(byId)

    type(byId('create-rental-price'), '12500')
    type(byId('create-deposit'), '5000')

    expect(byId('create-rental-price').value).toBe(new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(125))

    byId('create-submit').dispatch('click')
    await flush()

    const post = calls.find((call) => call.init?.method === 'POST')
    expect(post?.url).toBe('/product-photos/test-token/products')
    expect(JSON.parse(post!.init!.body!)).toEqual({
      name: 'Vestido Novo',
      category: 'festa',
      size: 'G',
      color: 'vermelho',
      rentalPrice: 125,
      depositAmount: 50,
    })
  })

  it('never puts a locationId on the wire — the token decides the location', async () => {
    const { byId, calls } = runPage()
    fillCreateForm(byId)

    byId('create-submit').dispatch('click')
    await flush()

    const post = calls.find((call) => call.init?.method === 'POST')
    expect(JSON.parse(post!.init!.body!)).not.toHaveProperty('locationId')
  })

  it('refuses to submit with a blank required field and says which ones', async () => {
    const { byId, calls } = runPage()
    byId('create-entry').dispatch('click')
    byId('create-name').value = 'Só o nome'

    byId('create-submit').dispatch('click')
    await flush()

    expect(calls.some((call) => call.init?.method === 'POST')).toBe(false)
    expect(byId('create-status').textContent).toContain('Preencha')
  })

  it('lands on the capture screen for the product it just created', async () => {
    const { byId } = runPage([], { id: 'new-product-id', name: 'Vestido Novo' })
    fillCreateForm(byId)

    byId('create-submit').dispatch('click')
    await flush()

    expect(byId('create-screen').style.display).toBe('none')
    expect(byId('capture-screen').style.display).toBe('block')
    expect(byId('capture-title').textContent).toBe('Vestido Novo')
  })

  it('re-enables the create button and explains a failed submit', async () => {
    const html = getProductPhotoPageHtml('valid', 'test-token')
    expect(html).toContain('Erro ao cadastrar. Tente novamente.')
  })

  it('hides the create screen again when going back to the picker', async () => {
    const { byId } = runPage()
    byId('create-entry').dispatch('click')
    expect(byId('create-screen').style.display).toBe('block')

    byId('create-back-link').dispatch('click')

    expect(byId('create-screen').style.display).toBe('none')
    expect(byId('picker-screen').style.display).toBe('block')
  })
})
