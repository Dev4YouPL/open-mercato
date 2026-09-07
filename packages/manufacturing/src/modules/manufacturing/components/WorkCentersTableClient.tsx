"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { DataTable } from "@open-mercato/ui/backend/DataTable"
import type { FilterDef, FilterValues } from "@open-mercato/ui/backend/FilterOverlay"
import { Button } from "@open-mercato/ui/primitives/button"
import { RowActions } from "@open-mercato/ui/backend/RowActions"
import { ListEmptyState } from "@open-mercato/ui/backend/filters/ListEmptyState"
import { ErrorMessage } from "@open-mercato/ui/backend/detail"
import { apiCall } from "@open-mercato/ui/backend/utils/apiCall"
import { withScopedApiRequestHeaders } from "@open-mercato/ui/backend/utils/apiCall"
import { buildOptimisticLockHeader } from "@open-mercato/ui/backend/utils/optimisticLock"
import { deleteCrud } from "@open-mercato/ui/backend/utils/crud"
import { useGuardedMutation } from "@open-mercato/ui/backend/injection/useGuardedMutation"
import { useConfirmDialog } from "@open-mercato/ui/backend/confirm-dialog"
import { surfaceRecordConflict } from "@open-mercato/ui/backend/conflicts"
import { flash } from "@open-mercato/ui/backend/FlashMessages"
import { useT } from "@open-mercato/shared/lib/i18n/context"
import { useWorkCenterPermissions } from "./useWorkCenterPermissions"
import {
  WORK_CENTERS_LIST_HREF,
  buildWorkCenterColumns,
  type WorkCenterRow,
} from "./workCenterTableColumns"
import { extensionPoints } from "../extension-points"

const PAGE_SIZE = 25
const MUTATION_CONTEXT_ID = "manufacturing-work-centers-list:delete"

type ListResponse = {
  items?: WorkCenterRow[]
  total?: number
  totalPages?: number
}

/**
 * The declared host id is bound here, in the file `extension-points.ts` names as
 * this host's source, so the generator can resolve the declaration. The page
 * still passes it explicitly; the default keeps the island usable on its own.
 */
