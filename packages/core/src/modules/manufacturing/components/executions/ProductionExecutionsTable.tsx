'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import type { ProductionExecutionListItem } from '../../data/validators'
import { useVariantLabels } from '../shared/useReferenceLabels'
import { buildExecutionListQuery, EXECUTION_LIST_PAGE_SIZE } from './executionListConfig'
import { EXECUTIONS_API_PATH, EXECUTIONS_BACKEND_PATH } from './executionUi'

type ExecutionListResponse = {
  items: ProductionExecutionListItem[]
  total: number
  totalPages: number
  totalIsCapped?: boolean
}

export function ProductionExecutionsTable() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const scopeVersion = useOrganizationScopeVersion()
  const orderId = searchParams?.get('orderId') ?? null
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'createdAt', desc: true }])

  const query = buildExecutionListQuery({ page, search, filters: filterValues, sorting, orderId })
  const createHref = orderId ? `${EXECUTIONS_BACKEND_PATH}/create?orderId=${encodeURIComponent(orderId)}` : `${EXECUTIONS_BACKEND_PATH}/create`

  const executions = useQuery({
    queryKey: ['manufacturing-executions', query, scopeVersion],
    queryFn: async (): Promise<ExecutionListResponse> => {
      const call = await apiCall<ExecutionListResponse>(`${EXECUTIONS_API_PATH}?${query}`)
      if (!call.ok) await raiseCrudError(call.response, t('manufacturing.executions.list.errors.load'))
      return call.result ?? { items: [], total: 0, totalPages: 1 }
    },
  })

  const rows = executions.data?.items ?? []
  const variantLabels = useVariantLabels(rows.map((row) => row.productVariantId))

  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'orderLink',
        label: t('manufacturing.executions.list.filters.orderLink'),
        type: 'select',
        options: [
          { value: 'withOrder', label: t('manufacturing.executions.list.filters.withOrder') },
          { value: 'withoutOrder', label: t('manufacturing.executions.withoutOrder') },
        ],
      },
    ],
    [t],
  )

  const columns = React.useMemo<ColumnDef<ProductionExecutionListItem>[]>(
    () => [
      { id: 'executionNumber', accessorKey: 'executionNumber', header: t('manufacturing.executions.list.columns.executionNumber') },
      {
        id: 'orderNumber',
        accessorKey: 'orderNumber',
        header: t('manufacturing.executions.list.columns.order'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.orderNumber ?? <StatusBadge variant="neutral">{t('manufacturing.executions.withoutOrder')}</StatusBadge>,
      },
      {
        id: 'productVariantId',
        accessorKey: 'productVariantId',
        header: t('manufacturing.executions.list.columns.productVariant'),
        enableSorting: false,
        meta: { truncate: true, maxWidth: '280px' },
        cell: ({ row }) => {
          const variantId = row.original.productVariantId
          return variantId ? variantLabels[variantId] ?? variantId : '—'
        },
      },
      {
        id: 'createdAt',
        accessorKey: 'createdAt',
        header: t('manufacturing.executions.list.columns.createdAt'),
        cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(),
      },
    ],
    [t, variantLabels],
  )

  return (
    <DataTable<ProductionExecutionListItem>
      title={t('manufacturing.backend.executions.nav.title')}
      titleHeadingLevel={1}
      actions={
        <Button asChild>
          <Link href={createHref}>{t('manufacturing.executions.actions.create')}</Link>
        </Button>
      }
      columns={columns}
      data={rows}
      searchValue={search}
      searchPlaceholder={t('manufacturing.executions.list.searchPlaceholder')}
      onSearchChange={(value) => {
        setSearch(value)
        setPage(1)
      }}
      filters={filters}
      filterValues={filterValues}
      onFiltersApply={(values) => {
        setFilterValues(values)
        setPage(1)
      }}
      onFiltersClear={() => {
        setFilterValues({})
        setPage(1)
      }}
      sortable
      sorting={sorting}
      onSortingChange={setSorting}
      onRowClick={(row) => router.push(`${EXECUTIONS_BACKEND_PATH}/${row.id}`)}
      emptyState={
        <ListEmptyState
          entityName={t('manufacturing.backend.executions.nav.title')}
          createHref={createHref}
          createLabel={t('manufacturing.executions.actions.create')}
        />
      }
      pagination={{
        page,
        pageSize: EXECUTION_LIST_PAGE_SIZE,
        total: executions.data?.total ?? 0,
        totalPages: executions.data?.totalPages ?? 1,
        totalIsCapped: executions.data?.totalIsCapped === true,
        onPageChange: setPage,
      }}
      isLoading={executions.isLoading}
    />
  )
}
