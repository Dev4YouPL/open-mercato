"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  CrudForm,
  type CrudField,
  type CrudFormGroup,
  type CrudCustomFieldRenderProps,
} from "@open-mercato/ui/backend/CrudForm"
import type { ComboboxOption } from "@open-mercato/ui/backend/inputs"
import { createCrud, updateCrud } from "@open-mercato/ui/backend/utils/crud"
import { collectCustomFieldValues } from "@open-mercato/ui/backend/utils/customFieldValues"
import { flash } from "@open-mercato/ui/backend/FlashMessages"
import { useT } from "@open-mercato/shared/lib/i18n/context"
import { ProductPicker, UnitPicker, VariantPicker, applyProductSelection } from "./BomCatalogPickers"
import { formatDecimalForDisplay } from "./bomFormatting"
import { toBomFormError } from "./bomFormErrors"
import { useBomPermissions } from "./useBomPermissions"
import { BOM_ENTITY_ID } from "../lib/bom/entity-ids"
import { extensionPoints } from "../extension-points"

type BomHeaderFormValues = {
  productId: string | null
  variantId: string | null
  revisionLabel: string | null
  baseOutputValue: string
  baseOutputUnitCode: string | null
}

export type BomHeaderFormInitial = {
  bomId: string
  updatedAt: string
  productId: string
  variantId: string | null
  revisionLabel: string | null
  baseOutputValue: string
  baseOutputUnitCode: string
  productName?: string | null
  variantName?: string | null
  customFields?: Record<string, unknown>
}

const PRODUCT_SCOPED_FIELDS = { variant: "variantId", unit: "baseOutputUnitCode" }

