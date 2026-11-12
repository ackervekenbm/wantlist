import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  try {
    localStorage.clear()
  } catch {
    /* storage unavailable */
  }
  history.replaceState(null, '', '/')
  delete document.documentElement.dataset.theme
})

// jsdom has no modal dialogs or scrolling; these stand in for them.
HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.setAttribute('open', '')
}
// Like a browser, closing fires 'close' a task later.
HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  if (!this.hasAttribute('open')) return
  this.removeAttribute('open')
  setTimeout(() => this.dispatchEvent(new Event('close')))
}
Element.prototype.scrollIntoView = function () {}
