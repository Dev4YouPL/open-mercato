/**
 * @jest-environment jsdom
 */

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string, vars?: Record<string, unknown>) => {
    if (!vars) return fallback
    return Object.entries(vars).reduce((s, [k, v]) => s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v)), fallback)
  },
}))

import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { SearchEmptyResults } from '../SearchEmptyResults'

describe('SearchEmptyResults', () => {
  it('interpolates the entity label and the query into the description', () => {
    render(<SearchEmptyResults query="acme" entityNamePlural="companies" onClearSearch={() => {}} />)
    expect(screen.getByText(/couldn’t find any companies matching “acme”/i)).toBeInTheDocument()
  })

  it('prefers the inflected label when one is supplied', () => {
    render(
      <SearchEmptyResults
        query="acme"
        entityNamePlural="Wersje robocze BOM"
        entityNamePluralGenitive="wersji roboczych BOM"
        onClearSearch={() => {}}
      />,
    )
    expect(screen.getByText(/couldn’t find any wersji roboczych BOM matching/i)).toBeInTheDocument()
  })

  it('falls back to a generic label when no entity name is supplied', () => {
    render(<SearchEmptyResults query="acme" onClearSearch={() => {}} />)
    expect(screen.getByText(/couldn’t find any results matching/i)).toBeInTheDocument()
  })

  it('clears the search from the primary action', () => {
    const onClearSearch = jest.fn()
    render(<SearchEmptyResults query="acme" onClearSearch={onClearSearch} />)
    fireEvent.click(screen.getByRole('button', { name: /clear search/i }))
    expect(onClearSearch).toHaveBeenCalled()
  })
})
