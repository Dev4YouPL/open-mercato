"use client"

import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { useOptionalLocale, useT } from '@open-mercato/shared/lib/i18n/context'

type Commitment = { quantity: number; date: string }
type SupplyCaseRow = {
  id: string
  salesOrderId: string
  orderNumber: string
  customerDisplayName: string | null
  sku: string
  trigger: 'wms_shortfall' | 'manual_disruption'
  status: string
  statusReason: string | null
  originalCommitment: Commitment[]
  currentCommitment: Commitment[]
  updatedAt: string | null
}

type ListError = { status?: number }

const statusVariants: Record<string, StatusBadgeVariant> = {
  detected: 'neutral',
  proposal_ready: 'info',
  proposal_queued: 'info',
  proposal_delivered: 'success',
  escalated: 'warning',
  blocked_recipient: 'warning',
  send_failed: 'error',
}

function formatCommitment(value: Commitment[], locale: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  return value
    .map((entry) => t('supplier_demo.supplyCases.commitment.format', {
      quantity: entry.quantity,
      date: new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(entry.date)),
    }))
    .join(', ')
}

function isListError(error: unknown): error is ListError {
  return Boolean(error && typeof error === 'object')
}

export default function SupplyCasesTable() {
  const t = useT()
  const locale = useOptionalLocale() ?? 'en'
  const [search, setSearch] = React.useState('')
  const [status, setStatus] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'updatedAt', desc: true }])
  const queryParams = React.useMemo(() => ({
    page,
    pageSize: 25,
    search: search || undefined,
    status: status || undefined,
    sortField: sorting[0]?.id ?? 'updatedAt',
    sortDir: sorting[0]?.desc ? 'desc' : 'asc',
  }), [page, search, sorting, status])
  const listQuery = useQuery({
    queryKey: ['supplier-demo-supply-cases', queryParams],
    queryFn: () => fetchCrudList<SupplyCaseRow>('supplier_demo/supply-cases', queryParams),
    refetchOnWindowFocus: true,
  })
  const { runMutation } = useGuardedMutation<{ resourceType: string; resourceId: string }>({
    contextId: 'supplier-demo.supply-cases.retry',
  })

  const columns = React.useMemo<ColumnDef<SupplyCaseRow>[]>(() => [
    { accessorKey: 'orderNumber', header: t('supplier_demo.supplyCases.table.order'), meta: { priority: 1 } },
    { accessorKey: 'sku', header: t('supplier_demo.supplyCases.table.sku'), meta: { priority: 2 } },
    { accessorKey: 'customerDisplayName', header: t('supplier_demo.supplyCases.table.customer'), meta: { priority: 5 } },
    {
      accessorKey: 'status',
      header: t('supplier_demo.supplyCases.table.status'),
      meta: { priority: 3 },
      cell: ({ getValue }) => {
        const value = String(getValue())
        return <StatusBadge variant={statusVariants[value] ?? 'neutral'} dot>{t(`supplier_demo.supplyCases.status.${value}`)}</StatusBadge>
      },
    },
    {
      accessorKey: 'originalCommitment',
      header: t('supplier_demo.supplyCases.table.original'),
      enableSorting: false,
      meta: { priority: 4 },
      cell: ({ getValue }) => <span>{formatCommitment(Array.isArray(getValue()) ? getValue() as Commitment[] : [], locale, t) || t('supplier_demo.supplyCases.table.noCommitment')}</span>,
    },
    {
      accessorKey: 'currentCommitment',
      header: t('supplier_demo.supplyCases.table.proposed'),
      enableSorting: false,
      meta: { priority: 4 },
      cell: ({ getValue }) => <span>{formatCommitment(Array.isArray(getValue()) ? getValue() as Commitment[] : [], locale, t) || t('supplier_demo.supplyCases.table.noCommitment')}</span>,
    },
    {
      accessorKey: 'statusReason',
      header: t('supplier_demo.supplyCases.table.reason'),
      meta: { priority: 6 },
      cell: ({ getValue }) => {
        const value = getValue()
        return <span>{typeof value === 'string' && value.length > 0 ? t(`supplier_demo.supplyCases.reason.${value}`) : t('supplier_demo.supplyCases.table.noReason')}</span>
      },
    },
    {
      accessorKey: 'updatedAt',
      header: t('supplier_demo.supplyCases.table.updated'),
      meta: { priority: 7 },
      cell: ({ getValue }) => {
        const value = getValue()
        const date = typeof value === 'string' ? new Date(value) : null
        return <span>{date && !Number.isNaN(date.getTime())
          ? new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' }).format(date)
          : t('supplier_demo.supplyCases.table.noReason')}</span>
      },
    },
  ], [locale, t])

  const retry = React.useCallback(async (row: SupplyCaseRow) => {
    try {
      await runMutation({
        operation: () => readApiResultOrThrow(`/api/supplier_demo/supply-cases/${encodeURIComponent(row.id)}/retry`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ updatedAt: row.updatedAt }),
        }),
        context: { resourceType: 'supplier_demo:supply_case', resourceId: row.id },
        mutationPayload: { updatedAt: row.updatedAt },
      })
      flash(t('supplier_demo.supplyCases.flash.retryQueued'), 'success')
      await listQuery.refetch()
    } catch (error) {
      if (surfaceRecordConflict(error, t)) {
        await listQuery.refetch()
        return
      }
      flash(t('supplier_demo.supplyCases.errors.retry'), 'error')
    }
  }, [listQuery, runMutation, t])

  const errorMessage = listQuery.error
    ? isListError(listQuery.error) && listQuery.error.status === 403
      ? t('supplier_demo.supplyCases.states.permissionDenied')
      : t('supplier_demo.supplyCases.states.error')
    : null

  return (
    <DataTable
      title={t('supplier_demo.supplyCases.page.title')}
      titleHeadingLevel={1}
      columns={columns}
      data={listQuery.data?.items ?? []}
      searchValue={search}
      onSearchChange={(value) => { setSearch(value); setPage(1) }}
      searchPlaceholder={t('supplier_demo.supplyCases.filters.search')}
      filters={[{
        id: 'status',
        label: t('supplier_demo.supplyCases.filters.status'),
        type: 'select',
        options: [
          'detected', 'proposal_ready', 'proposal_queued', 'proposal_delivered', 'escalated', 'blocked_recipient', 'send_failed',
        ].map((value) => ({ value, label: t(`supplier_demo.supplyCases.status.${value}`) })),
      }]}
      filterValues={{ status }}
      onFiltersApply={(values) => { setStatus(typeof values.status === 'string' ? values.status : ''); setPage(1) }}
      onFiltersClear={() => { setStatus(''); setSearch(''); setPage(1) }}
      sortable
      manualSorting
      sorting={sorting}
      onSortingChange={(next) => { setSorting(next); setPage(1) }}
      rowActions={(row) => (
        <RowActions items={['send_failed', 'blocked_recipient'].includes(row.status) ? [{
          id: 'retry',
          label: t('supplier_demo.supplyCases.actions.retry'),
          onSelect: () => { void retry(row) },
        }] : []} />
      )}
      pagination={{
        page,
        pageSize: 25,
        total: listQuery.data?.total ?? 0,
        totalPages: listQuery.data?.totalPages ?? 0,
        totalIsCapped: listQuery.data?.totalIsCapped === true,
        onPageChange: setPage,
      }}
      isLoading={listQuery.isLoading}
      error={errorMessage}
      emptyState={<div role="status" className="p-4 text-sm text-muted-foreground">{t('supplier_demo.supplyCases.states.empty')}</div>}
      extensionTableId="supplier_demo.supply_cases"
      stickyFirstColumn
      stickyActionsColumn
    />
  )
}
