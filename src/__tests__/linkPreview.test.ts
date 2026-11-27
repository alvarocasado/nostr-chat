import { it, expect } from 'vitest'
import { shouldShowLinkPreview } from '../lib/linkPreview'

it('off never shows a preview', () => {
  expect(shouldShowLinkPreview('off', true, true)).toBe(false)
})

it('contacts shows previews for own and contact messages only', () => {
  expect(shouldShowLinkPreview('contacts', true, false)).toBe(true)
  expect(shouldShowLinkPreview('contacts', false, true)).toBe(true)
  expect(shouldShowLinkPreview('contacts', false, false)).toBe(false)
})

it('all shows previews for strangers too', () => {
  expect(shouldShowLinkPreview('all', false, false)).toBe(true)
})
