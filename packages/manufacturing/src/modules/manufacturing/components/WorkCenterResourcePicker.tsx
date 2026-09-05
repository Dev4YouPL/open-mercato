"use client"

import * as React from "react"
import { Check, X } from "lucide-react"
import { Alert } from "@open-mercato/ui/primitives/alert"
import { Button } from "@open-mercato/ui/primitives/button"
import { Input } from "@open-mercato/ui/primitives/input"
import { StatusBadge } from "@open-mercato/ui/primitives/status-badge"
import { useT } from "@open-mercato/shared/lib/i18n/context"
import {
  hydrateSelectedResources,
  loadResourceCandidates,
  mergeResourceOptions,
  sortResourceIds,
  type ResourceOption,
} from "./workCenterResourceOptions"

export type WorkCenterResourcePickerProps = {
  value: string[]
  onChange: (next: string[]) => void
  /** Scope token: a tenant/organization or record switch must discard old labels. */
  scopeKey: string
  disabled?: boolean
  /** Set when the caller already knows membership cannot be edited. */
  unavailableReason?: "provider" | "forbidden" | null
}

/**
 * Multi-resource selector for the Work Centre form.
 *
 * Selections are the source of truth and survive every failure: a search error
 * is not an empty catalogue, and loading or empty states never clear what the
 * author picked. Stale responses are ignored rather than applied, so switching
 * scope or typing quickly cannot repopulate labels from a previous query.
 */