export function WorkCentersTableClient({
  extensionTableId = extensionPoints.hosts.workCentersTable.tableId,
}: {
  extensionTableId?: string
}) {
  const t = useT()
  const router = useRouter()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { canManage } = useWorkCenterPermissions()
  const [rows, setRows] = React.useState<WorkCenterRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState("")
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)

  const activeFilter = typeof filterValues.isActive === "string" ? filterValues.isActive : null
  const hasFilters = Boolean(activeFilter)

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: MUTATION_CONTEXT_ID,
    blockedMessage: t("ui.forms.flash.saveBlocked", "Save blocked by validation"),
  })

  React.useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    void (async () => {
      setIsLoading(true)
      setError(null)
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (search.trim().length > 0) params.set("search", search.trim())
      if (activeFilter) params.set("isActive", activeFilter)
      try {
        const response = await apiCall<ListResponse>(`/api/manufacturing/work-centers?${params.toString()}`, {
          signal: controller.signal,
        })
        if (cancelled) return
        if (!response.ok) {
          setError(t("manufacturing.workCenters.list.loadError", "Failed to load work centres"))
          return
        }
        setRows(Array.isArray(response.result?.items) ? response.result.items : [])
        setTotal(typeof response.result?.total === "number" ? response.result.total : 0)
        setTotalPages(typeof response.result?.totalPages === "number" ? response.result.totalPages : 1)
      } catch {
        if (!cancelled) setError(t("manufacturing.workCenters.list.loadError", "Failed to load work centres"))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [activeFilter, page, reloadToken, search, t])

  const handleRefresh = React.useCallback(() => setReloadToken((token) => token + 1), [])

  const applyFilters = React.useCallback((values: FilterValues) => {
    setFilterValues(values ?? {})
    setPage(1)
  }, [])

  const handleClearFilters = React.useCallback(() => applyFilters({}), [applyFilters])

  /**
   * Row delete is not a CrudForm submit, so it carries the row's own version
   * explicitly. The stale version is kept on conflict — the conflict bar offers
   * a deliberate retry rather than silently re-fetching a fresh version and
   * overwriting whatever changed.
   */
  const handleDelete = React.useCallback(
    async (row: WorkCenterRow) => {
      const confirmed = await confirm({
        title: t("manufacturing.workCenters.list.deleteConfirmTitle", "Delete work centre?"),
        description: t(
          "manufacturing.workCenters.list.deleteConfirmBody",
          "The work centre will be deactivated and hidden from routing selection. Its resource membership is kept.",
        ),
        // Name the destructive action explicitly rather than leaving the
        // generic "Confirm": the button the user presses should say what it does.
        confirmText: t("manufacturing.workCenters.actions.delete", "Delete"),
        variant: "destructive",
      })
      if (!confirmed) return
      try {
        await runMutation({
          operation: () =>
            withScopedApiRequestHeaders(buildOptimisticLockHeader(row.updatedAt), () =>
              deleteCrud("manufacturing/work-centers", row.id),
            ),
          context: {
            formId: MUTATION_CONTEXT_ID,
            resourceKind: "manufacturing.work_center",
            resourceId: row.id,
            retryLastMutation,
          },
        })
        flash(t("manufacturing.workCenters.list.deleteSuccess", "Work centre deleted"), "success")
        handleRefresh()
      } catch (err) {
        if (surfaceRecordConflict(err, t)) return
        const message =
          err instanceof Error
            ? err.message
            : t("manufacturing.workCenters.list.loadError", "Failed to load work centres")
        flash(message, "error")
      }
    },
    [confirm, handleRefresh, retryLastMutation, runMutation, t],
  )

  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        id: "isActive",
        label: t("manufacturing.workCenters.filters.isActive", "Status"),
        type: "select",
        options: [
          { value: "true", label: t("manufacturing.workCenters.status.active", "Active") },
          { value: "false", label: t("manufacturing.workCenters.status.inactive", "Inactive") },
        ],
      },
    ],
    [t],
  )

  const columns = React.useMemo(() => buildWorkCenterColumns(t), [t])

  if (error) {
    return (
      <ErrorMessage
        label={error}
        action={
          <Button type="button" variant="outline" size="sm" onClick={handleRefresh}>
            {t("ui.actions.retry", "Retry")}
          </Button>
        }
      />
    )
  }

  return (
    <>
      <DataTable<WorkCenterRow>
        extensionTableId={extensionTableId}
        perspective={{ tableId: extensionTableId }}
        columnChooser={{ auto: true }}
        title={t("manufacturing.workCenters.list.title", "Work centres")}
        refreshButton={{ label: t("ui.actions.retry", "Retry"), onRefresh: handleRefresh }}
        actions={
          canManage ? (
            <Button asChild>
              <Link href={`${WORK_CENTERS_LIST_HREF}/create`}>
                {t("manufacturing.workCenters.list.create", "New work centre")}
              </Link>
            </Button>
          ) : undefined
        }
        columns={columns}
        data={rows}
        isLoading={isLoading}
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchPlaceholder={t("manufacturing.workCenters.list.searchPlaceholder", "Search by code or name")}
        filters={filters}
        filterValues={filterValues}
        onFiltersApply={applyFilters}
        onFiltersClear={handleClearFilters}
        onRowClick={(row) => router.push(`${WORK_CENTERS_LIST_HREF}/${row.id}`)}
        pagination={{ page, pageSize: PAGE_SIZE, total, totalPages, onPageChange: setPage }}
        showQueryTime={false}
        rowActions={(row) => (
          <RowActions
            items={[
              {
                id: "open",
                label: t("manufacturing.workCenters.actions.open", "Open"),
                onSelect: () => router.push(`${WORK_CENTERS_LIST_HREF}/${row.id}`),
              },
              ...(canManage
                ? [
                    {
                      id: "delete",
                      label: t("manufacturing.workCenters.actions.delete", "Delete"),
                      destructive: true,
                      onSelect: () => handleDelete(row),
                    },
                  ]
                : []),
            ]}
          />
        )}
        filterAwareEmptyState={{
          active: hasFilters,
          entityNamePlural: t("manufacturing.workCenters.entityPlural", "Work centres"),
          entityNamePluralGenitive: t("manufacturing.workCenters.entityPlural", "Work centres"),
          canRemoveLast: Boolean(activeFilter),
          onClearAll: handleClearFilters,
          onRemoveLast: () => applyFilters({ ...filterValues, isActive: undefined }),
        }}
        emptyState={
          <ListEmptyState
            entityName={t("manufacturing.workCenters.entityPlural", "Work centres")}
            entityNameGenitive={t("manufacturing.workCenters.entityPlural", "Work centres")}
            createHref={canManage ? `${WORK_CENTERS_LIST_HREF}/create` : undefined}
            createLabel={t("manufacturing.workCenters.list.create", "New work centre")}
          />
        }
      />
      {ConfirmDialogElement}
    </>
  )
}

export default WorkCentersTableClient
