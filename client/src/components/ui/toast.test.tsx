import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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

  it('auto-dismisses after the toast duration elapses', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(
      <ToastProvider>
        <TriggerButton message="Algo deu errado." />
      </ToastProvider>,
    )

    await user.click(screen.getByText('disparar'))
    expect(screen.getByRole('alert')).toBeInTheDocument()

    vi.advanceTimersByTime(5000)

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
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
