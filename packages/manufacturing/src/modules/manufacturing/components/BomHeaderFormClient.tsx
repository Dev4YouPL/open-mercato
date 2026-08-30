"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  CrudForm,
  type CrudField,
  type CrudCustomFieldRenderProps,
} from "@open-mercato/ui/backend/CrudForm"
import { LookupSelect, type LookupSelectItem } from "@open-mercato/ui/backend/inputs"
import { createCrud, updateCrud } from "@open-mercato/ui/backend/utils/crud"
import { flash } from "@open-mercato/ui/backend/FlashMessages"
import { useT } from "@open-mercato/shared/lib/i18n/context"
import {
  loadProductDefaultUnitCode,
  loadProductOptionsWithSelection,
  loadProductUnitOptions,
  loadVariantOptionsWithSelection,
} from "./catalogLookups"
import { toBomFormError } from "./bomFormErrors"
import { useBomPermissions } from "./useBomPermissions"
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
}

export function BomHeaderFormClient({ initial, onSaved }: { initial?: BomHeaderFormInitial; onSaved?: () => void }) {
  const t = useT()
  const router = useRouter()
  const isEdit = Boolean(initial?.bomId)
  const { canManage } = useBomPermissions()

  // Seeds the pickers so an existing target renders immediately instead of an
  // empty "start typing" box; the loaders keep the selection across queries.
  const productSeed = React.useMemo<LookupSelectItem[] | undefined>(() => (
    initial?.productId
      ? [{ id: initial.productId, title: initial.productName ?? initial.productId }]
      : undefined
  ), [initial?.productId, initial?.productName])
  const variantSeed = React.useMemo<LookupSelectItem[] | undefined>(() => (
    initial?.variantId
      ? [{ id: initial.variantId, title: initial.variantName ?? initial.variantId }]
      : undefined
  ), [initial?.variantId, initial?.variantName])
  const unitSeed = React.useMemo<LookupSelectItem[] | undefined>(() => (
    initial?.baseOutputUnitCode
      ? [{ id: initial.baseOutputUnitCode, title: initial.baseOutputUnitCode }]
      : undefined
  ), [initial?.baseOutputUnitCode])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: "productId",
      label: t("manufacturing.boms.form.product", "Product"),
      type: "custom",
      required: true,
      layout: "half",
      component: ({ value, setValue, setFormValue }: CrudCustomFieldRenderProps) => (
        <LookupSelect
          value={typeof value === "string" ? value : null}
          onChange={(next) => {
            setValue(next ?? null)
            setFormValue?.("variantId", null)
            setFormValue?.("baseOutputUnitCode", null)
            if (next) {
              loadProductDefaultUnitCode(next)
                .then((code) => { if (code) setFormValue?.("baseOutputUnitCode", code) })
                .catch(() => { /* the unit picker still lists every valid option */ })
            }
          }}
          options={productSeed}
          fetchOptions={(query) => loadProductOptionsWithSelection(query, typeof value === "string" ? value : null)}
          placeholder={t("manufacturing.boms.form.productPlaceholder", "Select a product")}
        />
      ),
    },
    {
      id: "variantId",
      label: t("manufacturing.boms.form.variant", "Variant"),
      type: "custom",
      layout: "half",
      component: ({ value, setValue, values }: CrudCustomFieldRenderProps) => {
        const productId = typeof values?.productId === "string" ? values.productId : null
        return (
          <LookupSelect
            key={`variant-${productId ?? "none"}`}
            value={typeof value === "string" ? value : null}
            onChange={(next) => setValue(next ?? null)}
            options={variantSeed}
            fetchOptions={(query) => loadVariantOptionsWithSelection(productId, query, typeof value === "string" ? value : null)}
            disabled={!productId}
            placeholder={t("manufacturing.boms.form.variantPlaceholder", "Optional — product-scoped")}
          />
        )
      },
    },
    {
      id: "revisionLabel",
      label: t("manufacturing.boms.form.revisionLabel", "Revision label"),
      type: "text",
      layout: "full",
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
      component: ({ value, setValue, values }: CrudCustomFieldRenderProps) => {
        const productId = typeof values?.productId === "string" ? values.productId : null
        return (
          <LookupSelect
            key={`unit-${productId ?? "none"}`}
            value={typeof value === "string" ? value : null}
            onChange={(next) => setValue(next ?? null)}
            options={unitSeed}
            fetchOptions={(query) => loadProductUnitOptions(productId, query)}
            minQuery={0}
            disabled={!productId}
            placeholder={t("manufacturing.boms.form.baseOutputUnitPlaceholder", "Select a unit")}
            emptyLabel={t("manufacturing.boms.form.unitsEmpty", "No units configured for this product in Catalog")}
          />
        )
      },
    },
  ], [t, productSeed, variantSeed, unitSeed])

  const initialValues = React.useMemo<Partial<BomHeaderFormValues>>(() => ({
    productId: initial?.productId ?? null,
    variantId: initial?.variantId ?? null,
    revisionLabel: initial?.revisionLabel ?? null,
    baseOutputValue: initial?.baseOutputValue ?? "1",
    baseOutputUnitCode: initial?.baseOutputUnitCode ?? null,
  }), [initial])

  return (
    <CrudForm<BomHeaderFormValues>
      entityId={extensionPoints.hosts.bomHeaderForm.entityId}
      title={isEdit
        ? t("manufacturing.boms.editor.headerTitle", "BOM header")
        : t("manufacturing.boms.create.title", "New BOM draft")}
      backHref="/backend/manufacturing/boms"
      cancelHref="/backend/manufacturing/boms"
      fields={fields}
      initialValues={initialValues}
      optimisticLockUpdatedAt={initial?.updatedAt ?? null}
      readOnly={!canManage}
      submitLabel={isEdit ? t("manufacturing.boms.form.save", "Save") : t("manufacturing.boms.form.create", "Create draft")}
      onSubmit={async (values) => {
        const target = { productId: values.productId, variantId: values.variantId || null }
        const baseOutput = { value: values.baseOutputValue, unitCode: values.baseOutputUnitCode || null }
        try {
          if (isEdit && initial) {
            await updateCrud(`manufacturing/boms/${initial.bomId}`, {
              target,
              draft: { revisionLabel: values.revisionLabel || null, baseOutput },
            })
            flash(t("manufacturing.boms.form.saveSuccess", "BOM header saved"), "success")
            onSaved?.()
            return
          }
          const { result } = await createCrud<{ bom: { id: string } }>("manufacturing/boms", {
            target,
            revisionLabel: values.revisionLabel || null,
            baseOutput,
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
}

export default BomHeaderFormClient
