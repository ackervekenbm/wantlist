import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Route } from '../lib/route'
import { Shell } from './Shell'

const routes: Route[] = [{ name: 'home' }, { name: 'idea', id: 1 }, { name: 'lists', tab: 'bought' }]

describe('Shell', () => {
  it.each(routes)('renders both panes and tags the route ($name)', (route) => {
    const { container } = render(
      <Shell route={route} left={<p>left side</p>} right={<p>right side</p>} banner={<p>a banner</p>} toast={<p>a toast</p>} />,
    )
    const shell = container.querySelector('.shell')!
    expect(shell).toHaveAttribute('data-route', route.name)
    expect(shell.querySelector('.pane-left')).toHaveTextContent('left side')
    expect(shell.querySelector('.pane-right')).toBeInTheDocument()
    expect(screen.getAllByText('a banner')).toHaveLength(1)
    expect(screen.getAllByText('a toast')).toHaveLength(1)
  })

  it('shows the empty state in the right pane on home, the screen elsewhere', () => {
    const { rerender, container } = render(<Shell route={{ name: 'home' }} left={null} right={<p>idea screen</p>} />)
    expect(container.querySelector('.pane-right')).toHaveTextContent('Pick an idea on the left, or add one')
    rerender(<Shell route={{ name: 'idea', id: 1 }} left={null} right={<p>idea screen</p>} />)
    expect(container.querySelector('.pane-right')).toHaveTextContent('idea screen')
    expect(screen.queryByText('Pick an idea on the left, or add one')).not.toBeInTheDocument()
  })
})
