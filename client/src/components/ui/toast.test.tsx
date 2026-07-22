import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider, useToast } from './toast.tsx'

function TriggerButton({ message }: { message: string }) {
  const { showToast } = useToast()
  return <button onClick={() => showToast(message)}>disparar</button>
}

describe('ToastProvider / useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows a toast when showToast is called', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(
      <ToastProvider>
        <TriggerButton message="Algo deu errado." />
      </ToastProvider>,
    )

    await user.click(screen.getByText('disparar'))

    expect(screen.getByRole('alert')).toHaveTextContent('Algo deu errado.')
  })

  it('dismisses the toast when its close button is clicked', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(
      <ToastProvider>
        <TriggerButton message="Algo deu errado." />
      </ToastProvider>,
    )

    await user.click(screen.getByText('disparar'))
    expect(screen.getByRole('alert')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not auto-dismiss — every message today is an error the staff needs to act on', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(
      <ToastProvider>
        <TriggerButton message="Algo deu errado." />
      </ToastProvider>,
    )

    await user.click(screen.getByText('disparar'))
    expect(screen.getByRole('alert')).toBeInTheDocument()

    vi.advanceTimersByTime(60000)

    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('throws when useToast is used outside a ToastProvider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    function Broken() {
      useToast()
      return null
    }
    expect(() => render(<Broken />)).toThrow('useToast must be used within a ToastProvider')
    consoleError.mockRestore()
  })
})
