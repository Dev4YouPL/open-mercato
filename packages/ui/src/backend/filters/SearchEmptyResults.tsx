'use client'
import * as React from 'react'
import { SearchX, X } from 'lucide-react'
import { Button } from '../../primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type SearchEmptyResultsProps = {
  /** The active search query, shown back to the user. */
  query: string
  /** Plural entity label (e.g. "companies"); falls back to a generic word. */
  entityNamePlural?: string
  /**
   * The same label in the form the description needs after its negation word
   * ("couldn't find any {entity}" → Polish "żadnych wyników"). Case inflecting
   * languages need a different word there; the rest translate this key to the
   * same string as `entityNamePlural`. Falls back to `entityNamePlural`.
   */
  entityNamePluralGenitive?: string
  /** Clears the active search. */
  onClearSearch: () => void
}

export function SearchEmptyResults({ query, entityNamePlural, entityNamePluralGenitive, onClearSearch }: SearchEmptyResultsProps) {
  const t = useT()
  const entity = entityNamePluralGenitive ?? entityNamePlural ?? t('ui.dataTable.search.empty.genericEntity', 'results')
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-4 py-10 text-center" data-testid="search-empty-results">
      <div className="flex size-16 items-center justify-center rounded-full bg-muted">
        <SearchX className="size-7 text-muted-foreground" aria-hidden />
      </div>
      <div className="flex flex-col items-center gap-1">
        <div className="text-base font-semibold text-foreground">
          {t('ui.dataTable.search.empty.title', 'No results found')}
        </div>
        <p className="text-sm text-muted-foreground">
          {t(
            'ui.dataTable.search.empty.description',
            'We couldn’t find any {entity} matching “{query}”. Try adjusting your search or filters.',
            { entity, query },
          )}
        </p>
      </div>
      <Button type="button" onClick={onClearSearch}>
        <X className="size-4" aria-hidden />
        {t('ui.dataTable.search.empty.clear', 'Clear search')}
      </Button>
    </div>
  )
}