export function WorkCenterResourcePicker({
  value,
  onChange,
  scopeKey,
  disabled = false,
  unavailableReason = null,
}: WorkCenterResourcePickerProps) {
  const t = useT()
  const [search, setSearch] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [candidates, setCandidates] = React.useState<ResourceOption[]>([])
  const [labels, setLabels] = React.useState<ResourceOption[]>([])
  const [hasMore, setHasMore] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState(false)
  const [retryToken, setRetryToken] = React.useState(0)

  const canQuery = unavailableReason === null
  const selectedIds = React.useMemo(() => sortResourceIds(value), [value])
  const selectedKey = selectedIds.join(",")

  // A scope change invalidates every cached label immediately — a name resolved
  // in another tenant/organization must never linger on screen.
  React.useEffect(() => {
    setLabels([])
    setCandidates([])
    setSearch("")
    setPage(1)
    setLoadError(false)
  }, [scopeKey])

  // Hydrate the stored selection by id, independently of the candidate query.
  React.useEffect(() => {
    if (!canQuery || selectedIds.length === 0) return
    const controller = new AbortController()
    let cancelled = false
    void (async () => {
      try {
        const hydrated = await hydrateSelectedResources(selectedIds, controller.signal)
        if (cancelled) return
        setLabels((prev) => mergeResourceOptions(prev, hydrated))
      } catch {
        // A hydration failure leaves ids opaque; it never drops a selection.
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [canQuery, scopeKey, selectedKey, selectedIds])

  // Candidate page. Resetting `page` on a search change is what keeps the list
  // a real remote search rather than a capped first-page catalogue.
  React.useEffect(() => {
    if (!canQuery) return
    const controller = new AbortController()
    let cancelled = false
    setIsLoading(true)
    setLoadError(false)
    void (async () => {
      try {
        const result = await loadResourceCandidates(search, page, controller.signal)
        if (cancelled) return
        setCandidates((prev) => (page === 1 ? result.options : mergeResourceOptions(prev, result.options)))
        setLabels((prev) => mergeResourceOptions(prev, result.options))
        setHasMore(result.hasMore)
      } catch {
        if (!cancelled) setLoadError(true)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [canQuery, page, retryToken, scopeKey, search])

  const labelById = React.useMemo(() => {
    const map = new Map<string, ResourceOption>()
    for (const option of labels) map.set(option.id, option)
    return map
  }, [labels])

  const toggle = React.useCallback(
    (id: string) => {
      if (disabled || !canQuery) return
      const next = selectedIds.includes(id) ? selectedIds.filter((entry) => entry !== id) : [...selectedIds, id]
      onChange(sortResourceIds(next))
    },
    [canQuery, disabled, onChange, selectedIds],
  )

  const handleSearchChange = React.useCallback((next: string) => {
    setSearch(next)
    setPage(1)
  }, [])

  const readOnly = disabled || !canQuery

  return (
    <div className="flex flex-col gap-3">
      {unavailableReason ? (
        <Alert variant="warning">
          {unavailableReason === "provider"
            ? t(
                "manufacturing.workCenters.picker.providerUnavailable",
                "The resources module is unavailable, so membership cannot be changed. Existing resources are kept.",
              )
            : t(
                "manufacturing.workCenters.picker.forbidden",
                "You do not have the resources view permission, so membership cannot be changed.",
              )}
        </Alert>
      ) : null}

      <div aria-live="polite" className="text-sm text-muted-foreground">
        {t("manufacturing.workCenters.picker.selected", "{count} selected").replace(
          "{count}",
          String(selectedIds.length),
        )}
      </div>

      {selectedIds.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={t("manufacturing.workCenters.picker.label", "Resources")}>
          {selectedIds.map((id) => {
            const option = labelById.get(id)
            const name = option?.unresolved
              ? t("manufacturing.workCenters.picker.unresolved", "Unavailable resource")
              : (option?.name ?? id)
            return (
              <li key={id} className="flex items-center gap-2 rounded-md border border-border bg-muted px-2 py-1">
                <span className="text-sm">{name}</span>
                {option && !option.unresolved && !option.isActive ? (
                  <StatusBadge variant="warning" dot>
                    {t("manufacturing.workCenters.picker.inactiveBadge", "Inactive")}
                  </StatusBadge>
                ) : null}
                {option?.unresolved ? (
                  <StatusBadge variant="neutral" dot>
                    {id}
                  </StatusBadge>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={readOnly}
                  aria-label={t("manufacturing.workCenters.picker.remove", "Remove {name}").replace("{name}", name)}
                  onClick={() => toggle(id)}
                >
                  <X className="size-4" aria-hidden />
                </Button>
              </li>
            )
          })}
        </ul>
      ) : null}

      {canQuery ? (
        <>
          <Input
            type="search"
            value={search}
            disabled={readOnly}
            aria-label={t("manufacturing.workCenters.picker.placeholder", "Search resources")}
            placeholder={t("manufacturing.workCenters.picker.placeholder", "Search resources")}
            onChange={(event) => handleSearchChange(event.target.value)}
          />

          {loadError ? (
            <Alert
              variant="destructive"
              action={
                <Button type="button" variant="outline" size="sm" onClick={() => setRetryToken((token) => token + 1)}>
                  {t("manufacturing.workCenters.picker.retry", "Retry")}
                </Button>
              }
            >
              {t(
                "manufacturing.workCenters.picker.loadError",
                "Could not load resources. Your selection is unchanged.",
              )}
            </Alert>
          ) : (
            <ul
              className="max-h-64 overflow-y-auto rounded-md border border-border"
              role="listbox"
              aria-multiselectable
              aria-busy={isLoading}
              aria-label={t("manufacturing.workCenters.picker.label", "Resources")}
            >
              {candidates.map((option) => {
                const isSelected = selectedIds.includes(option.id)
                return (
                  <li key={option.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      disabled={readOnly}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted"
                      onClick={() => toggle(option.id)}
                    >
                      <span>{option.name}</span>
                      {isSelected ? <Check className="size-4" aria-hidden /> : null}
                    </button>
                  </li>
                )
              })}
              {candidates.length === 0 && !isLoading ? (
                <li className="px-3 py-2 text-sm text-muted-foreground">
                  {t("manufacturing.workCenters.picker.empty", "No resources match this search")}
                </li>
              ) : null}
              {isLoading ? (
                <li className="px-3 py-2 text-sm text-muted-foreground">
                  {t("manufacturing.workCenters.picker.loading", "Loading resources...")}
                </li>
              ) : null}
            </ul>
          )}

          {hasMore && !loadError ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isLoading || readOnly}
              onClick={() => setPage((current) => current + 1)}
            >
              {t("manufacturing.workCenters.picker.loadMore", "Load more")}
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

export default WorkCenterResourcePicker
