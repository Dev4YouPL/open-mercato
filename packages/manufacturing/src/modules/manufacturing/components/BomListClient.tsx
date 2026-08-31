"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Page, PageBody } from "@open-mercato/ui/backend/Page"
import { DataTable } from "@open-mercato/ui/backend/DataTable"
import type { FilterDef, FilterValues } from "@open-mercato/ui/backend/FilterOverlay"
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy"
import { Button } from "@open-mercato/ui/primitives/button"
import { StatusBadge } from "@open-mercato/ui/primitives/status-badge"
import { RowActions } from "@open-mercato/ui/backend/RowActions"
import { ListEmptyState } from "@open-mercato/ui/backend/filters/ListEmptyState"
import { ErrorMessage } from "@open-mercato/ui/backend/detail"
import { apiCall, apiCallOrThrow } from "@open-mercato/ui/backend/utils/apiCall"
import { buildOptimisticLockHeader } from "@open-mercato/ui/backend/utils/optimisticLock"
import { useGuardedMutation } from "@open-mercato/ui/backend/injection/useGuardedMutation"
import { useConfirmDialog } from "@open-mercato/ui/backend/confirm-dialog"
import { flash } from "@open-mercato/ui/backend/FlashMessages"
import { useT } from "@open-mercato/shared/lib/i18n/context"
import { formatCatalogTarget, parseCatalogLabel, type CatalogLabel } from "./catalogLabels"
import { loadProductOptions, loadVariantFilterOptions } from "./catalogLookups"
import { BomKeysetPager } from "./BomKeysetPager"
import { useBomPermissions } from "./useBomPermissions"

type BomListRow = {
  id: string
  productId: string
  variantId: string | null
  targetLabel: CatalogLabel
  revisionNumber: number
  revisionLabel: string | null
  lineCount: number
  unresolvedProduceCount: number
  updatedAt: string
}

type ListResponse = {
  items?: Array<{
    id: string
    target: { productId: string; variantId: string | null }
    targetLabel?: unknown
    activeDraft: { revisionNumber: number; revisionLabel: string | null; updatedAt: string }
    directLineSummary: { count: number; unresolvedProduceCount: number }
    updatedAt: string
  }>
  nextCursor?: string | null
  hasMore?: boolean
}

function mapItem(item: NonNullable<ListResponse["items"]>[number]): BomListRow {
  return {
    id: item.id,
    productId: item.target.productId,
    variantId: item.target.variantId,
    targetLabel: parseCatalogLabel(item.targetLabel),
    revisionNumber: item.activeDraft.revisionNumber,
    revisionLabel: item.activeDraft.revisionLabel,
    lineCount: item.directLineSummary.count,
    unresolvedProduceCount: item.directLineSummary.unresolvedProduceCount,
    updatedAt: item.updatedAt,
  }
}

function readFilterId(values: FilterValues, key: string): string | null {
  const value = values[key]
  return typeof value === "string" && value.trim().length ? value : null
}

