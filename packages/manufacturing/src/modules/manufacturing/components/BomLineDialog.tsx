"use client"

import * as React from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@open-mercato/ui/primitives/dialog"
import { useDialogKeyHandler } from "@open-mercato/ui/hooks/useDialogKeyHandler"
import { CrudForm, type CrudField, type CrudCustomFieldRenderProps } from "@open-mercato/ui/backend/CrudForm"
import type { ComboboxOption } from "@open-mercato/ui/backend/inputs"
import { createCrud, updateCrud } from "@open-mercato/ui/backend/utils/crud"
import { buildOptimisticLockHeader, extractOptimisticLockConflict } from "@open-mercato/ui/backend/utils/optimisticLock"
import { flash } from "@open-mercato/ui/backend/FlashMessages"
import { useT } from "@open-mercato/shared/lib/i18n/context"
import { ProductPicker, UnitPicker, VariantPicker, applyProductSelection } from "./BomCatalogPickers"
import { toBomFormError } from "./bomFormErrors"
import { extensionPoints } from "../extension-points"

export type BomLineFormValues = {
  lineId?: string
  componentProductId: string | null
  componentVariantId: string | null
  quantityValue: string
  quantityUnitCode: string | null
  consumptionBasis: "variable" | "fixed"
  yieldFactor: string
  supplyMode: "stock" | "produce"
}

const PRODUCT_SCOPED_FIELDS = { variant: "componentVariantId", unit: "quantityUnitCode" }

