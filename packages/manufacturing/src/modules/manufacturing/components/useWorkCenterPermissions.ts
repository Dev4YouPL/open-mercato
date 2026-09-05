"use client"

import * as React from "react"
import { apiCall } from "@open-mercato/ui/backend/utils/apiCall"
import { hasAllFeatures } from "@open-mercato/shared/lib/auth/featureMatch"

const MANAGE_FEATURE = "manufacturing.work_center.manage"
const RESOURCES_VIEW_FEATURE = "resources.view"

export type WorkCenterPermissions = {
  canManage: boolean
  /** Whether the caller may read `resources` at all — membership editing needs it. */
  canViewResources: boolean
  isLoading: boolean
}

/**
 * The list and detail pages only require `manufacturing.work_center.view`, so a
 * viewer can reach them and write affordances must be hidden rather than
 * offered and rejected. Membership editing additionally needs the peer's own
 * `resources.view`, which Manufacturing never grants.
 *
 * `hasAllFeatures` applies the platform's wildcard ACL matching. The API stays
 * authoritative; this only gates what the UI renders, and it fails closed while
 * loading and on error.
 */
export function useWorkCenterPermissions(): WorkCenterPermissions {
  const [permissions, setPermissions] = React.useState<WorkCenterPermissions>({
    canManage: false,
    canViewResources: false,
    isLoading: true,
  })

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await apiCall<{ granted?: string[] }>("/api/auth/feature-check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ features: [MANAGE_FEATURE, RESOURCES_VIEW_FEATURE] }),
        })
        if (cancelled) return
        const granted = res.result?.granted ?? []
        setPermissions({
          canManage: hasAllFeatures([MANAGE_FEATURE], granted),
          canViewResources: hasAllFeatures([RESOURCES_VIEW_FEATURE], granted),
          isLoading: false,
        })
      } catch {
        if (!cancelled) setPermissions({ canManage: false, canViewResources: false, isLoading: false })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return permissions
}
