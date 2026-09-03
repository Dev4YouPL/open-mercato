import type { PageMetadata } from "@open-mercato/shared/modules/registry"

export const metadata: PageMetadata = {
  requireAuth: true,
  requireFeatures: ["manufacturing.bom.view"],
  pageTitle: "BOMs",
  pageTitleKey: "manufacturing.nav.boms",
  pageGroup: "Manufacturing",
  pageGroupKey: "manufacturing.nav.group",
  icon: "layers",
  breadcrumb: [{ label: "BOMs", labelKey: "manufacturing.nav.boms" }],
}

export default metadata
