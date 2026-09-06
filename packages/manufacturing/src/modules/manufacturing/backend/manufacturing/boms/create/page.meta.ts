import type { PageMetadata } from "@open-mercato/shared/modules/registry"

export const metadata: PageMetadata = {
  requireAuth: true,
  requireFeatures: ["manufacturing.bom.manage"],
  navHidden: true,
  pageTitle: "New BOM",
  pageTitleKey: "manufacturing.boms.create.title",
}

export default metadata