export function BomListClient({ extensionTableId }: { extensionTableId: string }) {
  const t = useT()
  const router = useRouter()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { canManage } = useBomPermissions()
  const [rows, setRows] = React.useState<BomListRow[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [cursorStack, setCursorStack] = React.useState<Array<string | undefined>>([undefined])
  const [cursorIndex, setCursorIndex] = React.useState(0)
  const [nextCursor, setNextCursor] = React.useState<string | null>(null)
  const [hasMore, setHasMore] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})

  const filterProductId = readFilterId(filterValues, "productId")
  const filterVariantId = readFilterId(filterValues, "variantId")
  const hasFilters = Boolean(filterProductId || filterVariantId)

  // Filter chips and the reopened overlay both render a raw id until Catalog
  // answers, so every option a loader returns is remembered by id here.
  const optionLabels = React.useRef(new Map<string, string>())
  const [labelVersion, setLabelVersion] = React.useState(0)
  const rememberOptions = React.useCallback(<T extends { value: string; label: string }>(options: T[]): T[] => {
    let changed = false
    for (const option of options) {
      if (optionLabels.current.get(option.value) === option.label) continue
      optionLabels.current.set(option.value, option.label)
      changed = true
    }
    if (changed) setLabelVersion((n) => n + 1)
    return options
  }, [])

  const mutationContextId = "manufacturing-boms-list:delete"
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: mutationContextId, blockedMessage: t("ui.forms.flash.saveBlocked", "Save blocked by validation") })

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      const cursor = cursorStack[cursorIndex]
      const params = new URLSearchParams({ limit: "25" })
      if (cursor) params.set("cursor", cursor)
      if (filterProductId) params.set("productId", filterProductId)
      if (filterVariantId) params.set("variantId", filterVariantId)
      const call = await apiCall<ListResponse>(`/api/manufacturing/boms?${params.toString()}`, undefined, {
        fallback: { items: [], nextCursor: null, hasMore: false },
      })
      if (cancelled) return
      if (!call.ok) {
        const status = call.response?.status
        setError(status === 401 || status === 403
          ? t("manufacturing.boms.list.forbidden", "You do not have access to BOM drafts. Ask an administrator for the Manufacturing BOM view permission.")
          : t("manufacturing.boms.list.error", "Failed to load BOM drafts"))
        setIsLoading(false)
        return
      }
      const payload = call.result ?? { items: [] }
      setRows((payload.items ?? []).map(mapItem))
      setNextCursor(payload.nextCursor ?? null)
      setHasMore(Boolean(payload.hasMore))
      setIsLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [cursorIndex, cursorStack, filterProductId, filterVariantId, reloadToken, t])

  const handleRefresh = React.useCallback(() => {
    setCursorStack([undefined])
    setCursorIndex(0)
    setReloadToken((n) => n + 1)
  }, [])

  // Any filter change invalidates the cursor stack: a keyset cursor is bound to
  // its filter digest server-side, so replaying it across filters is rejected.
  const applyFilters = React.useCallback((values: FilterValues) => {
    setFilterValues(values ?? {})
    setCursorStack([undefined])
    setCursorIndex(0)
  }, [])

  const handleClearFilters = React.useCallback(() => applyFilters({}), [applyFilters])

  const handleNext = React.useCallback(() => {
    if (!nextCursor) return
    setCursorStack((prev) => [...prev.slice(0, cursorIndex + 1), nextCursor])
    setCursorIndex((i) => i + 1)
  }, [cursorIndex, nextCursor])

  const handlePrevious = React.useCallback(() => {
    setCursorIndex((i) => Math.max(0, i - 1))
  }, [])

  const handleDelete = React.useCallback(async (row: BomListRow) => {
    const confirmed = await confirm({
      title: t("manufacturing.boms.list.deleteConfirm", "Delete this BOM draft?"),
      description: t("manufacturing.boms.list.deleteConfirmDescription", "This soft-deletes the family, its draft, and its lines."),
      variant: "destructive",
    })
    if (!confirmed) return
    try {
      await runMutation({
        operation: () => apiCallOrThrow(`/api/manufacturing/boms/${row.id}`, {
          method: "DELETE",
          headers: buildOptimisticLockHeader(row.updatedAt),
        }),
        context: { formId: mutationContextId, resourceKind: "manufacturing.bom", resourceId: row.id, retryLastMutation },
      })
      flash(t("manufacturing.boms.list.deleteSuccess", "BOM draft deleted"), "success")
      handleRefresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : t("manufacturing.boms.list.deleteError", "Failed to delete BOM draft")
      flash(message, "error")
    }
  }, [confirm, handleRefresh, retryLastMutation, runMutation, t])

  const formatOptionLabel = React.useCallback(
    (value: string) => optionLabels.current.get(value) ?? value,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the ref content is versioned by labelVersion
    [labelVersion],
  )

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: "productId",
      label: t("manufacturing.boms.form.product", "Product"),
      type: "combobox",
      placeholder: t("manufacturing.boms.list.filters.productPlaceholder", "Filter by product"),
      loadOptions: async (query) => rememberOptions(await loadProductOptions(query)),
      formatValue: formatOptionLabel,
    },
    {
      id: "variantId",
      label: t("manufacturing.boms.form.variant", "Variant"),
      type: "combobox",
      placeholder: t("manufacturing.boms.list.filters.variantPlaceholder", "Filter by variant"),
      loadOptions: async (query) => rememberOptions(await loadVariantFilterOptions(query)),
      formatValue: formatOptionLabel,
    },
  ], [formatOptionLabel, rememberOptions, t])

  const columns = React.useMemo<ColumnDef<BomListRow>[]>(() => [
    {
      accessorKey: "productId",
      header: t("manufacturing.boms.list.columns.target", "Target"),
      meta: { alwaysVisible: true, truncate: true, maxWidth: "320px" },
      cell: ({ row }) => (
        <Link href={`/backend/manufacturing/boms/${row.original.id}`} className="font-medium hover:underline">
          {formatCatalogTarget(row.original.targetLabel, {
            productId: row.original.productId,
            variantId: row.original.variantId,
          })}
        </Link>
      ),
    },
    {
      accessorKey: "revisionNumber",
      header: t("manufacturing.boms.list.columns.revision", "Revision"),
      meta: { truncate: true, maxWidth: "220px" },
      cell: ({ row }) => `#${row.original.revisionNumber}${row.original.revisionLabel ? ` — ${row.original.revisionLabel}` : ""}`,
    },
    {
      accessorKey: "lineCount",
      header: t("manufacturing.boms.list.columns.lines", "Direct lines"),
      meta: { maxWidth: "140px" },
      cell: ({ row }) => row.original.lineCount,
    },
    {
      accessorKey: "unresolvedProduceCount",
      header: t("manufacturing.boms.list.columns.unresolved", "Unresolved"),
      meta: { maxWidth: "160px" },
      cell: ({ row }) => (
        <StatusBadge variant={row.original.unresolvedProduceCount > 0 ? "warning" : "neutral"} dot>
          {row.original.unresolvedProduceCount}
        </StatusBadge>
      ),
    },
    {
      accessorKey: "updatedAt",
      header: t("manufacturing.boms.list.columns.updatedAt", "Updated"),
      meta: { maxWidth: "220px" },
      cell: ({ row }) => new Date(row.original.updatedAt).toLocaleString(),
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        {error ? (
          <ErrorMessage
            label={error}
            action={<Button type="button" variant="outline" size="sm" onClick={handleRefresh}>{t("ui.actions.retry", "Retry")}</Button>}
          />
        ) : (
          <>
            <DataTable<BomListRow>
              extensionTableId={extensionTableId}
              perspective={{ tableId: extensionTableId }}
              columnChooser={{ auto: true }}
              title={t("manufacturing.boms.list.title", "BOM drafts")}
              refreshButton={{ label: t("manufacturing.boms.list.actions.refresh", "Refresh"), onRefresh: handleRefresh }}
              actions={canManage ? (
                <Button asChild>
                  <Link href="/backend/manufacturing/boms/create">{t("manufacturing.boms.list.actions.new", "New BOM")}</Link>
                </Button>
              ) : undefined}
              columns={columns}
              data={rows}
              isLoading={isLoading}
              filters={filters}
              filterValues={filterValues}
              onFiltersApply={applyFilters}
              onFiltersClear={handleClearFilters}
              onRowClick={(row) => router.push(`/backend/manufacturing/boms/${row.id}`)}
              rowActions={(row) => (
                <RowActions
                  items={[
                    { id: "open", label: t("manufacturing.boms.list.actions.open", "Open"), onSelect: () => router.push(`/backend/manufacturing/boms/${row.id}`) },
                    ...(canManage
                      ? [{ id: "delete", label: t("manufacturing.boms.list.actions.delete", "Delete"), destructive: true, onSelect: () => handleDelete(row) }]
                      : []),
                  ]}
                />
              )}
              filterAwareEmptyState={{
                active: hasFilters,
                entityNamePlural: t("manufacturing.boms.entityPlural", "BOM drafts"),
                entityNamePluralGenitive: t("manufacturing.boms.entityPluralGenitive", "BOM drafts"),
                canRemoveLast: Boolean(filterVariantId),
                onClearAll: handleClearFilters,
                onRemoveLast: () => applyFilters({ ...filterValues, variantId: undefined }),
              }}
              emptyState={(
                <ListEmptyState
                  entityName={t("manufacturing.boms.entityPlural", "BOM drafts")}
                  entityNameGenitive={t("manufacturing.boms.entityPluralGenitive", "BOM drafts")}
                  createHref={canManage ? "/backend/manufacturing/boms/create" : undefined}
                  createLabel={t("manufacturing.boms.list.actions.new", "New BOM")}
                />
              )}
            />
            <BomKeysetPager
              page={cursorIndex + 1}
              hasPrevious={cursorIndex > 0}
              hasNext={hasMore}
              isLoading={isLoading}
              onPrevious={handlePrevious}
              onNext={handleNext}
            />
          </>
        )}
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}

export default BomListClient