export function BomLineDialog({
  bomId,
  revisionUpdatedAt,
  initial,
  position,
  componentSeed,
  variantSeed,
  onClose,
  onSaved,
  onConflict,
}: {
  bomId: string
  revisionUpdatedAt: string
  initial?: BomLineFormValues
  position?: number
  componentSeed?: ComboboxOption | null
  variantSeed?: ComboboxOption | null
  onClose: () => void
  onSaved: () => void
  onConflict: () => void
}) {
  const t = useT()
  const isEdit = Boolean(initial?.lineId)
  const dialogContentRef = React.useRef<HTMLDivElement>(null)

  const handleSubmit = React.useCallback(async (values: BomLineFormValues) => {
    const component = { productId: values.componentProductId, variantId: values.componentVariantId || null }
    const quantity = { value: values.quantityValue, unitCode: values.quantityUnitCode || null }
    try {
      if (isEdit && initial?.lineId) {
        await updateCrud(`manufacturing/boms/${bomId}/lines/${initial.lineId}`, {
          component,
          quantity,
          consumptionBasis: values.consumptionBasis,
          yieldFactor: values.yieldFactor,
          supplyMode: values.supplyMode,
        }, { headers: buildOptimisticLockHeader(revisionUpdatedAt) })
      } else {
        await createCrud(`manufacturing/boms/${bomId}/lines`, {
          component,
          quantity,
          consumptionBasis: values.consumptionBasis,
          yieldFactor: values.yieldFactor,
          supplyMode: values.supplyMode,
        }, { headers: buildOptimisticLockHeader(revisionUpdatedAt) })
      }
      flash(isEdit ? t("manufacturing.boms.lines.saveSuccess", "Occurrence saved") : t("manufacturing.boms.lines.addSuccess", "Occurrence added"), "success")
      onSaved()
    } catch (err) {
      if (extractOptimisticLockConflict(err)) {
        flash(t("manufacturing.boms.lines.conflict", "Someone else changed this draft — refreshing"), "warning")
        onConflict()
        return
      }
      throw toBomFormError(err, t, {
        unit: "quantityUnitCode",
        quantity: "quantityValue",
        variant: "componentVariantId",
        product: "componentProductId",
      })
    }
  }, [bomId, initial, isEdit, onConflict, onSaved, revisionUpdatedAt, t])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: "componentProductId",
      label: t("manufacturing.boms.lines.form.product", "Component product"),
      type: "custom",
      required: true,
      layout: "half",
      component: ({ value, setValue, setFormValue }: CrudCustomFieldRenderProps) => (
        <ProductPicker
          value={value}
          seed={componentSeed}
          onChange={(next) => {
            setValue(next)
            applyProductSelection(next, setFormValue, PRODUCT_SCOPED_FIELDS)
          }}
        />
      ),
    },
    {
      id: "componentVariantId",
      label: t("manufacturing.boms.lines.form.variant", "Variant"),
      type: "custom",
      layout: "half",
      component: ({ value, setValue, values }: CrudCustomFieldRenderProps) => (
        <VariantPicker
          value={value}
          seed={variantSeed}
          productId={typeof values?.componentProductId === "string" ? values.componentProductId : null}
          onChange={setValue}
        />
      ),
    },
    { id: "quantityValue", label: t("manufacturing.boms.lines.form.quantity", "Quantity"), type: "text", required: true, layout: "third", defaultValue: "1" },
    {
      id: "quantityUnitCode",
      label: t("manufacturing.boms.lines.form.unit", "Unit"),
      type: "custom",
      layout: "third",
      component: ({ value, setValue, values }: CrudCustomFieldRenderProps) => (
        <UnitPicker
          value={value}
          productId={typeof values?.componentProductId === "string" ? values.componentProductId : null}
          onChange={setValue}
        />
      ),
    },
    {
      id: "consumptionBasis",
      label: t("manufacturing.boms.lines.form.basis", "Basis"),
      type: "select",
      layout: "third",
      defaultValue: "variable",
      options: [
        { value: "variable", label: t("manufacturing.boms.lines.basis.variable", "Variable") },
        { value: "fixed", label: t("manufacturing.boms.lines.basis.fixed", "Fixed") },
      ],
    },
    {
      id: "yieldFactor",
      label: t("manufacturing.boms.lines.form.yield", "Yield factor"),
      type: "text",
      layout: "half",
      defaultValue: "1",
      description: t("manufacturing.boms.lines.form.yieldHint", "Between 0 and 1 — the usable share of the consumed quantity."),
    },
    {
      id: "supplyMode",
      label: t("manufacturing.boms.lines.form.supply", "Supply mode"),
      type: "select",
      layout: "half",
      defaultValue: "stock",
      description: t("manufacturing.boms.lines.form.supplyHint", "Produce resolves a child BOM; stock is a leaf component."),
      options: [
        { value: "stock", label: t("manufacturing.boms.lines.supply.stock", "Stock") },
        { value: "produce", label: t("manufacturing.boms.lines.supply.produce", "Produce") },
      ],
    },
  ], [componentSeed, t, variantSeed])

  const initialValues = React.useMemo<Partial<BomLineFormValues>>(() => initial ?? {
    componentProductId: null,
    componentVariantId: null,
    quantityValue: "1",
    quantityUnitCode: null,
    consumptionBasis: "variable",
    yieldFactor: "1",
    supplyMode: "stock",
  }, [initial])

  const submitEmbeddedForm = React.useCallback(() => {
    const form = dialogContentRef.current?.querySelector("form")
    if (form) form.requestSubmit()
  }, [])

  const handleKeyDown = useDialogKeyHandler({
    onConfirm: submitEmbeddedForm,
    onCancel: onClose,
  })

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="sm:max-w-2xl" ref={dialogContentRef} onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("manufacturing.boms.lines.editTitle", "Edit component occurrence") : t("manufacturing.boms.lines.addTitle", "Add component occurrence")}
          </DialogTitle>
          {isEdit && position !== undefined ? (
            <DialogDescription>
              {t("manufacturing.boms.lines.editSubtitle", "Occurrence at position {position}", { position: String(position) })}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <CrudForm<BomLineFormValues>
          entityId={extensionPoints.hosts.bomLineForm.entityId}
          embedded
          fields={fields}
          initialValues={initialValues}
          submitLabel={isEdit ? t("manufacturing.boms.lines.save", "Save") : t("manufacturing.boms.lines.add", "Add")}
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}

export default BomLineDialog
