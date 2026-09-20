import type { ObjectPreviewData } from '@open-mercato/shared/modules/messages/types'

type PreviewContext = {
  tenantId: string
  organizationId?: string | null
}

const createClientPreview = async (
  entityId: string,
  _context: PreviewContext,
): Promise<ObjectPreviewData> => ({
  title: entityId,
  subtitle: entityId,
})

export const loadCatalogProductPreview = createClientPreview
export const loadCatalogVariantPreview = createClientPreview
export const loadCatalogCategoryPreview = createClientPreview
export const loadCurrencyPreview = createClientPreview
export const loadCustomerPersonPreview = createClientPreview
export const loadCustomerCompanyPreview = createClientPreview
export const loadCustomerDealPreview = createClientPreview
export const loadSalesOrderPreview = createClientPreview
export const loadSalesQuotePreview = createClientPreview
export const loadSalesChannelPreview = createClientPreview
export const loadResourcePreview = createClientPreview
export const loadLeaveRequestPreview = createClientPreview
export const loadTeamPreview = createClientPreview
export const loadTeamMemberPreview = createClientPreview
export const loadStaffTeamRolePreview = createClientPreview
export const loadStaffAvailabilityPreview = createClientPreview
export const loadInboxEmailPreview = createClientPreview
