import type { PageMetadata } from "@open-mercato/shared/modules/registry"

export const metadata: PageMetadata = {
  requireAuth: true,
  requireFeatures: ["manufacturing.work_center.manage"],
  navHidden: true,
  pageTitle: "New work centre",
  pageTitleKey: "manufacturing.workCenters.create.title",
  breadcrumb: [
    { label: "Work centres", labelKey: "manufacturing.workCenters.menu.label", href: "/backend/manufacturing/work-centers" },
    { label: "New work centre", labelKey: "manufacturing.workCenters.create.title" },
  ],
}

export default metadata
