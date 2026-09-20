import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { buildFeatureNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { notificationTypes } from '../notifications'

export const metadata = {
  event: 'supplier_demo.supply_case.attention_required',
  persistent: true,
  id: 'supplier-demo:attention-notification',
}

export default async function handle(payload: Record<string, unknown>, ctx: { resolve: <T = unknown>(name: string) => T }) {
  if (typeof payload.tenantId !== 'string' || typeof payload.organizationId !== 'string' || typeof payload.caseId !== 'string') return
  const typeDef = notificationTypes.find((type) => type.type === 'supplier_demo.supply_case.attention_required')
  if (!typeDef) return
  const notificationService = resolveNotificationService(ctx)
  const input = buildFeatureNotificationFromType(typeDef, {
    requiredFeature: 'supplier_demo.supply_cases.manage',
    bodyVariables: {
      caseId: payload.caseId,
      reason: typeof payload.reason === 'string' ? payload.reason : 'attention_required',
    },
    sourceEntityType: 'supplier_demo:supply_case',
    sourceEntityId: payload.caseId,
    linkHref: `/backend/supplier-demo/supply-cases/${encodeURIComponent(payload.caseId)}`,
  })
  await notificationService.createForFeature(input, {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
  })
}
