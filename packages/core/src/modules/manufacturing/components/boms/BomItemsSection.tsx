'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { z } from 'zod'

import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import {
  useOptionalLocale,
  useT,
} from '@open-mercato/shared/lib/i18n/context'
import { resolveLocaleNumberSeparators } from '@open-mercato/shared/lib/number'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import {
  ErrorMessage,
  LoadingMessage,
} from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import {
  readApiResultOrThrow,
  withScopedApiRequestHeaders,
} from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Button } from '@open-mercato/ui/primitives/button'

import { bomItemCreateSchema } from '../../data/validators'
import { BomItemDialog } from './BomItemDialog'
import type { BomItemRecord, BomRecord } from './formConfig'

const PAGE_SIZE = 25
const MAX_POSITION = 2_147_483_647
const TABLE_ID = 'manufacturing.bom_items'

const itemRecordSchema = bomItemCreateSchema.extend({
  id: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
})

const itemListSchema = z.object({
  items: z.array(itemRecordSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive().max(100),
  totalPages: z.number().int().nonnegative(),
  totalIsCapped: z.boolean().optional(),
})

const variantSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullish(),
  sku: z.string().nullish(),
})

const variantListSchema = z.object({
  items: z.array(variantSchema),
})

type VariantSummary = z.infer<typeof variantSchema>

type DialogState = {
  item: BomItemRecord | null
  defaultPosition: number
}

export type BomItemsSectionProps = {
  bom: BomRecord
  canManage?: boolean
}

export function BomItemsSection(props: BomItemsSectionProps) {
  const scopeVersion = useOrganizationScopeVersion()

  return (
    <BomItemsSectionContent
      key={`${props.bom.id}:${scopeVersion}`}
      {...props}
    />
  )
}

