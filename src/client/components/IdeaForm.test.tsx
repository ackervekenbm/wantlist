import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { IdeaForm, parseBudget } from './IdeaForm'

describe('parseBudget', () => {
  it.each([
    ['', null],
    ['150', 150],
    ['89,99', 89.99],
    ['€ 89.5', 89.5],
    ['0', undefined],
    ['cheap', undefined],
    ['1.299', undefined],
  ])('%s → %s', (input, expected) => {
    expect(parseBudget(input)).toBe(expected)
  })
})

describe('IdeaForm capture', () => {
  it('cannot hide budget and notes while they hold a value, since they still count', async () => {
    const user = userEvent.setup()
    render(<IdeaForm compact submitLabel="Add" onSubmit={vi.fn(async () => {})} />)
    await user.click(screen.getByRole('button', { name: '+ Budget & notes' }))
    expect(screen.getByRole('button', { name: 'Hide budget & notes' })).toBeInTheDocument()

    await user.type(screen.getByLabelText('Budget'), 'cheap')
    expect(screen.queryByRole('button', { name: /budget & notes/i })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Budget')).toBeVisible()

    await user.clear(screen.getByLabelText('Budget'))
    await user.click(screen.getByRole('button', { name: 'Hide budget & notes' }))
    expect(screen.queryByLabelText('Budget')).not.toBeInTheDocument()
  })
})
