"use client"

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { ReadonlyURLSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { AccessDeniedMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { ForbiddenError } from '@open-mercato/ui/backend/utils/api'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { SupplyCaseListItem, SupplyCaseListResponse } from '../data/read-model'

const statuses = [
  'RECEIVED',
  'ANALYZING_INITIAL_IMPACT',
  'AWAITING_SOURCING_DECISION',
  'SENDING_ALTERNATIVE_REQUEST',
  'WAITING_FOR_ALTERNATIVE_OFFER',
  'ANALYZING_CONFIRMED_OFFER',
  'AWAITING_RESOLUTION_APPROVAL',
  'SENDING_PLAN_ACCEPTANCE',
  'WAITING_FOR_SUPPLIER_CONFIRMATIONS',
  'APPLYING_RESOLUTION',
  'RESOLVED',
  'REJECTED',
  'CANCELLED',
  'NEEDS_ATTENTION',
] as const

const riskStatuses = ['PROTECTED', 'AT_RISK', 'BREACHED', 'NO_PLAN'] as const
const attentionGroups = ['decision_required', 'needs_attention', 'waiting_external', 'active', 'closed'] as const

type DateRangeValue = { from?: string; to?: string }

export default function SupplyCasesTable() {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [search, setSearch] = React.useState(() => searchParams.get('q') ?? '')
  const [filterValues, setFilterValues] = React.useState<FilterValues>(() => readFilterValues(searchParams))
  const [page, setPage] = React.useState(() => Number(searchParams.get('page') ?? '1'))
  const [sorting, setSorting] = React.useState<SortingState>(() => readSorting(searchParams))

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: '25' })
    if (search) params.set('q', search)
    const selectedStatuses = readStringArray(filterValues.status)
    const selectedRisks = readStringArray(filterValues.riskStatus)
    if (selectedStatuses.length > 0) params.set('status', selectedStatuses.join(','))
    if (selectedRisks.length > 0) params.set('riskStatus', selectedRisks.join(','))
    if (typeof filterValues.attention === 'string' && filterValues.attention) params.set('attention', filterValues.attention)
    const requiredDate = readDateRange(filterValues.requiredDate)
    if (requiredDate?.from) params.set('requiredFrom', requiredDate.from)
    if (requiredDate?.to) params.set('requiredTo', requiredDate.to)
    const activeSort = sorting[0]
    if (activeSort?.id) {
      params.set('sort', activeSort.id)
      params.set('order', activeSort.desc ? 'desc' : 'asc')
    }
    return params.toString()
  }, [filterValues, page, search, sorting])

  const { data, error, isLoading, refetch } = useQuery<SupplyCaseListResponse>({
    queryKey: ['supply_cases:list', queryParams],
    queryFn: () => readApiResultOrThrow<SupplyCaseListResponse>(
      `/api/supply_cases?${queryParams}`,
      undefined,
      { errorMessage: t('supply_cases.page.error') },
    ),
  })

  const updateUrl = React.useCallback((next: {
    search?: string
    filters?: FilterValues
    page?: number
    sorting?: SortingState
  }) => {
    const params = new URLSearchParams(searchParams.toString())
    const nextSearch = next.search ?? search
    const nextFilters = next.filters ?? filterValues
    const nextPage = next.page ?? page
    const nextSorting = next.sorting ?? sorting
    setSearch(nextSearch)
    setFilterValues(nextFilters)
    setPage(nextPage)
    setSorting(nextSorting)
    setQueryParam(params, 'q', nextSearch)
    setQueryParam(params, 'page', nextPage > 1 ? String(nextPage) : null)
    setQueryParam(params, 'status', joinFilterValue(nextFilters.status))
    setQueryParam(params, 'riskStatus', joinFilterValue(nextFilters.riskStatus))
    setQueryParam(params, 'attention', typeof nextFilters.attention === 'string' ? nextFilters.attention : null)
    const requiredDate = readDateRange(nextFilters.requiredDate)
    setQueryParam(params, 'requiredFrom', requiredDate?.from ?? null)
    setQueryParam(params, 'requiredTo', requiredDate?.to ?? null)
    const activeSort = nextSorting[0]
    setQueryParam(params, 'sort', activeSort?.id ?? null)
    setQueryParam(params, 'order', activeSort ? activeSort.desc ? 'desc' : 'asc' : null)
    router.replace(params.toString() ? `${pathname}?${params.toString()}` : pathname)
  }, [filterValues, page, pathname, router, search, searchParams, sorting])

  const handleSearchChange = (value: string) => updateUrl({ search: value, page: 1 })
  const handleFiltersApply = (values: FilterValues) => updateUrl({ filters: values, page: 1 })
  const handleFiltersClear = () => updateUrl({ filters: {}, page: 1 })
  const handleSortingChange = (value: SortingState) => updateUrl({ sorting: value, page: 1 })

  const columns = React.useMemo<ColumnDef<SupplyCaseListItem>[]>(() => [
    {
      accessorKey: 'correlationId',
      header: t('supply_cases.table.case'),
      cell: ({ row }) => <Link className="font-medium underline-offset-4 hover:underline" href={`/backend/supply-cases/${row.original.id}`}>{row.original.correlationId}</Link>,
      meta: { priority: 1 },
    },
    {
      accessorKey: 'status',
      header: t('supply_cases.table.status'),
      cell: ({ row }) => <StatusBadge variant={getStatusVariant(row.original.status)} dot>{translateEnum(t, 'supply_cases.status', row.original.status)}</StatusBadge>,
      meta: { priority: 2 },
    },
    { accessorKey: 'sku', header: t('supply_cases.table.sku'), meta: { priority: 3 } },
    {
      accessorKey: 'productionOrders',
      header: t('supply_cases.table.orders'),
      enableSorting: false,
      cell: ({ row }) => <span>{formatOrders(row.original.productionOrders, t)}</span>,
      meta: { priority: 4 },
    },
    {
      accessorKey: 'requiredDate',
      header: t('supply_cases.table.requiredDate'),
      cell: ({ row }) => <time dateTime={row.original.requiredDate}>{formatDate(row.original.requiredDate)}</time>,
      meta: { priority: 5 },
    },
    {
      accessorKey: 'coverage',
      header: t('supply_cases.table.coverage'),
      enableSorting: false,
      cell: ({ row }) => (
        <div>
          <span className="font-medium">
            {row.original.liveCoverage
              ? `${row.original.liveCoverage.coveredQuantity}/${row.original.liveCoverage.requiredQuantity}`
              : t('supply_cases.table.noPlan')}
          </span>
          {row.original.baselineCoverage ? (
            <span className="block text-xs text-muted-foreground">
              {t('supply_cases.table.baseline', { value: `${row.original.baselineCoverage.coveredQuantity}/${row.original.baselineCoverage.requiredQuantity}` })}
            </span>
          ) : null}
        </div>
      ),
      meta: { priority: 6 },
    },
    {
      id: 'missingQuantity',
      accessorFn: (row) => row.liveCoverage?.missingQuantity ?? null,
      header: t('supply_cases.table.missing'),
      cell: ({ row }) => row.original.liveCoverage?.missingQuantity ?? t('supply_cases.table.none'),
      meta: { priority: 7 },
    },
    {
      id: 'riskStatus',
      accessorFn: (row) => row.liveCoverage?.riskStatus ?? 'NO_PLAN',
      header: t('supply_cases.table.risk'),
      cell: ({ row }) => {
        const risk = row.original.liveCoverage?.riskStatus ?? 'NO_PLAN'
        return <StatusBadge variant={getRiskVariant(risk)} dot>{risk === 'NO_PLAN' ? t('supply_cases.risk.noPlan') : translateEnum(t, 'supply_cases.risk', risk)}</StatusBadge>
      },
      meta: { priority: 8 },
    },
    {
      accessorKey: 'currentWait',
      header: t('supply_cases.table.waitingFor'),
      cell: ({ row }) => t(`supply_cases.wait.${row.original.currentWait}`),
      meta: { priority: 9 },
    },
    {
      accessorKey: 'customerImpact',
      header: t('supply_cases.table.customerImpact'),
      enableSorting: false,
      cell: ({ row }) => <StatusBadge variant={getCustomerImpactVariant(row.original.customerImpact)}>{translateEnum(t, 'supply_cases.customerImpact', row.original.customerImpact)}</StatusBadge>,
      meta: { priority: 10 },
    },
    {
      accessorKey: 'updatedAt',
      header: t('supply_cases.table.updatedAt'),
      cell: ({ row }) => <time dateTime={row.original.updatedAt}>{formatDate(row.original.updatedAt)}</time>,
      meta: { priority: 10 },
    },
  ], [t])

  if (error) {
    if (error instanceof ForbiddenError) {
      return <AccessDeniedMessage label={t('supply_cases.page.permissionDenied')} description={t('supply_cases.page.permissionDeniedDescription')} />
    }
    return <ErrorMessage label={t('supply_cases.page.error')} action={<Button variant="outline" onClick={() => void refetch()}>{t('supply_cases.page.retry')}</Button>} />
  }

  const hasFilters = search.length > 0 || Object.keys(filterValues).length > 0

  return (
    <DataTable
      title={t('supply_cases.page.title')}
      titleHeadingLevel={2}
      actions={<Button variant="outline" onClick={() => void refetch()}>{t('supply_cases.page.refresh')}</Button>}
      columns={columns}
      data={data?.items ?? []}
      searchValue={search}
      onSearchChange={handleSearchChange}
      searchPlaceholder={t('supply_cases.page.search')}
      filters={buildFilters(t)}
      filterValues={filterValues}
      onFiltersApply={handleFiltersApply}
      onFiltersClear={handleFiltersClear}
      entityId="supply_cases:case"
      sortable
      sorting={sorting}
      onSortingChange={handleSortingChange}
      perspective={{ tableId: 'supply_cases.cases.list' }}
      rowActions={(row) => <RowActions items={[{ id: 'supply_cases:cases:open', label: t('supply_cases.table.case'), href: `/backend/supply-cases/${row.id}` }]} />}
      pagination={{
        page,
        pageSize: data?.pageSize ?? 25,
        total: data?.total ?? 0,
        totalPages: data?.totalPages ?? 0,
        onPageChange: (nextPage) => updateUrl({ page: nextPage }),
      }}
      isLoading={isLoading}
      emptyState={hasFilters
        ? <div className="space-y-2"><p>{t('supply_cases.page.emptyFiltered')}</p><Button variant="outline" onClick={handleFiltersClear}>{t('supply_cases.page.clearFilters')}</Button></div>
        : t('supply_cases.page.empty')}
      onRowClick={(row) => router.push(`/backend/supply-cases/${row.id}`)}
    />
  )
}

