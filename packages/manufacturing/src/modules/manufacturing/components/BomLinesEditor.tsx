"use client"

import * as React from "react"
import { DataTable } from "@open-mercato/ui/backend/DataTable"
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy"
import { Button } from "@open-mercato/ui/primitives/button"
import { IconButton } from "@open-mercato/ui/primitives/icon-button"
import { StatusBadge, type StatusBadgeVariant } from "@open-mercato/ui/primitives/status-badge"
import { RowActions } from "@open-mercato/ui/backend/RowActions"
import { ListEmptyState } from "@open-mercato/ui/backend/filters/ListEmptyState"
import { apiCall, apiCallOrThrow } from "@open-mercato/ui/backend/utils/apiCall"
import { buildOptimisticLockHeader, extractOptimisticLockConflict } from "@open-mercato/ui/backend/utils/optimisticLock"
import { useGuardedMutation } from "@open-mercato/ui/backend/injection/useGuardedMutation"
import { useConfirmDialog } from "@open-mercato/ui/backend/confirm-dialog"
import { surfaceRecordConflict } from "@open-mercato/ui/backend/conflicts"
import { flash } from "@open-mercato/ui/backend/FlashMessages"
import { useT } from "@open-mercato/shared/lib/i18n/context"
import { ArrowUp, ArrowDown } from "lucide-react"
import { BomLineDialog, type BomLineFormValues } from "./BomLineDialog"
import { BomKeysetPager } from "./BomKeysetPager"
import { formatDecimalForDisplay, formatQuantityForDisplay } from "./bomFormatting"
import { formatCatalogTarget, parseCatalogLabel, type CatalogLabel } from "./catalogLabels"
import { useBomPermissions } from "./useBomPermissions"
import { extensionPoints } from "../extension-points"

const PAGE_SIZE = 50

export type BomLineRow = {
  id: string
  /** Sparse internal ordering key (1024, 2048, …) — never shown to the author. */
  position: number
  /** The occurrence number an author sees and the dialogs refer to. */
  ordinal: number
  componentProductId: string
  componentVariantId: string | null
  componentLabel: CatalogLabel
  enteredValue: string
  enteredUnitCode: string
  normalizedValue: string
  baseUnitCode: string
  consumptionBasis: "variable" | "fixed"
  yieldFactor: string
  supplyMode: "stock" | "produce"
  resolutionState: "stock_leaf" | "variant" | "product_fallback" | "unresolved"
  updatedAt: string
}

type LinesResponse = {
  items?: Array<{
    id: string
    position: number
    componentProductId: string
    componentVariantId: string | null
    componentLabel?: unknown
    quantity: { value: string; unitCode: string; normalizedValue: string; baseUnitCode: string }
    consumptionBasis: "variable" | "fixed"
    yieldFactor: string
    supplyMode: "stock" | "produce"
    resolution: { state: string }
    updatedAt: string
  }>
  nextCursor?: string | null
  hasMore?: boolean
}

const RESOLUTION_VARIANTS: Record<BomLineRow["resolutionState"], StatusBadgeVariant> = {
  stock_leaf: "neutral",
  variant: "success",
  product_fallback: "info",
  unresolved: "warning",
}

function mapLine(item: NonNullable<LinesResponse["items"]>[number], ordinal: number): BomLineRow {
  return {
    id: item.id,
    position: item.position,
    ordinal,
    componentProductId: item.componentProductId,
    componentVariantId: item.componentVariantId,
    componentLabel: parseCatalogLabel(item.componentLabel),
    enteredValue: item.quantity.value,
    enteredUnitCode: item.quantity.unitCode,
    normalizedValue: item.quantity.normalizedValue,
    baseUnitCode: item.quantity.baseUnitCode,
    consumptionBasis: item.consumptionBasis,
    yieldFactor: item.yieldFactor,
    supplyMode: item.supplyMode,
    resolutionState: item.resolution.state as BomLineRow["resolutionState"],
    updatedAt: item.updatedAt,
  }
}

