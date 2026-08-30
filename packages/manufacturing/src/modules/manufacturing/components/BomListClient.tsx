"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Page, PageBody } from "@open-mercato/ui/backend/Page"
import { DataTable } from "@open-mercato/ui/backend/DataTable"
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy"
import { Button } from "@open-mercato/ui/primitives/button"
import { IconButton } from "@open-mercato/ui/primitives/icon-button"
import { RowActions } from "@open-mercato/ui/backend/RowActions"
import { ListEmptyState } from "@open-mercato/ui/backend/filters/ListEmptyState"
import { FilteredEmptyResults } from "@open-mercato/ui/backend/filters/FilteredEmptyResults"
import { LookupSelect } from "@open-mercato/ui/backend/inputs"
import { ErrorMessage } from "@open-mercato/ui/backend/detail"
import { apiCall, apiCallOrThrow } from "@open-mercato/ui/backend/utils/apiCall"
import { buildOptimisticLockHeader } from "@open-mercato/ui/backend/utils/optimisticLock"
import { useGuardedMutation } from "@open-mercato/ui/backend/injection/useGuardedMutation"
import { useConfirmDialog } from "@open-mercato/ui/backend/confirm-dialog"
import { flash } from "@open-mercato/ui/backend/FlashMessages"
import { useT } from "@open-mercato/shared/lib/i18n/context"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { formatCatalogTarget, parseCatalogLabel, type CatalogLabel } from "./catalogLabels"
import { loadProductOptionsWithSelection, loadVariantOptionsWithSelection } from "./catalogLookups"
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
  const [filterProductId, setFilterProductId] = React.useState<string | null>(null)
  const [filterVariantId, setFilterVariantId] = React.useState<string | null>(null)
  const hasFilters = Boolean(filterProductId || filterVariantId)

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
  const resetCursors = React.useCallback(() => {
    setCursorStack([undefined])
    setCursorIndex(0)
  }, [])

  const handleProductFilter = React.useCallback((next: string | null) => {
    setFilterProductId(next)
    setFilterVariantId(null)
    resetCursors()
  }, [resetCursors])

  const handleVariantFilter = React.useCallback((next: string | null) => {
    setFilterVariantId(next)
    resetCursors()
  }, [resetCursors])

  const handleClearFilters = React.useCallback(() => {
    setFilterProductId(null)
    setFilterVariantId(null)
    resetCursors()
  }, [resetCursors])

  const handleNext = React.useCallback(() => {
    if (!nextCursor) return
    setCursorStack((prev) => {
      const next = prev.slice(0, cursorIndex + 1)
      next.push(nextCursor)
      return next
    })
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

  const columns = React.useMemo<ColumnDef<BomListRow>[]>(() => [
    {
      accessorKey: "productId",
      header: t("manufacturing.boms.list.columns.target", "Target"),
      meta: { alwaysVisible: true },
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
      cell: ({ row }) => `#${row.original.revisionNumber}${row.original.revisionLabel ? ` — ${row.original.revisionLabel}` : ""}`,
    },
    {
      accessorKey: "lineCount",
      header: t("manufacturing.boms.list.columns.lines", "Direct lines"),
      cell: ({ row }) => row.original.lineCount,
    },
    {
      accessorKey: "unresolvedProduceCount",
      header: t("manufacturing.boms.list.columns.unresolved", "Unresolved"),
      cell: ({ row }) => row.original.unresolvedProduceCount,
    },
    {
      accessorKey: "updatedAt",
      header: t("manufacturing.boms.list.columns.updatedAt", "Updated"),
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
            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-sm text-muted-foreground">{t("manufacturing.boms.form.product", "Product")}</div>
                <LookupSelect
                  value={filterProductId}
                  onChange={handleProductFilter}
                  fetchOptions={(query) => loadProductOptionsWithSelection(query, filterProductId)}
                  placeholder={t("manufacturing.boms.list.filters.productPlaceholder", "Filter by product")}
                />
              </div>
              <div>
                <div className="mb-1 text-sm text-muted-foreground">{t("manufacturing.boms.form.variant", "Variant")}</div>
                <LookupSelect
                  key={`filter-variant-${filterProductId ?? "none"}`}
                  value={filterVariantId}
                  onChange={handleVariantFilter}
                  fetchOptions={(query) => loadVariantOptionsWithSelection(filterProductId, query, filterVariantId)}
                  disabled={!filterProductId}
                  placeholder={t("manufacturing.boms.list.filters.variantPlaceholder", "Filter by variant")}
                />
              </div>
            </div>
            <DataTable<BomListRow>
              extensionTableId={extensionTableId}
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
              emptyState={hasFilters ? (
                <FilteredEmptyResults
                  entityNamePlural={t("manufacturing.boms.entityPlural", "BOM drafts")}
                  canRemoveLast={Boolean(filterVariantId)}
                  onClearAll={handleClearFilters}
                  onRemoveLast={() => handleVariantFilter(null)}
                />
              ) : (
                <ListEmptyState
                  entityName={t("manufacturing.boms.entityPlural", "BOM drafts")}
                  createHref={canManage ? "/backend/manufacturing/boms/create" : undefined}
                  createLabel={t("manufacturing.boms.list.actions.new", "New BOM")}
                />
              )}
            />
            <div className="mt-3 flex items-center justify-end gap-2">
              <IconButton
                type="button"
                aria-label={t("manufacturing.boms.list.actions.previous", "Previous page")}
                disabled={cursorIndex === 0 || isLoading}
                onClick={handlePrevious}
              >
                <ChevronLeft />
              </IconButton>
              <IconButton
                type="button"
                aria-label={t("manufacturing.boms.list.actions.next", "Next page")}
                disabled={!hasMore || isLoading}
                onClick={handleNext}
              >
                <ChevronRight />
              </IconButton>
            </div>
          </>
        )}
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}

export default BomListClient
