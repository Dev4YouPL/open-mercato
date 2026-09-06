"use client"

import * as React from "react"
import { ComboboxInput, type ComboboxOption } from "@open-mercato/ui/backend/inputs"
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
  return (
    <ComboboxInput
      value={asString(value)}
      onChange={(next) => onChange(next.trim().length ? next.trim() : null)}
      seedOptions={toSeedOptions(seed)}
      loadSuggestions={loadProductOptions}
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
  return (
    <ComboboxInput
      key={`variant-${productId ?? "none"}`}
      value={asString(value)}
      onChange={(next) => onChange(next.trim().length ? next.trim() : null)}
      seedOptions={toSeedOptions(seed)}
      loadSuggestions={(query) => (productId ? loadVariantOptions(productId, query) : Promise.resolve([]))}
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
  return (
    <ComboboxInput
      key={`unit-${productId ?? "none"}`}
      value={asString(value)}
      onChange={(next) => onChange(next.trim().length ? next.trim() : null)}
      loadSuggestions={(query) => loadProductUnitOptions(productId, query)}
      allowCustomValues={false}
      clearable
      disabled={disabled || !productId}
      placeholder={t("manufacturing.boms.form.baseOutputUnitPlaceholder", "Select a unit")}
    />
  )
}

/**
 * Selecting a product invalidates both product-scoped references, and the
 * Catalog base unit is the only safe default for the new product.
 */
export function applyProductSelection(
  next: string | null,
  setFormValue: ((id: string, value: unknown) => void) | undefined,
  fields: { variant: string; unit: string },
): void {
  setFormValue?.(fields.variant, null)
  setFormValue?.(fields.unit, null)
  if (!next) return
  loadProductDefaultUnitCode(next)
    .then((code) => { if (code) setFormValue?.(fields.unit, code) })
    .catch(() => { /* the unit picker still lists every valid option */ })
}