export function BomHeaderFormClient({ initial, onSaved, wrapInCard = true }: { initial?: BomHeaderFormInitial; onSaved?: () => void; wrapInCard?: boolean }) {
  const t = useT()
  const router = useRouter()
  const isEdit = Boolean(initial?.bomId)
  const { canManage } = useBomPermissions()

  // Seeds the pickers so an existing target renders its Catalog label instead
  // of the stored uuid before the first lookup resolves.
  const productSeed = React.useMemo<ComboboxOption | null>(() => (
    initial?.productId ? { value: initial.productId, label: initial.productName ?? initial.productId } : null
  ), [initial?.productId, initial?.productName])
  const variantSeed = React.useMemo<ComboboxOption | null>(() => (
    initial?.variantId ? { value: initial.variantId, label: initial.variantName ?? initial.variantId } : null
  ), [initial?.variantId, initial?.variantName])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: "productId",
      label: t("manufacturing.boms.form.product", "Product"),
      type: "custom",
      required: true,
      layout: "half",
      description: t("manufacturing.boms.form.productHint", "The manufactured output this BOM defines."),
      component: ({ value, setValue, setFormValue }: CrudCustomFieldRenderProps) => (
        <ProductPicker
          value={value}
          seed={productSeed}
          onChange={(next) => {
            setValue(next)
            applyProductSelection(next, setFormValue, PRODUCT_SCOPED_FIELDS)
          }}
        />
      ),
    },
    {
      id: "variantId",
      label: t("manufacturing.boms.form.variant", "Variant"),
      type: "custom",
      layout: "half",
      component: ({ value, setValue, values }: CrudCustomFieldRenderProps) => (
        <VariantPicker
          value={value}
          seed={variantSeed}
          productId={typeof values?.productId === "string" ? values.productId : null}
          onChange={setValue}
        />
      ),
    },
    {
      id: "revisionLabel",
      label: t("manufacturing.boms.form.revisionLabel", "Notes"),
      type: "text",
      layout: "full",
      description: t("manufacturing.boms.form.revisionLabelHint", "Optional internal note for this draft."),
    },
    {
      id: "baseOutputValue",
      label: t("manufacturing.boms.form.baseOutputValue", "Base output quantity"),
      type: "text",
      required: true,
      layout: "half",
      defaultValue: "1",
    },
    {
      id: "baseOutputUnitCode",
      label: t("manufacturing.boms.form.baseOutputUnit", "Base unit"),
      type: "custom",
      layout: "half",
      description: t("manufacturing.boms.form.baseOutputUnitHint", "Only units configured in Catalog."),
      component: ({ value, setValue, values }: CrudCustomFieldRenderProps) => (
        <UnitPicker
          value={value}
          productId={typeof values?.productId === "string" ? values.productId : null}
          onChange={setValue}
        />
      ),
    },
  ], [productSeed, t, variantSeed])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: "basic",
      title: t("manufacturing.boms.form.group.basic", "Basic BOM data"),
      column: 1,
      description: t("manufacturing.boms.form.group.outputDescription", "The quantity this BOM produces in one run. Component quantities are entered against it."),
      fields: ["productId", "variantId", "revisionLabel", "baseOutputValue", "baseOutputUnitCode"],
    },
    {
      id: "custom",
      title: t("entities.customFields.title", "Custom Attributes"),
      column: 2,
      kind: "customFields",
    },
  ], [t])

  const initialValues = React.useMemo<Partial<BomHeaderFormValues>>(() => {
    const customFieldValues: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(initial?.customFields ?? {})) {
      customFieldValues[`cf_${key}`] = value
    }
    return {
      ...customFieldValues,
      productId: initial?.productId ?? null,
      variantId: initial?.variantId ?? null,
      revisionLabel: initial?.revisionLabel ?? null,
      // The stored value is padded to its column scale; an author edits `1`,
      // not `1.000000`, and either re-normalizes to the same evidence.
      baseOutputValue: initial ? formatDecimalForDisplay(initial.baseOutputValue) : "1",
      baseOutputUnitCode: initial?.baseOutputUnitCode ?? null,
    }
  }, [initial])

  const form = (
      <CrudForm<BomHeaderFormValues>
      // Custom fields are stored against the platform entity id, while the
      // widget spot and replacement handle stay on the published
      // `crud-form:manufacturing.bom` contract.
      entityIds={[BOM_ENTITY_ID]}
      injectionSpotId={extensionPoints.hosts.bomHeaderForm.spotId}
      replacementHandle={extensionPoints.hosts.bomHeaderForm.spotId}
      title={isEdit
        ? t("manufacturing.boms.editor.headerTitle", "BOM header")
        : t("manufacturing.boms.create.title", "New BOM draft")}
      backHref="/backend/manufacturing/boms"
      cancelHref="/backend/manufacturing/boms"
      fields={fields}
      groups={groups}
      initialValues={initialValues}
      optimisticLockUpdatedAt={initial?.updatedAt ?? null}
      readOnly={!canManage}
      submitLabel={isEdit ? t("manufacturing.boms.form.save", "Save") : t("manufacturing.boms.form.create", "Create draft")}
      onSubmit={async (values) => {
        const target = { productId: values.productId, variantId: values.variantId || null }
        const baseOutput = { value: values.baseOutputValue, unitCode: values.baseOutputUnitCode || null }
        const customFields = collectCustomFieldValues(values as Record<string, unknown>)
        const hasCustomFields = Object.keys(customFields).length > 0
        try {
          if (isEdit && initial) {
            await updateCrud(`manufacturing/boms/${initial.bomId}`, {
              target,
              draft: { revisionLabel: values.revisionLabel || null, baseOutput },
              ...(hasCustomFields ? { customFields } : {}),
            })
            flash(t("manufacturing.boms.form.saveSuccess", "BOM header saved"), "success")
            onSaved?.()
            return
          }
          const { result } = await createCrud<{ bom: { id: string } }>("manufacturing/boms", {
            target,
            revisionLabel: values.revisionLabel || null,
            baseOutput,
            ...(hasCustomFields ? { customFields } : {}),
          })
          flash(t("manufacturing.boms.form.createSuccess", "BOM draft created"), "success")
          if (result?.bom?.id) router.push(`/backend/manufacturing/boms/${result.bom.id}`)
          else router.push("/backend/manufacturing/boms")
        } catch (err) {
          throw toBomFormError(err, t, {
            unit: "baseOutputUnitCode",
            quantity: "baseOutputValue",
            variant: "variantId",
            product: "productId",
          })
        }
      }}
      />
  )

  if (!wrapInCard) return form

  return (
    <div className="rounded-xl border bg-card p-4 sm:p-6">
      {form}
    </div>
  )
}

export default BomHeaderFormClient
