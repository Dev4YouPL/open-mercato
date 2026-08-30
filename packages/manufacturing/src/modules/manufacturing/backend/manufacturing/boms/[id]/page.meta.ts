import type { PageMetadata } from "@open-mercato/shared/modules/registry"

export const metadata: PageMetadata = {
  requireAuth: true,
  requireFeatures: ["manufacturing.bom.view"],
  navHidden: true,
  pageTitle: "BOM draft",
  pageTitleKey: "manufacturing.boms.editor.title",
}

export default metadata