function readFilterValues(params: ReadonlyURLSearchParams): FilterValues {
  const values: FilterValues = {}
  const statusesValue = params.get('status')
  const risksValue = params.get('riskStatus')
  const attention = params.get('attention')
  if (statusesValue) values.status = statusesValue.split(',')
  if (risksValue) values.riskStatus = risksValue.split(',')
  if (attention) values.attention = attention
  const from = params.get('requiredFrom')
  const to = params.get('requiredTo')
  if (from || to) values.requiredDate = { from, to }
  return values
}

function readSorting(params: ReadonlyURLSearchParams): SortingState {
  const sort = params.get('sort')
  if (!sort) return []
  return [{ id: sort, desc: params.get('order') === 'desc' }]
}

function setQueryParam(params: URLSearchParams, key: string, value: string | null) {
  if (value) params.set(key, value)
  else params.delete(key)
}

function joinFilterValue(value: unknown): string | null {
  const values = readStringArray(value)
  return values.length > 0 ? values.join(',') : null
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0) : []
}

function readDateRange(value: unknown): DateRangeValue | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  return {
    from: typeof record.from === 'string' ? record.from : undefined,
    to: typeof record.to === 'string' ? record.to : undefined,
  }
}

function buildFilters(t: (key: string, params?: Record<string, string | number>) => string) {
  return [
    { id: 'status', label: t('supply_cases.filter.status'), type: 'select' as const, multiple: true, options: statuses.map((status) => ({ value: status, label: translateEnum(t, 'supply_cases.status', status) })) },
    { id: 'riskStatus', label: t('supply_cases.filter.risk'), type: 'select' as const, multiple: true, options: riskStatuses.map((risk) => ({ value: risk, label: risk === 'NO_PLAN' ? t('supply_cases.risk.noPlan') : translateEnum(t, 'supply_cases.risk', risk) })) },
    { id: 'attention', label: t('supply_cases.filter.attention'), type: 'select' as const, options: attentionGroups.map((group) => ({ value: group, label: t(`supply_cases.filter.${group === 'decision_required' ? 'decisionRequired' : group === 'needs_attention' ? 'needsAttention' : group === 'waiting_external' ? 'waitingExternal' : group}`) })) },
    { id: 'requiredDate', label: t('supply_cases.filter.requiredDate'), type: 'dateRange' as const },
  ]
}

