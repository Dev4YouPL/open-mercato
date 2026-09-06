import type { PageMetadata } from "@open-mercato/shared/modules/registry"

export const metadata: PageMetadata = {
  requireAuth: true,
  requireFeatures: ["manufacturing.bom.view"],
  navHidden: true,
  pageTitle: "BOM draft",
  pageTitleKey: "manufacturing.boms.editor.title",
  breadcrumb: [
    { label: "BOM", labelKey: "manufacturing.nav.boms", href: "/backend/manufacturing/boms" },
    { label: "BOM draft", labelKey: "manufacturing.boms.editor.title" },
  ],
}

export default metadata
