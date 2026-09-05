"use client"

import * as React from "react"
import { PageHeader } from "@open-mercato/ui/backend/Page"
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from "@open-mercato/ui/backend/detail"
import { StatusBadge } from "@open-mercato/ui/primitives/status-badge"
import { Button } from "@open-mercato/ui/primitives/button"
import { apiCall } from "@open-mercato/ui/backend/utils/apiCall"
import { surfaceRecordConflict } from "@open-mercato/ui/backend/conflicts"
import { useT } from "@open-mercato/shared/lib/i18n/context"
import { BomHeaderFormClient, type BomHeaderFormInitial } from "./BomHeaderFormClient"
import { BomLinesEditor } from "./BomLinesEditor"
import { formatCatalogTarget, parseCatalogLabel } from "./catalogLabels"
import { formatDecimalForDisplay } from "./bomFormatting"

type BomDetail = {
  id: string
  target: { productId: string; variantId: string | null }
  targetLabel?: { productName?: string | null; variantName?: string | null }
  activeDraft: {
    id: string
    revisionNumber: number
    revisionLabel: string | null
    baseOutput: { value: string; unitCode: string; normalizedValue: string; baseUnitCode: string }
    updatedAt: string
  }
  directLineSummary: { count: number; unresolvedProduceCount: number }
  customFields?: Record<string, unknown>
  updatedAt: string
}

export function BomEditorClient({ bomId }: { bomId: string }) {
  const t = useT()
  const [detail, setDetail] = React.useState<BomDetail | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)

  const reload = React.useCallback(() => setReloadToken((n) => n + 1), [])

  React.useEffect(() => {
    if (!bomId) return
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      setNotFound(false)
      const call = await apiCall<BomDetail>(`/api/manufacturing/boms/${bomId}`, undefined, { fallback: null })
      if (cancelled) return
      if (!call.ok) {
        const status = call.response?.status
        if (status === 404) setNotFound(true)
        else if (status === 401 || status === 403) {
          // US-BOM-32: access denied is a distinct state with its own next
          // action — retrying the same request can never resolve it.
          setError(t("manufacturing.boms.editor.forbidden", "You do not have access to this BOM draft. Ask an administrator for the Manufacturing BOM view permission."))
        } else {
          const conflictHandled = surfaceRecordConflict(call.result, t)
          if (!conflictHandled) setError(t("manufacturing.boms.editor.loadError", "Failed to load BOM draft"))
        }
        setIsLoading(false)
        return
      }
      setDetail(call.result)
      setIsLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [bomId, reloadToken, t])

  if (isLoading) return <LoadingMessage label={t("manufacturing.boms.editor.loading", "Loading BOM draft…")} />
  if (notFound) {
    return (
      <RecordNotFoundState
        label={t("manufacturing.boms.editor.notFound", "BOM draft not found")}
        backHref="/backend/manufacturing/boms"
        backLabel={t("manufacturing.boms.editor.backToList", "Back to BOM drafts")}
      />
    )
  }
  if (error || !detail) {
    return (
      <ErrorMessage
        label={error ?? t("manufacturing.boms.editor.loadError", "Failed to load BOM draft")}
        action={<Button type="button" variant="outline" size="sm" onClick={reload}>{t("ui.actions.retry", "Retry")}</Button>}
      />
    )
  }

  const initial: BomHeaderFormInitial = {
    bomId: detail.id,
    updatedAt: detail.activeDraft.updatedAt,
    productId: detail.target.productId,
    variantId: detail.target.variantId,
    revisionLabel: detail.activeDraft.revisionLabel,
    baseOutputValue: detail.activeDraft.baseOutput.value,
    baseOutputUnitCode: detail.activeDraft.baseOutput.unitCode,
    productName: detail.targetLabel?.productName ?? null,
    variantName: detail.targetLabel?.variantName ?? null,
    customFields: detail.customFields,
  }

  const targetTitle = formatCatalogTarget(parseCatalogLabel(detail.targetLabel), {
    productId: detail.target.productId,
    variantId: detail.target.variantId,
  })
  const revisionSuffix = detail.activeDraft.revisionLabel ? ` — ${detail.activeDraft.revisionLabel}` : ""

  return (
    <>
      <PageHeader
        title={targetTitle}
        description={t("manufacturing.boms.editor.baseOutput", "Base output: {value} {unit} ({normalized} {baseUnit})", {
          value: formatDecimalForDisplay(detail.activeDraft.baseOutput.value),
          unit: detail.activeDraft.baseOutput.unitCode,
          normalized: formatDecimalForDisplay(detail.activeDraft.baseOutput.normalizedValue),
          baseUnit: detail.activeDraft.baseOutput.baseUnitCode,
        })}
        actions={(
          <>
            <StatusBadge variant="info" dot>{t("manufacturing.boms.editor.draftBadge", "Draft")}</StatusBadge>
            <StatusBadge variant="neutral">
              {`${t("manufacturing.boms.editor.revisionLabel", "Revision #{number}", { number: String(detail.activeDraft.revisionNumber) })}${revisionSuffix}`}
            </StatusBadge>
            {detail.directLineSummary.unresolvedProduceCount > 0 ? (
              <StatusBadge variant="warning" dot>
                {t("manufacturing.boms.editor.unresolvedBadge", "{count} unresolved", {
                  count: String(detail.directLineSummary.unresolvedProduceCount),
                })}
              </StatusBadge>
            ) : null}
          </>
        )}
      />
      <div className="rounded-xl border bg-card p-4 sm:p-6">
        <div className="space-y-4">
          <BomHeaderFormClient initial={initial} onSaved={reload} wrapInCard={false} />
          <BomLinesEditor
            bomId={detail.id}
            revisionId={detail.activeDraft.id}
            revisionUpdatedAt={detail.activeDraft.updatedAt}
            onAggregateChange={reload}
          />
        </div>
      </div>
    </>
  )
}

export default BomEditorClient