export function BomLinesEditor({
  bomId,
  revisionId,
  revisionUpdatedAt,
  onAggregateChange,
}: {
  bomId: string
  revisionId: string
  revisionUpdatedAt: string
  onAggregateChange: () => void
}) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { canManage } = useBomPermissions()
  const [rows, setRows] = React.useState<BomLineRow[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [cursorStack, setCursorStack] = React.useState<Array<string | undefined>>([undefined])
  const [cursorIndex, setCursorIndex] = React.useState(0)
  const [nextCursor, setNextCursor] = React.useState<string | null>(null)
  const [hasMore, setHasMore] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [dialogState, setDialogState] = React.useState<{ mode: "create" } | { mode: "edit"; line: BomLineRow } | null>(null)

  const mutationContextId = `manufacturing-bom-lines:${bomId}`
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: mutationContextId, blockedMessage: t("ui.forms.flash.saveBlocked", "Save blocked by validation") })

  const resetCursors = React.useCallback(() => {
    setCursorStack([undefined])
    setCursorIndex(0)
  }, [])

  React.useEffect(() => {
    resetCursors()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revisionUpdatedAt])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      const cursor = cursorStack[cursorIndex]
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
      if (cursor) params.set("cursor", cursor)
      const call = await apiCall<LinesResponse>(`/api/manufacturing/boms/${bomId}/lines?${params.toString()}`, undefined, {
        fallback: { items: [], nextCursor: null, hasMore: false },
      })
      if (cancelled) return
      if (!call.ok) {
        const conflictHandled = surfaceRecordConflict(call.result, t)
        if (conflictHandled) { onAggregateChange(); return }
        flash(t("manufacturing.boms.lines.loadError", "Failed to load direct component lines"), "error")
        setIsLoading(false)
        return
      }
      const payload = call.result ?? { items: [] }
      // Every page but the last is exactly `PAGE_SIZE` long, so the page index
      // is enough to turn the in-page order into an absolute occurrence number.
      const firstOrdinal = cursorIndex * PAGE_SIZE + 1
      setRows((payload.items ?? []).map((item, index) => mapLine(item, firstOrdinal + index)))
      setNextCursor(payload.nextCursor ?? null)
      setHasMore(Boolean(payload.hasMore))
      setIsLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [bomId, cursorIndex, cursorStack, onAggregateChange, reloadToken, t])

  const reloadLines = React.useCallback(() => {
    resetCursors()
    setReloadToken((n) => n + 1)
  }, [resetCursors])

  const handleAfterMutation = React.useCallback(() => {
    reloadLines()
    onAggregateChange()
  }, [onAggregateChange, reloadLines])

  const handleMove = React.useCallback(async (row: BomLineRow, direction: "up" | "down") => {
    try {
      await runMutation({
        operation: async () => {
          const call = await apiCallOrThrow<{ changed: boolean }>(
            `/api/manufacturing/boms/${bomId}/lines/${row.id}/reorder`,
            {
              method: "POST",
              headers: { ...buildOptimisticLockHeader(revisionUpdatedAt), "content-type": "application/json" },
              body: JSON.stringify({ direction }),
            },
          )
          if (call.result?.changed) handleAfterMutation()
        },
        context: { formId: mutationContextId, resourceKind: "manufacturing.bom_line", resourceId: row.id, retryLastMutation },
      })
    } catch (err) {
      if (!surfaceRecordConflict(extractOptimisticLockConflict(err), t)) {
        flash(err instanceof Error ? err.message : t("manufacturing.boms.lines.reorderError", "Failed to reorder"), "error")
      } else {
        onAggregateChange()
      }
    }
  }, [bomId, handleAfterMutation, mutationContextId, onAggregateChange, retryLastMutation, revisionUpdatedAt, runMutation, t])

  const handleDelete = React.useCallback(async (row: BomLineRow) => {
    const confirmed = await confirm({
      title: t("manufacturing.boms.lines.deleteConfirm", "Delete this component occurrence?"),
      description: t(
        "manufacturing.boms.lines.deleteConfirmDescription",
        "Position {position} — {component}. This cannot be undone from another device.",
        {
          position: String(row.ordinal),
          component: formatCatalogTarget(row.componentLabel, {
            productId: row.componentProductId,
            variantId: row.componentVariantId,
          }),
        },
      ),
      variant: "destructive",
    })
    if (!confirmed) return
    try {
      await runMutation({
        operation: () => apiCallOrThrow(`/api/manufacturing/boms/${bomId}/lines/${row.id}`, {
          method: "DELETE",
          headers: buildOptimisticLockHeader(revisionUpdatedAt),
        }),
        context: { formId: mutationContextId, resourceKind: "manufacturing.bom_line", resourceId: row.id, retryLastMutation },
      })
      flash(t("manufacturing.boms.lines.deleteSuccess", "Occurrence deleted"), "success")
      handleAfterMutation()
    } catch (err) {
      if (!surfaceRecordConflict(extractOptimisticLockConflict(err), t)) {
        flash(err instanceof Error ? err.message : t("manufacturing.boms.lines.deleteError", "Failed to delete"), "error")
      } else {
        onAggregateChange()
      }
    }
  }, [bomId, confirm, handleAfterMutation, mutationContextId, onAggregateChange, retryLastMutation, revisionUpdatedAt, runMutation, t])

  const firstPosition = rows.length ? Math.min(...rows.map((row) => row.position)) : null
  const lastPosition = rows.length ? Math.max(...rows.map((row) => row.position)) : null

  const columns = React.useMemo<ColumnDef<BomLineRow>[]>(() => [
    {
      accessorKey: "ordinal",
      header: t("manufacturing.boms.lines.columns.position", "#"),
      meta: { alwaysVisible: true, maxWidth: "64px" },
    },
    {
      accessorKey: "componentProductId",
      header: t("manufacturing.boms.lines.columns.component", "Component"),
      meta: { alwaysVisible: true, truncate: true, maxWidth: "300px" },
      cell: ({ row }) => (
        <span className="font-medium">
          {formatCatalogTarget(row.original.componentLabel, {
            productId: row.original.componentProductId,
            variantId: row.original.componentVariantId,
          })}
        </span>
      ),
    },
    {
      accessorKey: "enteredValue",
      header: t("manufacturing.boms.lines.columns.quantity", "Quantity"),
      meta: { maxWidth: "180px" },
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {formatQuantityForDisplay(row.original.enteredValue, row.original.enteredUnitCode)}
        </span>
      ),
    },
    {
      accessorKey: "normalizedValue",
      header: t("manufacturing.boms.lines.columns.normalized", "Normalized"),
      meta: { maxWidth: "180px" },
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatQuantityForDisplay(row.original.normalizedValue, row.original.baseUnitCode)}
        </span>
      ),
    },
    {
      accessorKey: "consumptionBasis",
      header: t("manufacturing.boms.lines.columns.basis", "Basis"),
      meta: { maxWidth: "140px" },
      cell: ({ row }) => (row.original.consumptionBasis === "fixed"
        ? t("manufacturing.boms.lines.basis.fixed", "Fixed")
        : t("manufacturing.boms.lines.basis.variable", "Variable")),
    },
    {
      accessorKey: "yieldFactor",
      header: t("manufacturing.boms.lines.columns.yield", "Yield"),
      meta: { maxWidth: "120px" },
      cell: ({ row }) => formatDecimalForDisplay(row.original.yieldFactor),
    },
    {
      accessorKey: "supplyMode",
      header: t("manufacturing.boms.lines.columns.supply", "Supply"),
      meta: { maxWidth: "140px" },
      cell: ({ row }) => (
        <StatusBadge variant={row.original.supplyMode === "produce" ? "info" : "neutral"}>
          {row.original.supplyMode === "produce"
            ? t("manufacturing.boms.lines.supply.produce", "Produce")
            : t("manufacturing.boms.lines.supply.stock", "Stock")}
        </StatusBadge>
      ),
    },
    {
      accessorKey: "resolutionState",
      header: t("manufacturing.boms.lines.columns.resolution", "Resolution"),
      meta: { maxWidth: "220px" },
      cell: ({ row }) => (
        <StatusBadge variant={RESOLUTION_VARIANTS[row.original.resolutionState] ?? "neutral"} dot>
          {t(`manufacturing.boms.lines.resolution.${row.original.resolutionState}`, row.original.resolutionState)}
        </StatusBadge>
      ),
    },
  ], [t])

  return (
    <div>
      <DataTable<BomLineRow>
        extensionTableId={extensionPoints.hosts.bomLinesTable.tableId}
        perspective={{ tableId: extensionPoints.hosts.bomLinesTable.tableId }}
        columnChooser={{ auto: true }}
        stickyActionsColumn
        title={t("manufacturing.boms.lines.title", "Direct component occurrences")}
        refreshButton={{ label: t("manufacturing.boms.lines.actions.refresh", "Refresh"), onRefresh: reloadLines }}
        actions={canManage ? (
          <Button type="button" onClick={() => setDialogState({ mode: "create" })}>
            {t("manufacturing.boms.lines.actions.add", "Add component")}
          </Button>
        ) : undefined}
        columns={columns}
        data={rows}
        isLoading={isLoading}
        onRowClick={canManage ? (row) => setDialogState({ mode: "edit", line: row }) : undefined}
        rowActions={canManage ? (row) => (
          <div className="flex items-center gap-1">
            <IconButton
              type="button"
              variant="ghost"
              aria-label={t("manufacturing.boms.lines.actions.moveUp", "Move up")}
              disabled={row.position === firstPosition}
              onClick={() => handleMove(row, "up")}
            >
              <ArrowUp />
            </IconButton>
            <IconButton
              type="button"
              variant="ghost"
              aria-label={t("manufacturing.boms.lines.actions.moveDown", "Move down")}
              disabled={row.position === lastPosition}
              onClick={() => handleMove(row, "down")}
            >
              <ArrowDown />
            </IconButton>
            <RowActions
              items={[
                { id: "edit", label: t("manufacturing.boms.lines.actions.edit", "Edit"), onSelect: () => setDialogState({ mode: "edit", line: row }) },
                { id: "delete", label: t("manufacturing.boms.lines.actions.delete", "Delete"), destructive: true, onSelect: () => handleDelete(row) },
              ]}
            />
          </div>
        ) : undefined}
        emptyState={(
          <ListEmptyState
            entityName={t("manufacturing.boms.lines.entityPlural", "component occurrences")}
            entityNameGenitive={t("manufacturing.boms.lines.entityPluralGenitive", "component occurrences")}
            createLabel={t("manufacturing.boms.lines.actions.add", "Add component")}
            onCreate={canManage ? () => setDialogState({ mode: "create" }) : undefined}
          />
        )}
      />
      <BomKeysetPager
        page={cursorIndex + 1}
        hasPrevious={cursorIndex > 0}
        hasNext={hasMore}
        isLoading={isLoading}
        onPrevious={() => setCursorIndex((i) => Math.max(0, i - 1))}
        onNext={() => {
          if (!nextCursor) return
          setCursorStack((prev) => [...prev.slice(0, cursorIndex + 1), nextCursor])
          setCursorIndex((i) => i + 1)
        }}
      />
      {dialogState ? (
        <BomLineDialog
          bomId={bomId}
          revisionUpdatedAt={revisionUpdatedAt}
          initial={dialogState.mode === "edit" ? toFormValues(dialogState.line) : undefined}
          position={dialogState.mode === "edit" ? dialogState.line.ordinal : undefined}
          componentSeed={dialogState.mode === "edit" ? toComponentSeed(dialogState.line) : undefined}
          variantSeed={dialogState.mode === "edit" ? toVariantSeed(dialogState.line) : undefined}
          onClose={() => setDialogState(null)}
          onSaved={() => {
            setDialogState(null)
            handleAfterMutation()
          }}
          onConflict={() => {
            setDialogState(null)
            onAggregateChange()
          }}
        />
      ) : null}
      {ConfirmDialogElement}
    </div>
  )
}

function toFormValues(line: BomLineRow): BomLineFormValues {
  return {
    lineId: line.id,
    componentProductId: line.componentProductId,
    componentVariantId: line.componentVariantId,
    // Text inputs get the author-facing value, not the scale-padded storage
    // form; both re-normalize to the same stored evidence on save.
    quantityValue: formatDecimalForDisplay(line.enteredValue),
    quantityUnitCode: line.enteredUnitCode,
    consumptionBasis: line.consumptionBasis,
    yieldFactor: formatDecimalForDisplay(line.yieldFactor),
    supplyMode: line.supplyMode,
  }
}

function toComponentSeed(line: BomLineRow) {
  return { value: line.componentProductId, label: line.componentLabel.productName ?? line.componentProductId }
}

function toVariantSeed(line: BomLineRow) {
  if (!line.componentVariantId) return null
  return { value: line.componentVariantId, label: line.componentLabel.variantName ?? line.componentVariantId }
}

export default BomLinesEditor
