"use client"

import * as React from "react"
import { ComboboxInput, type ComboboxOption } from "@open-mercato/ui/backend/inputs"
import { flash } from "@open-mercato/ui/backend/FlashMessages"
import { useT } from "@open-mercato/shared/lib/i18n/context"
import {
  loadProductDefaultUnitCode,
  loadProductOptions,
  loadProductUnitOptions,
  loadVariantOptions,
  resolveProductLabel,
  resolveVariantLabel,
} from "./catalogLookups"

/**
 * Catalog reference pickers shared by the BOM header form and the direct-line
 * dialog. They render one compact combobox row each — label plus SKU, never a
 * media tile — so a form holding three references stays the height of three
 * inputs no matter how large the Catalog is.
 */

type PickerProps = {
  value: unknown
  seed?: ComboboxOption | null
  disabled?: boolean
  onChange: (next: string | null) => void
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function toSeedOptions(seed?: ComboboxOption | null): ComboboxOption[] | undefined {
  return seed ? [seed] : undefined
}

export function ProductPicker({ value, seed, disabled, onChange }: PickerProps) {
  const t = useT()
  const load = useCatalogLookupFeedback()
  return (
    <ComboboxInput
      value={asString(value)}
      onChange={(next) => onChange(next.trim().length ? next.trim() : null)}
      seedOptions={toSeedOptions(seed)}
      loadSuggestions={(query) => load(() => loadProductOptions(query))}
      resolveLabel={resolveProductLabel}
      allowCustomValues={false}
      clearable
      disabled={disabled}
      placeholder={t("manufacturing.boms.form.productPlaceholder", "Select a product")}
    />
  )
}

export function VariantPicker({
  value,
  seed,
  productId,
  disabled,
  onChange,
}: PickerProps & { productId: string | null }) {
  const t = useT()
  const load = useCatalogLookupFeedback()
  return (
    <ComboboxInput
      key={`variant-${productId ?? "none"}`}
      value={asString(value)}
      onChange={(next) => onChange(next.trim().length ? next.trim() : null)}
      seedOptions={toSeedOptions(seed)}
      loadSuggestions={(query) => load(() => productId ? loadVariantOptions(productId, query) : Promise.resolve([]))}
      resolveLabel={resolveVariantLabel}
      allowCustomValues={false}
      clearable
      disabled={disabled || !productId}
      placeholder={t("manufacturing.boms.form.variantPlaceholder", "Optional — product-scoped")}
    />
  )
}

export function UnitPicker({
  value,
  productId,
  disabled,
  onChange,
}: Omit<PickerProps, "seed"> & { productId: string | null }) {
  const t = useT()
  const load = useCatalogLookupFeedback()
  return (
    <ComboboxInput
      key={`unit-${productId ?? "none"}`}
      value={asString(value)}
      onChange={(next) => onChange(next.trim().length ? next.trim() : null)}
      loadSuggestions={(query) => load(() => loadProductUnitOptions(productId, query))}
      allowCustomValues={false}
      clearable
      disabled={disabled || !productId}
      placeholder={t("manufacturing.boms.form.baseOutputUnitPlaceholder", "Select a unit")}
    />
  )
}

function useCatalogLookupFeedback() {
  const t = useT()
  return React.useCallback(async (lookup: () => Promise<ComboboxOption[]>) => {
    try {
      return await lookup()
    } catch (error) {
      flash(t("ui.error", "Something went wrong"), "error")
      throw error
    }
  }, [t])
}

export function useProductSelection() {
  const generation = React.useRef(0)
  React.useEffect(() => () => { generation.current += 1 }, [])
  const cancelDefault = React.useCallback(() => { generation.current += 1 }, [])
  const selectProduct = React.useCallback((
    next: string | null,
    current: unknown,
    setFormValue: ((id: string, value: unknown) => void) | undefined,
    fields: { variant: string; unit: string },
  ) => {
    if (next === current) return
    const request = ++generation.current
    setFormValue?.(fields.variant, null)
    setFormValue?.(fields.unit, null)
    if (!next) return
    void loadProductDefaultUnitCode(next).then((code) => {
      if (code && request === generation.current) setFormValue?.(fields.unit, code)
    }).catch(() => {})
  }, [])
  return { selectProduct, cancelDefault }
}
