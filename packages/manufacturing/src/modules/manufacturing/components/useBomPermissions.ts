"use client"

import * as React from "react"
import { useOrganizationScopeVersion } from "@open-mercato/shared/lib/frontend/useOrganizationScope"

import { apiCall } from "@open-mercato/ui/backend/utils/apiCall"
import { hasAllFeatures } from "@open-mercato/shared/lib/auth/featureMatch"

const MANAGE_FEATURE = "manufacturing.bom.manage"

export type BomPermissions = {
  canManage: boolean
  isLoading: boolean
}

/**
 * The BOM list and editor pages only require `manufacturing.bom.view`, so a
 * viewer can reach them. Write affordances must then be hidden rather than
 * offered and rejected (spec ACL: "hides manage-only affordances when absent",
 * US-BOM-31). `hasAllFeatures` applies the platform's wildcard ACL matching.
 * The API stays authoritative — this only gates what the UI renders, and it
 * fails closed while loading or on error.
 */
export function useBomPermissions(): BomPermissions {
  const scopeVersion = useOrganizationScopeVersion()
  const [loadedScope, setLoadedScope] = React.useState(scopeVersion)
  const [permissions, setPermissions] = React.useState<BomPermissions>({ canManage: false, isLoading: true })

  React.useEffect(() => {
    let cancelled = false
    setPermissions({ canManage: false, isLoading: true })
    setLoadedScope(scopeVersion)
    void (async () => {
      try {
        const res = await apiCall<{ granted?: string[] }>("/api/auth/feature-check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ features: [MANAGE_FEATURE] }),
        })
        if (cancelled) return
        setPermissions({
          canManage: res.ok && hasAllFeatures([MANAGE_FEATURE], res.result?.granted ?? []),
          isLoading: false,
        })
      } catch {
        if (!cancelled) setPermissions({ canManage: false, isLoading: false })
      }
    })()
    return () => { cancelled = true }
  }, [scopeVersion])

  return loadedScope === scopeVersion ? permissions : { canManage: false, isLoading: true }
}
