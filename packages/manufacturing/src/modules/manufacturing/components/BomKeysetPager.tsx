"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@open-mercato/ui/primitives/button"
import { useT } from "@open-mercato/shared/lib/i18n/context"

/**
 * The BOM APIs paginate by opaque keyset cursor, so no total or page count
 * exists to drive the shared offset footer. This renders the same card-footer
 * chrome with previous/next semantics instead of inventing a total the
 * contract cannot provide.
 */
export function BomKeysetPager({
  page,
  hasPrevious,
  hasNext,
  isLoading,
  onPrevious,
  onNext,
}: {
  page: number
  hasPrevious: boolean
  hasNext: boolean
  isLoading: boolean
  onPrevious: () => void
  onNext: () => void
}) {
  const t = useT()
  if (!hasPrevious && !hasNext) return null
  return (
    <nav
      aria-label={t("manufacturing.boms.pager.ariaLabel", "Pagination")}
      className="mx-1 mt-2 flex flex-col gap-3 rounded-lg border bg-card px-4 py-3 sm:mx-2 sm:flex-row sm:items-center sm:justify-between"
    >
      <span className="text-sm text-muted-foreground">
        {t("manufacturing.boms.pager.page", "Page {page}", { page: String(page) })}
      </span>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" disabled={!hasPrevious || isLoading} onClick={onPrevious}>
          <ChevronLeft className="size-4" aria-hidden="true" />
          {t("manufacturing.boms.pager.previous", "Previous")}
        </Button>
        <Button type="button" variant="outline" disabled={!hasNext || isLoading} onClick={onNext}>
          {t("manufacturing.boms.pager.next", "Next")}
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  )
}

export default BomKeysetPager
