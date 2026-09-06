/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'

// BomHeaderFormClient wraps itself in a card by default so it looks right
// standalone on the create page. BomEditorClient hosts it alongside the
// lines table under its own shared outer card, so it passes
// `wrapInCard={false}` to avoid a nested double border. This pins both ends
// of that contract directly against the component (not just its caller).

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (key: string, fallback?: string) => fallback ?? key
  return { useT: () => translate }
})

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: true, result: { granted: [] } })),
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: () => <div data-testid="crud-form-stub" />,
}))

import { BomHeaderFormClient } from '../BomHeaderFormClient'

describe('BomHeaderFormClient wrapInCard', () => {
  it('wraps itself in a card by default (standalone use, e.g. the create page)', () => {
    render(<BomHeaderFormClient />)
    const form = screen.getByTestId('crud-form-stub')
    expect(form.closest('.rounded-xl.border.bg-card')).not.toBeNull()
  })

  it('renders without its own wrapper when wrapInCard is false (embedded use)', () => {
    render(<BomHeaderFormClient wrapInCard={false} />)
    const form = screen.getByTestId('crud-form-stub')
    expect(form.closest('.rounded-xl.border.bg-card')).toBeNull()
  })
})
