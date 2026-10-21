'use client'

import {
  useEffect,
  useMemo,
  useState,
} from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { SortingState } from '@tanstack/react-table'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'

import {
  useOptionalLocale,
  useT,
} from '@open-mercato/shared/lib/i18n/context'
import { resolveLocaleNumberSeparators } from '@open-mercato/shared/lib/number'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type {
  FilterDef,
  FilterValues,
} from '@open-mercato/ui/backend/FilterBar'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'

import {
  buildBomListSearchParams,
  parseBomListResponse,
  parseBomListStatusFilter,
} from '../../lib/bomListClient'
import type { BomListItem } from '../../lib/bomListClient'
import { BomAvailabilityBadge } from './BomAvailabilityBadge'
import { BomStatusBadges } from './BomStatusBadges'
import { BomDeleteAction } from './BomDeleteAction'

const PAGE_SIZE = 25
const SHORT_ID_LENGTH = 8

export function BomListTable() {
  const t = useT()
  const router = useRouter()
  const locale = useOptionalLocale()
  const { decimal } = resolveLocaleNumberSeparators(locale)
  const canCreate = useBomCreatePermission()
  const canManage = useBomManagePermission()
  const [deleteTarget, setDeleteTarget] = useState<BomListItem | null>(null)

  const [rows, setRows] = useState<BomListItem[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [totalIsCapped, setTotalIsCapped] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'updatedAt', desc: true },
  ])
  const [search, setSearch] = useState('')
  const [filterValues, setFilterValues] = useState<FilterValues>({})
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const status = parseBomListStatusFilter(filterValues.status)

  useEffect(() => {
    const controller = new AbortController()

    setIsLoading(true)
    setError(null)

    const params = buildBomListSearchParams({
      page,
      pageSize: PAGE_SIZE,
      search,
      status,
      sorting,
    })

    async function load() {
      try {
        const response = await apiCall<unknown>(
          `/api/manufacturing/boms?${params.toString()}`,
          { signal: controller.signal },
        )

        if (controller.signal.aborted) {
          return
        }

        const parsed = response.ok
          ? parseBomListResponse(response.result)
          : null

        if (!parsed?.success) {
          setRows([])
          setError(t('manufacturing.boms.list.loadFailed'))
          return
        }

        setRows(parsed.data.items)
        setTotal(parsed.data.total)
        setTotalPages(parsed.data.totalPages)
        setTotalIsCapped(parsed.data.totalIsCapped ?? false)
      } catch {
        if (!controller.signal.aborted) {
          setRows([])
          setError(t('manufacturing.boms.list.loadFailed'))
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [page, search, status, sorting, reloadToken, t])

  const columns = useMemo<ColumnDef<BomListItem>[]>(
    () => [
      {
        id: 'outputVariant',
        header: t('manufacturing.boms.list.columns.variant'),
        enableSorting: false,
        meta: {
          truncate: true,
          maxWidth: '320px',
        },
        cell: ({ row }) => <BomVariantCell bom={row.original} />,
      },
      {
        accessorKey: 'revision',
        header: t('manufacturing.boms.list.columns.revision'),
      },
      {
        accessorKey: 'status',
        header: t('manufacturing.boms.list.columns.status'),
        cell: ({ row }) => <BomStatusBadges bom={row.original} />,
      },
      {
        accessorKey: 'baseQuantity',
        header: t('manufacturing.boms.list.columns.baseQuantity'),
        enableSorting: false,
        cell: ({ row }) => row.original.baseQuantity.replace('.', decimal),
      },
      {
        id: 'availability',
        header: t('manufacturing.boms.list.columns.availability'),
        enableSorting: false,
        cell: ({ row }) => (
          <BomAvailabilityBadge availability={row.original.availability} />
        ),
      },
      {
        accessorKey: 'updatedAt',
        header: t('manufacturing.boms.list.columns.updatedAt'),
        cell: ({ row }) => (
          new Date(row.original.updatedAt).toLocaleDateString(locale)
        ),
      },
    ],
    [decimal, locale, t],
  )

  const filters = useMemo<FilterDef[]>(
    () => [
      {
        id: 'status',
        label: t('manufacturing.boms.list.filters.status'),
        type: 'select',
        options: [
          {
            value: 'draft',
            label: t('manufacturing.boms.status.draft'),
          },
          {
            value: 'released',
            label: t('manufacturing.boms.status.released'),
          },
          {
            value: 'incomplete',
            label: t('manufacturing.boms.incomplete.badge'),
          },
        ],
      },
    ],
    [t],
  )

  return (
    <div className="space-y-4">
    {deleteTarget ? <BomDeleteAction bom={deleteTarget} onChanged={() => { setDeleteTarget(null); setReloadToken((token) => token + 1) }} /> : null}
    <DataTable<BomListItem>
      title={t('manufacturing.boms.list.title')}
      titleHeadingLevel={1}
      actions={canCreate ? (
        <Button asChild>
          <Link href="/backend/manufacturing/boms/create">
            {t('manufacturing.boms.start.create')}
          </Link>
        </Button>
      ) : undefined}
      columns={columns}
      data={rows}
      isLoading={isLoading}
      error={error}
      manualSorting
      sorting={sorting}
      onSortingChange={(next) => {
        setSorting(next)
        setPage(1)
      }}
      searchValue={search}
      onSearchChange={(value) => {
        setSearch(value)
        setPage(1)
      }}
      searchPlaceholder={t('manufacturing.boms.list.searchPlaceholder')}
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
      pagination={{
        page,
        pageSize: PAGE_SIZE,
        total,
        totalPages,
        totalIsCapped,
        onPageChange: setPage,
      }}
      refreshButton={{
        label: t('manufacturing.boms.list.refresh'),
        onRefresh: () => setReloadToken((token) => token + 1),
        isRefreshing: isLoading,
      }}
      onRowClick={(row) => router.push(`/backend/manufacturing/boms/${row.id}`)}
      rowActions={(row) => (
        <RowActions
          items={[
            {
              id: 'open',
              label: t('manufacturing.boms.list.open'),
              href: `/backend/manufacturing/boms/${row.id}`,
            },
            ...(canManage ? [{ id: 'delete', label: t('manufacturing.boms.list.delete'), destructive: true, onSelect: () => setDeleteTarget(row) }] : []),
          ]}
        />
      )}
      emptyState={search || status
        ? t('manufacturing.boms.list.emptySearch')
        : t('manufacturing.backend.boms.empty.description')}
    />
    </div>
  )
}

function BomVariantCell({ bom }: { bom: BomListItem }) {
  const t = useT()

  const name = bom.outputVariant?.name?.trim()
  const sku = bom.outputVariant?.sku?.trim()

  return (
    <div className="flex min-w-0 flex-col">
      <span className="truncate font-medium">
        {name || t('manufacturing.catalogVariant.unnamed')}
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {sku || bom.outputVariantId.slice(0, SHORT_ID_LENGTH)}
      </span>
    </div>
  )
}

function useBomCreatePermission(): boolean {
  const [canCreate, setCanCreate] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    async function checkPermissions() {
      try {
        const response = await apiCall<{ ok: boolean }>(
          '/api/auth/feature-check',
          {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              features: [
                'manufacturing.manage',
                'catalog.products.view',
              ],
            }),
          },
        )

        if (!controller.signal.aborted) {
          setCanCreate(response.ok && response.result?.ok === true)
        }
      } catch {
        if (!controller.signal.aborted) {
          setCanCreate(false)
        }
      }
    }

    void checkPermissions()

    return () => {
      controller.abort()
    }
  }, [])

  return canCreate
}

function useBomManagePermission(): boolean {
  const [canManage, setCanManage] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void apiCall<{ ok: boolean }>('/api/auth/feature-check', {
      method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ features: ['manufacturing.manage'] }),
    }).then((response) => {
      if (!controller.signal.aborted) setCanManage(response.ok && response.result?.ok === true)
    }).catch(() => { if (!controller.signal.aborted) setCanManage(false) })
    return () => controller.abort()
  }, [])
  return canManage
}
