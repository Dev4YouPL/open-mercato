"use client"

import * as React from "react"
import Link from "next/link"
import { Button } from "@open-mercato/ui/primitives/button"
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from "@open-mercato/ui/backend/detail"
import { apiCall } from "@open-mercato/ui/backend/utils/apiCall"
import { useT } from "@open-mercato/shared/lib/i18n/context"
import { WorkCenterFormClient, type WorkCenterFormInitial } from "./WorkCenterFormClient"

const LIST_HREF = "/backend/manufacturing/work-centers"

type DetailResponse = { items?: WorkCenterFormInitial[] }

/**
 * Detail reads go through the standard collection GET with a single `ids`
 * value — there is no `/work-centers/:id` route. An empty, non-disclosing
 * result is what a missing or foreign id looks like, and it renders the shared
 * not-found state instead of an empty form.
 */
export function WorkCenterDetailClient({ workCenterId }: { workCenterId: string }) {
  const t = useT()
  const [record, setRecord] = React.useState<WorkCenterFormInitial | null>(null)
  const [status, setStatus] = React.useState<"loading" | "ready" | "missing" | "error">("loading")

  React.useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    void (async () => {
      setStatus("loading")
      try {
        const response = await apiCall<DetailResponse>(
          `/api/manufacturing/work-centers?ids=${encodeURIComponent(workCenterId)}&pageSize=1`,
          { signal: controller.signal },
        )
        if (cancelled) return
        if (!response.ok) {
          setStatus("error")
          return
        }
        const item = Array.isArray(response.result?.items) ? response.result.items[0] : undefined
        if (!item) {
          setStatus("missing")
          return
        }
        setRecord(item)
        setStatus("ready")
      } catch {
        if (!cancelled) setStatus("error")
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [workCenterId])

  if (status === "loading") {
    return <LoadingMessage label={t("manufacturing.workCenters.detail.loading", "Loading work centre...")} />
  }

  if (status === "missing") {
    return (
      <RecordNotFoundState
        label={t("manufacturing.workCenters.detail.notFound", "Work centre not found")}
        backHref={LIST_HREF}
        backLabel={t("manufacturing.workCenters.detail.backToList", "Back to work centres")}
      />
    )
  }

  if (status === "error" || !record) {
    return (
      <ErrorMessage
        label={t("manufacturing.workCenters.detail.loadError", "Failed to load work centre")}
        action={
          <Button asChild variant="outline">
            <Link href={LIST_HREF}>{t("manufacturing.workCenters.detail.backToList", "Back to work centres")}</Link>
          </Button>
        }
      />
    )
  }

  return <WorkCenterFormClient initial={record} />
}

export default WorkCenterDetailClient
