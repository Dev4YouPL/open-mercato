"use client"

import * as React from "react"
import { DataTable } from "@open-mercato/ui/backend/DataTable"
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy"
import { Button } from "@open-mercato/ui/primitives/button"
import { IconButton } from "@open-mercato/ui/primitives/icon-button"
import { RowActions } from "@open-mercato/ui/backend/RowActions"
import { Alert, AlertDescription } from "@open-mercato/ui/primitives/alert"
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
import { formatCatalogTarget, parseCatalogLabel, type CatalogLabel } from "./catalogLabels"
import { useBomPermissions } from "./useBomPermissions"
import { extensionPoints } from "../extension-points"

export type BomLineRow = {
  id: string
  position: number
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

function mapLine(item: NonNullable<LinesResponse["items"]>[number]): BomLineRow {
  return {
    id: item.id,
    position: item.position,
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
      const params = new URLSearchParams({ limit: "50" })
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
      setRows((payload.items ?? []).map(mapLine))
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
          position: String(row.position),
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

  const columns = React.useMemo<ColumnDef<BomLineRow>[]>(() => [
    { accessorKey: "position", header: t("manufacturing.boms.lines.columns.position", "#"), meta: { alwaysVisible: true, maxWidth: "60px" } },
    {
      accessorKey: "componentProductId",
      header: t("manufacturing.boms.lines.columns.component", "Component"),
      cell: ({ row }) =>
        formatCatalogTarget(row.original.componentLabel, {
          productId: row.original.componentProductId,
          variantId: row.original.componentVariantId,
        }),
    },
    {
      accessorKey: "enteredValue",
      header: t("manufacturing.boms.lines.columns.quantity", "Quantity"),
      cell: ({ row }) => `${row.original.enteredValue} ${row.original.enteredUnitCode} (${row.original.normalizedValue} ${row.original.baseUnitCode})`,
    },
    { accessorKey: "consumptionBasis", header: t("manufacturing.boms.lines.columns.basis", "Basis") },
    { accessorKey: "yieldFactor", header: t("manufacturing.boms.lines.columns.yield", "Yield") },
    { accessorKey: "supplyMode", header: t("manufacturing.boms.lines.columns.supply", "Supply") },
    {
      accessorKey: "resolutionState",
      header: t("manufacturing.boms.lines.columns.resolution", "Resolution"),
      cell: ({ row }) => row.original.resolutionState === "unresolved" ? (
        <Alert status="warning" className="py-1">
          <AlertDescription>{t("manufacturing.boms.lines.unresolvedWarning", "No child BOM found")}</AlertDescription>
        </Alert>
      ) : row.original.resolutionState,
    },
  ], [t])

  return (
    <div>
      <DataTable<BomLineRow>
        extensionTableId={extensionPoints.hosts.bomLinesTable.tableId}
        title={t("manufacturing.boms.lines.title", "Direct component occurrences")}
        actions={canManage ? (
          <Button type="button" onClick={() => setDialogState({ mode: "create" })}>
            {t("manufacturing.boms.lines.actions.add", "Add component")}
          </Button>
        ) : undefined}
        columns={columns}
        data={rows}
        isLoading={isLoading}
        rowActions={canManage ? (row) => (
          <div className="flex items-center gap-1">
            <IconButton
              type="button"
              aria-label={t("manufacturing.boms.lines.actions.moveUp", "Move up")}
              disabled={row.position === Math.min(...rows.map((r) => r.position))}
              onClick={() => handleMove(row, "up")}
            >
              <ArrowUp />
            </IconButton>
            <IconButton
              type="button"
              aria-label={t("manufacturing.boms.lines.actions.moveDown", "Move down")}
              disabled={row.position === Math.max(...rows.map((r) => r.position))}
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
            createLabel={t("manufacturing.boms.lines.actions.add", "Add component")}
            onCreate={canManage ? () => setDialogState({ mode: "create" }) : undefined}
          />
        )}
      />
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={cursorIndex === 0 || isLoading}
          onClick={() => setCursorIndex((i) => Math.max(0, i - 1))}
        >
          {t("manufacturing.boms.lines.actions.previous", "Previous")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!hasMore || isLoading}
          onClick={() => {
            if (!nextCursor) return
            setCursorStack((prev) => [...prev.slice(0, cursorIndex + 1), nextCursor])
            setCursorIndex((i) => i + 1)
          }}
        >
          {t("manufacturing.boms.lines.actions.next", "Next")}
        </Button>
      </div>
      {dialogState ? (
        <BomLineDialog
          bomId={bomId}
          revisionUpdatedAt={revisionUpdatedAt}
          initial={dialogState.mode === "edit" ? toFormValues(dialogState.line) : undefined}
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
    quantityValue: line.enteredValue,
    quantityUnitCode: line.enteredUnitCode,
    consumptionBasis: line.consumptionBasis,
    yieldFactor: line.yieldFactor,
    supplyMode: line.supplyMode,
  }
}

export default BomLinesEditor