function translateEnum(t: (key: string, params?: Record<string, string | number>) => string, prefix: string, value: string): string {
  return t(`${prefix}.${toCamelCase(value)}`)
}

function toCamelCase(value: string): string {
  const [first, ...rest] = value.toLowerCase().split('_')
  return first + rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')
}

function getStatusVariant(status: string): StatusBadgeVariant {
  if (status === 'RESOLVED') return 'success'
  if (status === 'NEEDS_ATTENTION' || status === 'REJECTED') return 'error'
  if (status === 'AWAITING_SOURCING_DECISION' || status === 'AWAITING_RESOLUTION_APPROVAL') return 'warning'
  return 'info'
}

function getRiskVariant(risk: string): StatusBadgeVariant {
  if (risk === 'PROTECTED') return 'success'
  if (risk === 'AT_RISK') return 'warning'
  if (risk === 'BREACHED') return 'error'
  return 'neutral'
}

function getCustomerImpactVariant(status: string): StatusBadgeVariant {
  if (status === 'on_time') return 'success'
  if (status === 'breached') return 'error'
  if (status === 'at_risk') return 'warning'
  return 'neutral'
}

function formatOrders(orders: SupplyCaseListItem['productionOrders'], t: (key: string, params?: Record<string, string | number>) => string): string {
  const first = orders[0]?.orderNumber ?? t('supply_cases.table.none')
  return orders.length > 1 ? `${first} ${t('supply_cases.table.ordersMore', { count: orders.length - 1 })}` : first
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}
