"use client"

import * as React from "react"
import { Page, PageBody } from "@open-mercato/ui/backend/Page"
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from "@open-mercato/ui/backend/detail"
import { StatusBadge } from "@open-mercato/ui/primitives/status-badge"
import { Button } from "@open-mercato/ui/primitives/button"
import { apiCall } from "@open-mercato/ui/backend/utils/apiCall"
import { surfaceRecordConflict } from "@open-mercato/ui/backend/conflicts"
import { useT } from "@open-mercato/shared/lib/i18n/context"
import { BomHeaderFormClient, type BomHeaderFormInitial } from "./BomHeaderFormClient"
import { BomLinesEditor } from "./BomLinesEditor"

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
  }

  return (
    <Page>
      <PageBody>
        <div className="mb-4 flex items-center gap-2">
          <StatusBadge variant="info">{t("manufacturing.boms.editor.draftBadge", "Draft")}</StatusBadge>
          <span className="text-sm text-muted-foreground">
            {t("manufacturing.boms.editor.revisionLabel", "Revision #{number}", { number: detail.activeDraft.revisionNumber })}
          </span>
        </div>
        <BomHeaderFormClient initial={initial} onSaved={reload} />
        <div className="mt-6">
          <BomLinesEditor
            bomId={detail.id}
            revisionId={detail.activeDraft.id}
            revisionUpdatedAt={detail.activeDraft.updatedAt}
            onAggregateChange={reload}
          />
        </div>
      </PageBody>
    </Page>
  )
}

export default BomEditorClient
