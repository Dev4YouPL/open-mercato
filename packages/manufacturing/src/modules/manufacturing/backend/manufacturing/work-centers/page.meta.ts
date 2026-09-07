import type { PageMetadata } from "@open-mercato/shared/modules/registry"

export const metadata: PageMetadata = {
  requireAuth: true,
  requireFeatures: ["manufacturing.work_center.view"],
  pageTitle: "Work centres",
  pageTitleKey: "manufacturing.workCenters.menu.label",
  pageGroup: "Manufacturing",
  pageGroupKey: "manufacturing.nav.group",
  icon: "factory",
  breadcrumb: [{ label: "Work centres", labelKey: "manufacturing.workCenters.menu.label" }],
}

export default metadata
