import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../i18n.ts'
import { ChunkErrorBoundary } from './ChunkErrorBoundary.tsx'

function Bomb(): never {
  throw new Error('chunk load failed')
}

function GenericBomb(): never {
  throw new TypeError("Cannot read properties of undefined (reading 'foo')")
}

describe('ChunkErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    // restoreAllMocks does not undo vi.stubGlobal; without this the stubbed
    // `location` would leak into every test that runs after this file.
    vi.unstubAllGlobals()
  })

  it('renders children when nothing throws', () => {
    render(
      <ChunkErrorBoundary>
        <div>content</div>
      </ChunkErrorBoundary>,
    )
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('shows a reload action instead of unmounting the app when a child throws', async () => {
    // React logs the caught error to the console by default; silence it so
    // the expected throw doesn't look like a test failure in the output.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })

    render(
      <ChunkErrorBoundary>
        <Bomb />
      </ChunkErrorBoundary>,
    )

    const reloadButton = screen.getByRole('button', { name: 'Recarregar' })
    expect(reloadButton).toBeInTheDocument()
    await userEvent.click(reloadButton)
    expect(reload).toHaveBeenCalledOnce()
    expect(screen.getByText('Não foi possível carregar esta parte do aplicativo.')).toBeInTheDocument()
  })

  it('shows a generic message, not the chunk-load one, for an unrelated crash', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ChunkErrorBoundary>
        <GenericBomb />
      </ChunkErrorBoundary>,
    )

    expect(screen.getByText('Ocorreu um erro inesperado no aplicativo.')).toBeInTheDocument()
    expect(
      screen.queryByText('Não foi possível carregar esta parte do aplicativo.'),
    ).not.toBeInTheDocument()
  })
})
