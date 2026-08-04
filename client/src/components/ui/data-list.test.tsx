import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { DataList, DataListEmpty, type DataListColumn, type DataListGroup } from './data-list.tsx'
import { RowActions, DropdownMenuItem } from './dropdown-menu.tsx'

type Row = { id: string; name: string; price: string }

const columns: DataListColumn<Row>[] = [
  { key: 'name', header: 'Produto', width: '1.6fr', cell: (row) => <span>{row.name}</span> },
  { key: 'price', header: 'Aluguel', width: '108px', align: 'right', cell: (row) => <span>{row.price}</span> },
]

const groups: DataListGroup<Row>[] = [
  {
    key: 'a',
    label: 'A',
    meta: '2',
    rows: [
      { id: '1', name: 'Vestido longo marsala', price: '890,00' },
      { id: '2', name: 'Vestido midi champagne', price: '740,00' },
    ],
  },
  { key: 'b', label: 'B', rows: [{ id: '3', name: 'Bolero cetim marfim', price: '590,00' }] },
]

describe('DataList', () => {
  it('renders the column headers, group headers and every row', () => {
    render(<DataList columns={columns} groups={groups} rowKey={(row) => row.id} />)

    expect(screen.getByText('Produto')).toBeInTheDocument()
    expect(screen.getByText('Aluguel')).toBeInTheDocument()
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.getByText('Vestido longo marsala')).toBeInTheDocument()
    expect(screen.getByText('Bolero cetim marfim')).toBeInTheDocument()
  })

  it('marks the selected row so it stays identifiable while the detail panel is read', () => {
    const { rerender } = render(
      <DataList
        columns={columns}
        groups={groups}
        rowKey={(row) => row.id}
        rowLabel={(row) => row.name}
        onSelectRow={vi.fn()}
        selectedKey={null}
      />,
    )
    expect(screen.queryByRole('button', { current: true })).not.toBeInTheDocument()

    rerender(
      <DataList
        columns={columns}
        groups={groups}
        rowKey={(row) => row.id}
        rowLabel={(row) => row.name}
        onSelectRow={vi.fn()}
        selectedKey="2"
      />,
    )
    expect(screen.getByRole('button', { current: true })).toHaveAccessibleName('Vestido midi champagne')
  })

  it('selects a row by click and by keyboard', async () => {
    const onSelectRow = vi.fn()
    render(
      <DataList
        columns={columns}
        groups={groups}
        rowKey={(row) => row.id}
        rowLabel={(row) => row.name}
        onSelectRow={onSelectRow}
      />,
    )

    await userEvent.click(screen.getByText('Vestido longo marsala'))
    expect(onSelectRow).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }))

    // A row is a real control, not a click handler on a div: it has to be
    // reachable and actionable from the keyboard too.
    onSelectRow.mockClear()
    screen.getByRole('button', { name: 'Bolero cetim marfim' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(onSelectRow).toHaveBeenCalledWith(expect.objectContaining({ id: '3' }))
  })

  it('CRITICAL: shows a real focus ring, not the hover tint, when a row is tabbed to', async () => {
    render(
      <DataList
        columns={columns}
        groups={groups}
        rowKey={(row) => row.id}
        rowLabel={(row) => row.name}
        onSelectRow={vi.fn()}
      />,
    )

    const rowControl = screen.getByRole('button', { name: 'Vestido longo marsala' })
    // `outline-none` with nothing else is what shipped: the visible "focus"
    // state was the same surface-sunken tint as hover, so a keyboard user had
    // no way to tell a focused row from one the mouse happened to be over.
    expect(rowControl.className).toMatch(/focus-visible:outline-2/)
    expect(rowControl.className).toMatch(/focus-visible:outline-ring/)
    // Without this the ring is present in the markup and invisible on screen:
    // `outline-none` sets `--tw-outline-style: none`, and `outline-2` only
    // sets a width plus `outline-style: var(--tw-outline-style)`.
    expect(rowControl.className).toMatch(/focus-visible:outline-solid/)
    expect(rowControl.className).not.toMatch(/focus-visible:bg-/)

    await userEvent.tab()
    expect(rowControl).toHaveFocus()
  })

  it('is not zebra-striped — the hairline separates rows instead', () => {
    const { container } = render(
      <DataList
        columns={columns}
        groups={groups}
        rowKey={(row) => row.id}
        rowLabel={(row) => row.name}
        onSelectRow={vi.fn()}
      />,
    )

    // Striping would consume the signal the split view needs for hover and
    // selection, so no row may carry a background of its own by position.
    const rows = Array.from(container.querySelectorAll('.border-hairline'))
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.className).not.toMatch(/odd:bg-|even:bg-|nth/)
    }
  })

  it('shows the empty state instead of headers-over-nothing when every group is empty', () => {
    render(
      <DataList
        columns={columns}
        groups={[{ key: 'a', label: 'A', rows: [] }]}
        rowKey={(row) => row.id}
        empty={<DataListEmpty title="Nenhum cliente encontrado para essa busca." hint="Limpe a busca." />}
      />,
    )

    expect(screen.getByText('Nenhum cliente encontrado para essa busca.')).toBeInTheDocument()
    expect(screen.queryByText('Vestido longo marsala')).not.toBeInTheDocument()
  })

  it('disables the pagination edge it is already at', async () => {
    const onPrevious = vi.fn()
    const onNext = vi.fn()
    render(
      <DataList
        columns={columns}
        groups={groups}
        rowKey={(row) => row.id}
        pagination={{ label: '1–3 de 3', onPrevious, onNext, hasPrevious: false, hasNext: true }}
      />,
    )

    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Próximo' }))
    expect(onNext).toHaveBeenCalledOnce()
    expect(onPrevious).not.toHaveBeenCalled()
  })
})