function BomItemsSectionContent({
  bom,
  canManage = false,
}: BomItemsSectionProps) {
  const t = useT()
  const locale = useOptionalLocale()
  const { decimal } = resolveLocaleNumberSeparators(locale)

  const [rows, setRows] = useState<BomItemRecord[]>([])
  const [variants, setVariants] = useState(
    () => new Map<string, VariantSummary>(),
  )
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [totalIsCapped, setTotalIsCapped] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isBusy, setIsBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [variantNamesFailed, setVariantNamesFailed] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [dialog, setDialog] = useState<DialogState | null>(null)

  const activeRef = useRef(true)
  const busyRef = useRef(false)
  const canEdit = canManage && bom.status === 'draft'
  const canEditRef = useRef(canEdit)
  canEditRef.current = canEdit

  const contextId = `manufacturing-bom-items-${bom.id}`

  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const { runMutation, retryLastMutation } = useGuardedMutation({
    contextId,
    blockedMessage: t('manufacturing.forms.saveFailed'),
  })

  useEffect(() => {
    activeRef.current = true

    return () => {
      activeRef.current = false
    }
  }, [])

  const refresh = useCallback(() => {
    if (activeRef.current) {
      setReloadToken((current) => current + 1)
    }
  }, [])

  const readItems = useCallback(
    async (
      requestedPage: number,
      pageSize: number,
      sortDir: 'asc' | 'desc',
      signal?: AbortSignal,
    ) => {
      const params = new URLSearchParams({
        bomId: bom.id,
        page: String(requestedPage),
        pageSize: String(pageSize),
        sortField: 'position',
        sortDir,
      })

      const payload = await readApiResultOrThrow<unknown>(
        `/api/manufacturing/bom-items?${params.toString()}`,
        { signal },
        {
          errorMessage: t('manufacturing.bomItems.list.loadFailed'),
        },
      )

      const parsed = itemListSchema.safeParse(payload)

      if (
        !parsed.success
        || parsed.data.items.some((item) => item.bomId !== bom.id)
      ) {
        throw createCrudFormError(
          t('manufacturing.bomItems.list.loadFailed'),
        )
      }

      return parsed.data
    },
    [bom.id, t],
  )

  useEffect(() => {
    const controller = new AbortController()

    setIsLoading(true)
    setLoadError(null)
    setVariantNamesFailed(false)

    async function load() {
      try {
        const data = await readItems(
          page,
          PAGE_SIZE,
          'asc',
          controller.signal,
        )

        if (controller.signal.aborted) {
          return
        }

        if (
          !data.totalIsCapped
          && page > Math.max(1, data.totalPages)
        ) {
          setPage(Math.max(1, data.totalPages))
          return
        }

        const variantIds = [
          ...new Set(
            data.items.map((item) => item.componentVariantId),
          ),
        ]

        let nextVariants = new Map<string, VariantSummary>()

        if (variantIds.length > 0) {
          try {
            const params = new URLSearchParams({
              ids: variantIds.join(','),
              page: '1',
              pageSize: String(variantIds.length),
            })

            const payload = await readApiResultOrThrow<unknown>(
              `/api/catalog/variants?${params.toString()}`,
              { signal: controller.signal },
              {
                errorMessage: t(
                  'manufacturing.bomItems.list.variantNamesFailed',
                ),
              },
            )

            const parsed = variantListSchema.safeParse(payload)

            if (!parsed.success) {
              throw createCrudFormError(
                t('manufacturing.bomItems.list.variantNamesFailed'),
              )
            }

            const requestedIds = new Set(variantIds)

            nextVariants = new Map(
              parsed.data.items
                .filter((variant) => requestedIds.has(variant.id))
                .map((variant) => [variant.id, variant]),
            )
          } catch {
            if (controller.signal.aborted) {
              return
            }

            setVariantNamesFailed(true)
          }
        }

        if (controller.signal.aborted) {
          return
        }

        setRows(data.items)
        setVariants(nextVariants)
        setTotal(data.total)
        setTotalPages(data.totalPages)
        setTotalIsCapped(data.totalIsCapped ?? false)
      } catch {
        if (!controller.signal.aborted) {
          setRows([])
          setVariants(new Map())
          setLoadError(
            t('manufacturing.bomItems.list.loadFailed'),
          )
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
  }, [page, readItems, reloadToken, t])

  const columns = useMemo<ColumnDef<BomItemRecord>[]>(
    () => [
      {
        accessorKey: 'position',
        header: t('manufacturing.bomItems.form.position'),
        enableSorting: false,
      },
      {
        accessorKey: 'componentVariantId',
        header: t('manufacturing.bomItems.form.componentVariant'),
        enableSorting: false,
        meta: {
          truncate: true,
          maxWidth: '360px',
        },
        cell: ({ row }) => {
          const variant = variants.get(
            row.original.componentVariantId,
          )

          const name = variant?.name?.trim()
          const sku = variant?.sku?.trim()

          if (name && sku) {
            return `${name} (${sku})`
          }

          return name || sku || row.original.componentVariantId
        },
      },
      {
        accessorKey: 'quantity',
        header: t('manufacturing.bomItems.form.quantity'),
        enableSorting: false,
        cell: ({ row }) => (
          row.original.quantity.replace('.', decimal)
        ),
      },
    ],
    [decimal, t, variants],
  )

  async function openCreate() {
    if (!canEditRef.current || busyRef.current || isLoading) {
      return
    }

    busyRef.current = true
    setIsBusy(true)

    try {
      const data = await readItems(1, 1, 'desc')
      const nextPosition = (data.items[0]?.position ?? 0) + 1

      if (nextPosition > MAX_POSITION) {
        throw createCrudFormError(
          t('manufacturing.bomItems.list.positionLimit'),
        )
      }

      if (activeRef.current && canEditRef.current) {
        setDialog({
          item: null,
          defaultPosition: nextPosition,
        })
      }
    } catch (error) {
      if (activeRef.current) {
        flash(
          error instanceof Error
            ? error.message
            : t('manufacturing.bomItems.list.loadFailed'),
          'error',
        )
      }
    } finally {
      busyRef.current = false

      if (activeRef.current) {
        setIsBusy(false)
      }
    }
  }

  function openEdit(item: BomItemRecord) {
    if (!canEditRef.current || busyRef.current || isLoading) {
      return
    }

    setDialog({
      item,
      defaultPosition: item.position,
    })
  }

  async function handleDelete(item: BomItemRecord) {
    if (!canEditRef.current || busyRef.current || isLoading) {
      return
    }

    busyRef.current = true
    setIsBusy(true)

    try {
      const confirmed = await confirm({
        title: t('manufacturing.bomItems.list.deleteTitle'),
        description: t(
          'manufacturing.bomItems.list.deleteDescription',
        ),
        confirmText: t('manufacturing.bomItems.list.delete'),
        cancelText: t('ui.forms.actions.cancel'),
        variant: 'destructive',
      })

      if (!confirmed || !activeRef.current) {
        return
      }

      await runMutation({
        mutationPayload: {
          id: item.id,
          bomId: bom.id,
        },
        context: {
          formId: contextId,
          resourceKind: 'manufacturing.bom_item',
          resourceId: item.id,
          parentResourceKind: 'manufacturing.bom',
          parentResourceId: bom.id,
          operation: 'delete',
          retryLastMutation,
        },
        operation: async () => {
          if (!activeRef.current || !canEditRef.current) {
            throw createCrudFormError(
              t('manufacturing.errors.bomNotDraft'),
            )
          }

          busyRef.current = true
          setIsBusy(true)

          try {
            await withScopedApiRequestHeaders(
              buildOptimisticLockHeader(item.updatedAt),
              () => deleteCrud(
                'manufacturing/bom-items',
                {
                  body: {
                    id: item.id,
                    bomId: bom.id,
                  },
                  errorMessage: t(
                    'manufacturing.bomItems.list.deleteFailed',
                  ),
                },
              ),
            )

            if (activeRef.current) {
              setRows((current) => (
                current.filter((row) => row.id !== item.id)
              ))

              flash(
                t('manufacturing.bomItems.list.deleted'),
                'success',
              )

              refresh()
            }
          } finally {
            busyRef.current = false

            if (activeRef.current) {
              setIsBusy(false)
            }
          }
        },
      })
    } catch (error) {
      if (
        activeRef.current
        && !surfaceRecordConflict(error, t, { onRefresh: refresh })
      ) {
        flash(
          error instanceof Error
            ? error.message
            : t('manufacturing.bomItems.list.deleteFailed'),
          'error',
        )
      }
    } finally {
      busyRef.current = false

      if (activeRef.current) {
        setIsBusy(false)
      }
    }
  }

  return (
    <section className="space-y-4">
      {variantNamesFailed ? (
        <ErrorMessage
          label={t(
            'manufacturing.bomItems.list.variantNamesFailed',
          )}
        />
      ) : null}

      {loadError ? (
        <ErrorMessage
          label={loadError}
          action={
            <Button
              type="button"
              variant="outline"
              onClick={refresh}
            >
              {t('manufacturing.bomItems.list.refresh')}
            </Button>
          }
        />
      ) : isLoading && rows.length === 0 ? (
        <LoadingMessage
          label={t('manufacturing.bomItems.list.loading')}
        />
      ) : (
        <DataTable<BomItemRecord>
          title={t('manufacturing.bomItems.list.title')}
          extensionTableId={TABLE_ID}
          injectionContext={{
            formId: contextId,
            resourceKind: 'manufacturing.bom',
            resourceId: bom.id,
            canEdit,
            retryLastMutation,
          }}
          columns={columns}
          data={rows}
          isLoading={isLoading}
          sortable={false}
          disableRowClick={!canEdit || isBusy || isLoading}
          rowClickActionIds={['edit']}
          refreshButton={{
            label: t('manufacturing.bomItems.list.refresh'),
            isRefreshing: isLoading,
            onRefresh: refresh,
          }}
          actions={canEdit ? (
            <Button
              type="button"
              disabled={isLoading || isBusy}
              onClick={() => void openCreate()}
            >
              {t('manufacturing.bomItems.list.add')}
            </Button>
          ) : undefined}
          rowActions={
            canEdit && !isBusy && !isLoading
              ? (item) => (
                  <RowActions
                    items={[
                      {
                        id: 'edit',
                        label: t(
                          'manufacturing.bomItems.list.edit',
                        ),
                        onSelect: () => openEdit(item),
                      },
                      {
                        id: 'delete',
                        label: t(
                          'manufacturing.bomItems.list.delete',
                        ),
                        destructive: true,
                        onSelect: () => {
                          void handleDelete(item)
                        },
                      },
                    ]}
                  />
                )
              : undefined
          }
          emptyState={
            <p className="text-sm text-muted-foreground">
              {t('manufacturing.bomItems.list.empty')}
            </p>
          }
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total,
            totalPages,
            totalIsCapped,
            onPageChange: setPage,
          }}
        />
      )}

      {dialog && canEdit ? (
        <BomItemDialog
          bomId={bom.id}
          item={dialog.item}
          defaultPosition={dialog.defaultPosition}
          open
          onClose={() => setDialog(null)}
          onSaved={refresh}
        />
      ) : null}

      {ConfirmDialogElement}
    </section>
  )
}