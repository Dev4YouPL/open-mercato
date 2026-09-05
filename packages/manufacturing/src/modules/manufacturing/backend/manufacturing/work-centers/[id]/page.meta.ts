import type { PageMetadata } from "@open-mercato/shared/modules/registry"

/**
 * View-only access is deliberate: a viewer may open the record, and the form
 * hides every mutation affordance without manage.
 */
export const metadata: PageMetadata = {
  requireAuth: true,
  requireFeatures: ["manufacturing.work_center.view"],
  navHidden: true,
  pageTitle: "Work centre",
  pageTitleKey: "manufacturing.workCenters.detail.title",
  breadcrumb: [
    { label: "Work centres", labelKey: "manufacturing.workCenters.menu.label", href: "/backend/manufacturing/work-centers" },
    { label: "Work centre", labelKey: "manufacturing.workCenters.detail.title" },
  ],
}

export default metadata