describe('RowActions', () => {
  it('keeps per-row actions behind one affordance and does not select the row when opened', async () => {
    const onSelectRow = vi.fn()
    const onDelete = vi.fn()
    const withActions: DataListColumn<Row>[] = [
      ...columns,
      {
        key: 'actions',
        width: '34px',
        cell: () => (
          <RowActions label="Ações">
            <DropdownMenuItem onSelect={onDelete}>Excluir</DropdownMenuItem>
          </RowActions>
        ),
      },
    ]
    render(
      <DataList
        columns={withActions}
        groups={groups}
        rowKey={(row) => row.id}
        rowLabel={(row) => row.name}
        onSelectRow={onSelectRow}
      />,
    )

    await userEvent.click(screen.getAllByRole('button', { name: 'Ações' })[0])

    // Opening the menu must not also open the detail panel for that row.
    expect(onSelectRow).not.toHaveBeenCalled()
    await userEvent.click(await screen.findByText('Excluir'))
    expect(onDelete).toHaveBeenCalledOnce()
    expect(onSelectRow).not.toHaveBeenCalled()
  })

  it('CRITICAL: leaves the ⋯ trigger reachable to assistive tech', async () => {
    const withActions: DataListColumn<Row>[] = [
      ...columns,
      {
        key: 'actions',
        width: '34px',
        cell: () => (
          <RowActions label="Ações">
            <DropdownMenuItem onSelect={vi.fn()}>Excluir</DropdownMenuItem>
          </RowActions>
        ),
      },
    ]
    render(
      <DataList
        columns={withActions}
        groups={groups}
        rowKey={(row) => row.id}
        rowLabel={(row) => row.name}
        onSelectRow={vi.fn()}
      />,
    )

    const trigger = screen.getAllByRole('button', { name: 'Ações' })[0]

    // The row used to be `role="button"` with the trigger nested inside it.
    // ARIA's children-presentational rule prunes everything inside a button
    // from the accessibility tree, so the menu was simply not there for a
    // screen-reader user — while every DOM-level query, including the test
    // above this one, kept passing. Testing-library does not model pruning,
    // so the check has to be the structural one: no interactive ancestor.
    expect(trigger.parentElement?.closest('button, [role="button"], a, [role="link"]')).toBeNull()

    // And it is its own tab stop, alongside the row's own control.
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Vestido longo marsala' })).toHaveFocus()
    await userEvent.tab()
    expect(trigger).toHaveFocus()
  })
})
