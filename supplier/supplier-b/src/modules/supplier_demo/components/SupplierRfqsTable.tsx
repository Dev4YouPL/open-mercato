'use client'

import * as React from 'react'
import Link from 'next/link'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { useOptionalLocale, useT } from '@open-mercato/shared/lib/i18n/context'

type RfqRow = { id: string; correlationId: string; subject: string; senderEmail: string | null; sku: string; requestedQuantity: number | null; requestedDeliveryDate: string | null; status: string; operatorDecision: string; sendStatus: string; lastError: string | null; updatedAt: string | null }
const statusVariants: Record<string, StatusBadgeVariant> = { pending_interpretation: 'info', needs_human: 'warning', ready_for_approval: 'info', approved: 'success', rejected: 'neutral', send_held: 'warning', sent: 'success', send_failed: 'error' }

export default function SupplierRfqsTable() {
  const t = useT()
  const locale = useOptionalLocale() ?? 'en'
  const [search, setSearch] = React.useState('')
  const [status, setStatus] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'updatedAt', desc: true }])
  const queryParams = React.useMemo(() => ({ page, pageSize: 25, search: search || undefined, status: status || undefined, sortField: sorting[0]?.id ?? 'updatedAt', sortDir: sorting[0]?.desc ? 'desc' : 'asc' }), [page, search, sorting, status])
  const query = useQuery({ queryKey: ['supplier-demo-rfqs', queryParams], queryFn: () => fetchCrudList<RfqRow>('supplier_demo/rfqs', queryParams), refetchOnWindowFocus: true })
  const columns = React.useMemo<ColumnDef<RfqRow>[]>(() => [
    { accessorKey: 'correlationId', header: t('supplier_demo.rfqs.table.correlation'), cell: ({ row }) => <Link className="underline" href={`/backend/supplier-demo/rfqs/${encodeURIComponent(row.original.id)}`}>{row.original.correlationId}</Link> },
    { accessorKey: 'sku', header: t('supplier_demo.rfqs.table.sku') },
    { accessorKey: 'requestedQuantity', header: t('supplier_demo.rfqs.table.quantity') },
    { accessorKey: 'requestedDeliveryDate', header: t('supplier_demo.rfqs.table.deliveryDate') },
    { accessorKey: 'senderEmail', header: t('supplier_demo.rfqs.table.sender') },
    { accessorKey: 'status', header: t('supplier_demo.rfqs.table.status'), cell: ({ getValue }) => { const value = String(getValue()); return <StatusBadge variant={statusVariants[value] ?? 'neutral'} dot>{t(`supplier_demo.rfqs.status.${value}`)}</StatusBadge> } },
    { accessorKey: 'updatedAt', header: t('supplier_demo.rfqs.table.updated'), cell: ({ getValue }) => { const value = getValue(); return <span>{typeof value === 'string' ? new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : t('supplier_demo.rfqs.states.noData')}</span> } },
  ], [locale, t])
  const error = query.error ? t('supplier_demo.rfqs.states.error') : undefined
  return <DataTable title={t('supplier_demo.rfqs.page.title')} titleHeadingLevel={1} columns={columns} data={query.data?.items ?? []} searchValue={search} onSearchChange={(value) => { setSearch(value); setPage(1) }} searchPlaceholder={t('supplier_demo.rfqs.filters.search')} filters={[{ id: 'status', label: t('supplier_demo.rfqs.filters.status'), type: 'select', options: ['pending_interpretation', 'needs_human', 'ready_for_approval', 'approved', 'rejected', 'send_held', 'sent', 'send_failed'].map((value) => ({ value, label: t(`supplier_demo.rfqs.status.${value}`) })) }]} filterValues={{ status }} onFiltersApply={(values) => { setStatus(typeof values.status === 'string' ? values.status : ''); setPage(1) }} onFiltersClear={() => { setStatus(''); setSearch(''); setPage(1) }} sortable manualSorting sorting={sorting} onSortingChange={(next) => { setSorting(next); setPage(1) }} pagination={{ page, pageSize: 25, total: query.data?.total ?? 0, totalPages: query.data?.totalPages ?? 0, totalIsCapped: query.data?.totalIsCapped === true, onPageChange: setPage }} isLoading={query.isLoading} error={error} emptyState={<div role="status" className="p-4 text-sm text-muted-foreground">{t('supplier_demo.rfqs.states.empty')}</div>} extensionTableId="supplier_demo.rfqs" stickyFirstColumn />
}
