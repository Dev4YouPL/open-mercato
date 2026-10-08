'use client'

import * as React from 'react'
import { z } from 'zod'

import {
  useT,
} from '@open-mercato/shared/lib/i18n/context'
import {
  ErrorMessage,
  LoadingMessage,
} from '@open-mercato/ui/backend/detail'
import {
  LookupSelect,
  type LookupSelectItem,
} from '@open-mercato/ui/backend/inputs/LookupSelect'
import {
  apiCall,
} from '@open-mercato/ui/backend/utils/apiCall'

const uuidSchema = z.string().uuid()

const variantListResponseSchema = z.object({
  items: z.array(
    z.object({
      id: uuidSchema,
      name: z.string().nullish(),
      sku: z.string().nullish(),
    }),
  ),
})

export type CatalogVariantSelectProps = {
  value: string | null
  onChange: (value: string | null) => void
  disabled?: boolean
  searchPlaceholder?: string
}

export function CatalogVariantSelect(
  props: CatalogVariantSelectProps,
) {
  const instanceKey = [
    props.value ?? 'empty',
    props.disabled ? 'disabled' : 'enabled',
  ].join(':')

  return (
    <CatalogVariantSelectInput
      key={instanceKey}
      {...props}
    />
  )
}

function CatalogVariantSelectInput({
  value,
  onChange,
  disabled = false,
  searchPlaceholder,
}: CatalogVariantSelectProps) {
  const t = useT()

  const [selectedItem, setSelectedItem] =
    React.useState<LookupSelectItem | null>(null)

  const [selectedLoading, setSelectedLoading] =
    React.useState(Boolean(value))

  const [selectedError, setSelectedError] =
    React.useState<string | null>(null)

  const [searchError, setSearchError] =
    React.useState<string | null>(null)

  const selectedItemRef =
    React.useRef<LookupSelectItem | null>(null)

  const searchControllerRef =
    React.useRef<AbortController | null>(null)

  const loadVariants = React.useCallback(
    async (
      params: URLSearchParams,
      signal: AbortSignal,
    ): Promise<LookupSelectItem[]> => {
      const response = await apiCall<unknown>(
        `/api/catalog/variants?${params.toString()}`,
        { signal },
      ).catch(() => {
        throw new Error(
          t('manufacturing.catalogVariant.loadFailed'),
        )
      })

      if (!response.ok) {
        throw new Error(
          t(
            response.status === 403
              ? 'manufacturing.catalogVariant.forbidden'
              : 'manufacturing.catalogVariant.loadFailed',
          ),
        )
      }

      const parsed = variantListResponseSchema.safeParse(
        response.result,
      )

      if (!parsed.success) {
        throw new Error(
          t('manufacturing.catalogVariant.loadFailed'),
        )
      }

      return parsed.data.items.map((variant) => {
        const name = variant.name?.trim() ?? ''
        const sku = variant.sku?.trim() ?? ''

        const title =
          name ||
          sku ||
          t('manufacturing.catalogVariant.unnamed')

        return {
          id: variant.id,
          title,
          subtitle: sku && sku !== title ? sku : null,
        }
      })
    },
    [t],
  )

  React.useEffect(() => {
    const controller = new AbortController()

    selectedItemRef.current = null
    setSelectedItem(null)
    setSelectedError(null)
    setSelectedLoading(Boolean(value))

    if (value) {
      const params = new URLSearchParams({
        id: value,
        pageSize: '1',
      })

      void loadVariants(params, controller.signal)
        .then((items) => {
          if (controller.signal.aborted) return

          const selected =
            items.find((item) => item.id === value) ?? null

          selectedItemRef.current = selected
          setSelectedItem(selected)

          if (!selected) {
            setSelectedError(
              t('manufacturing.catalogVariant.unavailable'),
            )
          }
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return

          setSelectedError(
            error instanceof Error
              ? error.message
              : t('manufacturing.catalogVariant.loadFailed'),
          )
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setSelectedLoading(false)
          }
        })
    }

    return () => {
      controller.abort()
      searchControllerRef.current?.abort()
    }
  }, [value, loadVariants, t])

  const selectedOptions = React.useMemo(
    () => selectedItem ? [selectedItem] : [],
    [selectedItem],
  )

  const fetchItems = React.useCallback(
    async (query: string): Promise<LookupSelectItem[]> => {
      searchControllerRef.current?.abort()
      setSearchError(null)

      const term = query.trim()

      if (term.length < 2) {
        const selected = selectedItemRef.current

        return selected ? [selected] : []
      }

      const controller = new AbortController()
      searchControllerRef.current = controller

      const params = new URLSearchParams({
        pageSize: '20',
        sortField: 'name',
        sortDir: 'asc',
      })

      if (uuidSchema.safeParse(term).success) {
        params.set('id', term)
      } else {
        params.set('search', term)
      }

      try {
        const items = await loadVariants(
          params,
          controller.signal,
        )

        if (controller.signal.aborted) return []

        const selected = selectedItemRef.current

        return selected
          ? [
            selected,
            ...items.filter(
              (item) => item.id !== selected.id,
            ),
          ]
          : items
      } catch (error: unknown) {
        if (controller.signal.aborted) return []

        setSearchError(
          error instanceof Error
            ? error.message
            : t('manufacturing.catalogVariant.loadFailed'),
        )

        const selected = selectedItemRef.current

        return selected ? [selected] : []
      }
    },
    [loadVariants, t],
  )

  return (
    <div className="space-y-2">
      <LookupSelect
        value={value}
        onChange={onChange}
        disabled={disabled}
        minQuery={2}
        options={selectedOptions}
        fetchItems={fetchItems}
        searchPlaceholder={
          searchPlaceholder ??
          t('manufacturing.catalogVariant.placeholder')
        }
        emptyLabel={
          searchError
            ? ''
            : t('manufacturing.catalogVariant.empty')
        }
        selectedHintLabel={() => selectedItem?.title ?? ''}
        showIcon={false}
      />

      {selectedLoading ? (
        <LoadingMessage
          label={t(
            'manufacturing.catalogVariant.loadingSelected',
          )}
        />
      ) : null}

      {selectedError ? (
        <ErrorMessage label={selectedError} />
      ) : null}

      {searchError && searchError !== selectedError ? (
        <ErrorMessage label={searchError} />
      ) : null}
    </div>
  )
}