/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'

// BOM create/edit should read as one big tile with smaller tiles inside it,
// mirroring the warranty-claim intake layout, instead of several independent
// top-level cards stacked on the page.
//
// BomHeaderFormClient wraps itself in a card by default (used standalone on
// the create page). The editor page hosts both the header form and the
// lines table, so it opts the header form out of its own wrapper
// (`wrapInCard={false}`) and supplies ONE shared outer card instead —
// otherwise the header section would render inside a nested double border.

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (key: string, fallback?: string) => fallback ?? key
  return { useT: () => translate }
})

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: true, result: {} })),
}))

const bomHeaderFormClientMock = jest.fn((props: { wrapInCard?: boolean }) => (
  <div data-testid="bom-header-form" data-wrap-in-card={String(props.wrapInCard)} />
))

jest.mock('../BomHeaderFormClient', () => ({
  BomHeaderFormClient: (props: { wrapInCard?: boolean }) => bomHeaderFormClientMock(props),
}))

jest.mock('../BomLinesEditor', () => ({
  BomLinesEditor: () => <div data-testid="bom-lines-editor" />,
}))

describe('BOM editor — outer big tile', () => {
  beforeEach(() => {
    bomHeaderFormClientMock.mockClear()
  })

  it('wraps the header form and the lines editor in one shared card, and opts the header form out of its own wrapper', async () => {
    const detail = {
      id: 'bom-1',
      target: { productId: 'product-1', variantId: null },
      targetLabel: { productName: 'Signature Haircut & Finish', variantName: null },
      activeDraft: {
        id: 'draft-1',
        revisionNumber: 1,
        revisionLabel: null,
        baseOutput: { value: '1', unitCode: 'hour', normalizedValue: '1', baseUnitCode: 'hour' },
        updatedAt: '2026-09-04T00:00:00.000Z',
      },
      directLineSummary: { count: 0, unresolvedProduceCount: 0 },
      updatedAt: '2026-09-04T00:00:00.000Z',
    }
    jest.requireMock('@open-mercato/ui/backend/utils/apiCall').apiCall.mockResolvedValueOnce({ ok: true, result: detail })

    const { BomEditorClient } = await import('../BomEditorClient')
    render(<BomEditorClient bomId="bom-1" />)

    const header = await screen.findByTestId('bom-header-form')
    const lines = screen.getByTestId('bom-lines-editor')

    // Both sections must sit under the same outer tile — not two independent
    // top-level cards — so find the nearest ancestor carrying the card classes
    // and assert it contains both.
    const outer = header.closest('.rounded-xl.border.bg-card')
    expect(outer).not.toBeNull()
    expect(outer!.contains(lines)).toBe(true)

    // The header form must not also render its own wrapping card here, or the
    // header section would sit inside a nested double border.
    expect(header.getAttribute('data-wrap-in-card')).toBe('false')
  })
})
