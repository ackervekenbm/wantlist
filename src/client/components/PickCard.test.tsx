import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { pick } from '../test/fakeApi'
import { parseBudget } from './IdeaForm'
import { PickCard } from './PickCard'

function renderPick(...args: Parameters<typeof pick>) {
  return render(
    <ol>
      <PickCard pick={pick(...args)} budget={null} />
    </ol>,
  )
}

describe('PickCard', () => {
  it('shows a checked price, stock, rating, why and caveat', () => {
    renderPick()
    expect(screen.getByText('€ 249,99')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'checked at the shop' })).toBeInTheDocument()
    expect(screen.getByText('In stock')).toBeInTheDocument()
    expect(screen.getByText('4.6')).toBeInTheDocument()
    expect(screen.getByText('(88)')).toBeInTheDocument()
    expect(screen.getByText('Fan speed follows your heart rate')).toBeInTheDocument()
    expect(screen.getByText('Watch out:', { exact: false })).toHaveTextContent('Watch out:')
    expect(screen.getByText('Pricey for a fan')).toBeInTheDocument()
  })

  it('marks a price only seen in search as approximate', () => {
    renderPick({
      price: 59,
      suppliers: [{ shop: 'X', url: 'https://x.be/a', price: 59, availability: 'unknown', checked: false }],
    })
    expect(screen.getByText('≈ € 59')).toHaveAttribute('title', expect.stringMatching(/search results/))
    expect(screen.queryByText('In stock')).not.toBeInTheDocument()
  })

  it('flags sold out and over budget', () => {
    render(
      <ol>
        <PickCard
          pick={pick({
            suppliers: [{ shop: 'X', url: 'https://x.be/a', price: 249.99, availability: 'out_of_stock', checked: true }],
          })}
          budget={200}
        />
      </ol>,
    )
    expect(screen.getByText('Sold out')).toBeInTheDocument()
    expect(screen.getByText('over budget')).toBeInTheDocument()
  })

  it('lists the other shops on demand', async () => {
    const user = userEvent.setup()
    renderPick()
    expect(screen.queryByRole('list', { name: /Other shops/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /\+1 shop/ }))
    const shops = screen.getByRole('list', { name: 'Other shops for Wahoo KICKR Headwind' })
    expect(within(shops).getByRole('link', { name: /bol/ })).toHaveAttribute('href', 'https://www.bol.com/be/nl/p/headwind/1')
    expect(within(shops).getByText('≈ € 259')).toBeInTheDocument()
  })

  it('falls back to the rank without a photo, and offers "I bought this" when asked', async () => {
    const onBought = vi.fn()
    const user = userEvent.setup()
    render(
      <ol>
        <PickCard pick={pick({ image: null, rank: 2 })} budget={null} onBought={onBought} />
      </ol>,
    )
    expect(screen.getByText('2')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /I bought this/ }))
    expect(onBought).toHaveBeenCalledOnce()
  })
})

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
