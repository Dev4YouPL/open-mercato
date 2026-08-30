"use client"

import * as React from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@open-mercato/ui/primitives/dialog"
import { useDialogKeyHandler } from "@open-mercato/ui/hooks/useDialogKeyHandler"
import { CrudForm, type CrudField, type CrudCustomFieldRenderProps } from "@open-mercato/ui/backend/CrudForm"
import { LookupSelect } from "@open-mercato/ui/backend/inputs"
import { createCrud, updateCrud } from "@open-mercato/ui/backend/utils/crud"
import { buildOptimisticLockHeader, extractOptimisticLockConflict } from "@open-mercato/ui/backend/utils/optimisticLock"
import { flash } from "@open-mercato/ui/backend/FlashMessages"
import { useT } from "@open-mercato/shared/lib/i18n/context"
import {
  loadProductDefaultUnitCode,
  loadProductOptions,
  loadProductUnitOptions,
  loadVariantOptions,
} from "./catalogLookups"
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

export function BomLineDialog({
  bomId,
  revisionUpdatedAt,
  initial,
  onClose,
  onSaved,
  onConflict,
}: {
  bomId: string
  revisionUpdatedAt: string
  initial?: BomLineFormValues
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
        <LookupSelect
          value={typeof value === "string" ? value : null}
          onChange={(next) => {
            setValue(next ?? null)
            setFormValue?.("componentVariantId", null)
            setFormValue?.("quantityUnitCode", null)
            if (next) {
              loadProductDefaultUnitCode(next)
                .then((code) => { if (code) setFormValue?.("quantityUnitCode", code) })
                .catch(() => { /* the unit picker still lists every valid option */ })
            }
          }}
          fetchOptions={loadProductOptions}
        />
      ),
    },
    {
      id: "componentVariantId",
      label: t("manufacturing.boms.lines.form.variant", "Variant"),
      type: "custom",
      layout: "half",
      component: ({ value, setValue, values }: CrudCustomFieldRenderProps) => {
        const productId = typeof values?.componentProductId === "string" ? values.componentProductId : null
        return (
          <LookupSelect
            key={`variant-${productId ?? "none"}`}
            value={typeof value === "string" ? value : null}
            onChange={(next) => setValue(next ?? null)}
            fetchOptions={(query) => (productId ? loadVariantOptions(productId, query) : Promise.resolve([]))}
            disabled={!productId}
          />
        )
      },
    },
    { id: "quantityValue", label: t("manufacturing.boms.lines.form.quantity", "Quantity"), type: "text", required: true, layout: "third", defaultValue: "1" },
    {
      id: "quantityUnitCode",
      label: t("manufacturing.boms.lines.form.unit", "Unit"),
      type: "custom",
      layout: "third",
      component: ({ value, setValue, values }: CrudCustomFieldRenderProps) => {
        const productId = typeof values?.componentProductId === "string" ? values.componentProductId : null
        return (
          <LookupSelect
            key={`unit-${productId ?? "none"}`}
            value={typeof value === "string" ? value : null}
            onChange={(next) => setValue(next ?? null)}
            fetchOptions={(query) => loadProductUnitOptions(productId, query)}
            minQuery={0}
            disabled={!productId}
            placeholder={t("manufacturing.boms.form.baseOutputUnitPlaceholder", "Select a unit")}
            emptyLabel={t("manufacturing.boms.form.unitsEmpty", "No units configured for this product in Catalog")}
          />
        )
      },
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
    { id: "yieldFactor", label: t("manufacturing.boms.lines.form.yield", "Yield factor"), type: "text", layout: "half", defaultValue: "1" },
    {
      id: "supplyMode",
      label: t("manufacturing.boms.lines.form.supply", "Supply mode"),
      type: "select",
      layout: "half",
      defaultValue: "stock",
      options: [
        { value: "stock", label: t("manufacturing.boms.lines.supply.stock", "Stock") },
        { value: "produce", label: t("manufacturing.boms.lines.supply.produce", "Produce") },
      ],
    },
  ], [t])

  const initialValues = React.useMemo<Partial<BomLineFormValues>>(() => initial ?? {
    componentProductId: null,
    componentVariantId: null,
    quantityValue: "1",
    quantityUnitCode: null,
    consumptionBasis: "variable",
    yieldFactor: "1",
    supplyMode: "stock",
  }, [initial])

  const handleKeyDown = useDialogKeyHandler({
    onConfirm: () => { /* CrudForm owns Cmd/Ctrl+Enter submit internally */ },
    onCancel: onClose,
  })

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="sm:max-w-2xl" ref={dialogContentRef} onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("manufacturing.boms.lines.editTitle", "Edit component occurrence") : t("manufacturing.boms.lines.addTitle", "Add component occurrence")}
          </DialogTitle>
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
