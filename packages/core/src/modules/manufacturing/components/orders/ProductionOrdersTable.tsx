'use client'

import * as React from 'react'
import Link from 'next/link'
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
import { PRODUCTION_ORDER_STATUSES } from '../../domain/orderExecutionPermissions'
import type { ProductionOrderListItem } from '../../data/validators'
import {
  buildOrderListQuery,
  CATALOG_VARIANTS_API_PATH,
  ORDER_LIST_PAGE_SIZE,
  ORDER_STATUS_BADGES,
  ORDERS_API_PATH,
  toVariantLabels,
  toVariantOptions,
} from './orderListConfig'

type OrderListResponse = {
  items: ProductionOrderListItem[]
  total: number
  totalPages: number
  totalIsCapped?: boolean
}

const CREATE_HREF = '/backend/manufacturing/orders/create'

async function loadVariantOptions(query?: string) {
  const params = new URLSearchParams({ pageSize: '20' })
  if (query?.trim()) params.set('search', query.trim())
  const call = await apiCall<unknown>(`${CATALOG_VARIANTS_API_PATH}?${params.toString()}`)
  return call.ok ? toVariantOptions(call.result) : []
}

export function ProductionOrdersTable() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'createdAt', desc: true }])

  const query = buildOrderListQuery({ page, search, filters: filterValues, sorting })

  const orders = useQuery({
    queryKey: ['manufacturing-production-orders', query, scopeVersion],
    queryFn: async (): Promise<OrderListResponse> => {
      const call = await apiCall<OrderListResponse>(`${ORDERS_API_PATH}?${query}`)
      if (!call.ok) await raiseCrudError(call.response, t('manufacturing.orders.list.errors.load'))
      return call.result ?? { items: [], total: 0, totalPages: 1 }
    },
  })

  const rows = orders.data?.items ?? []
  const variantIds = [...new Set(rows.map((row) => row.productVariantId))].sort()

  const variantLabels = useQuery({
    queryKey: ['manufacturing-order-variant-labels', variantIds.join(','), scopeVersion],
    enabled: variantIds.length > 0,
    queryFn: async () => {
      const params = new URLSearchParams({ ids: variantIds.join(','), pageSize: String(ORDER_LIST_PAGE_SIZE) })
      const call = await apiCall<unknown>(`${CATALOG_VARIANTS_API_PATH}?${params.toString()}`)
      return call.ok ? toVariantLabels(call.result) : {}
    },
  })

  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'status',
        label: t('manufacturing.orders.list.filters.status'),
        type: 'select',
        options: PRODUCTION_ORDER_STATUSES.map((status) => ({
          value: status,
          label: t(`manufacturing.orders.status.${status}`),
        })),
      },
      {
        id: 'productVariantId',
        label: t('manufacturing.orders.list.filters.productVariant'),
        type: 'combobox',
        loadOptions: loadVariantOptions,
      },
      {
        id: 'dueAt',
        label: t('manufacturing.orders.list.filters.dueAt'),
        type: 'dateRange',
      },
    ],
    [t],
  )

  const columns = React.useMemo<ColumnDef<ProductionOrderListItem>[]>(
    () => [
      { id: 'orderNumber', accessorKey: 'orderNumber', header: t('manufacturing.orders.list.columns.orderNumber') },
      {
        id: 'productVariantId',
        accessorKey: 'productVariantId',
        header: t('manufacturing.orders.list.columns.productVariant'),
        enableSorting: false,
        meta: { truncate: true, maxWidth: '280px' },
        cell: ({ row }) => variantLabels.data?.[row.original.productVariantId] ?? row.original.productVariantId,
      },
      {
        id: 'plannedQuantity',
        accessorKey: 'plannedQuantity',
        header: t('manufacturing.orders.list.columns.plannedQuantity'),
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: t('manufacturing.orders.list.columns.status'),
        cell: ({ row }) => (
          <StatusBadge variant={ORDER_STATUS_BADGES[row.original.status]} dot>
            {t(`manufacturing.orders.status.${row.original.status}`)}
          </StatusBadge>
        ),
      },
      {
        id: 'dueAt',
        accessorKey: 'dueAt',
        header: t('manufacturing.orders.list.columns.dueAt'),
        cell: ({ row }) => (row.original.dueAt ? new Date(row.original.dueAt).toLocaleDateString() : '—'),
      },
      {
        id: 'createdAt',
        accessorKey: 'createdAt',
        header: t('manufacturing.orders.list.columns.createdAt'),
        cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(),
      },
    ],
    [t, variantLabels.data],
  )

  return (
    <DataTable<ProductionOrderListItem>
      title={t('manufacturing.backend.orders.nav.title')}
      titleHeadingLevel={1}
      actions={
        <Button asChild>
          <Link href={CREATE_HREF}>{t('manufacturing.orders.actions.create')}</Link>
        </Button>
      }
      columns={columns}
      data={rows}
      searchValue={search}
      searchPlaceholder={t('manufacturing.orders.list.searchPlaceholder')}
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
      emptyState={
        <ListEmptyState
          entityName={t('manufacturing.backend.orders.nav.title')}
          createHref={CREATE_HREF}
          createLabel={t('manufacturing.orders.actions.create')}
        />
      }
      pagination={{
        page,
        pageSize: ORDER_LIST_PAGE_SIZE,
        total: orders.data?.total ?? 0,
        totalPages: orders.data?.totalPages ?? 1,
        totalIsCapped: orders.data?.totalIsCapped === true,
        onPageChange: setPage,
      }}
      isLoading={orders.isLoading}
    />
  )
}
