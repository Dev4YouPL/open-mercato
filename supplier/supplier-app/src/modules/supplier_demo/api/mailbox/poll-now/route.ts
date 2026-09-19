import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { SupplierDemoMailboxError, type MailboxErrorCode } from '../../../lib/mailbox'
import { requestMailboxPoll } from '../../../lib/mailbox-poll'
import { pollNowOpenApi, pollNowResponseSchema } from '../../supplier-cases-openapi'
import { createMutationContext } from '../../supply-cases/route-utils'

const logger = createLogger('supplier_demo').child({ component: 'mailbox-poll-now' })

// The mailbox is missing or misconfigured (env, user, channel, provider): the operator cannot fix this by retrying.
const NOT_CONFIGURED_CODES = new Set<MailboxErrorCode>([
  'mailbox_channel_id_missing',
  'mailbox_user_id_missing',
  'mailbox_configuration_invalid',
  'mailbox_user_not_found',
  'mailbox_not_configured',
  'mailbox_provider_unsupported',
])

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['supplier_demo.supply_cases.manage'] },
}

export async function POST(req: Request): Promise<Response> {
  const prepared = await createMutationContext(req, 'supplier_demo.mailbox', 'custom', { action: 'poll-now' })
  if ('response' in prepared) return prepared.response
  const tenantId = prepared.ctx.auth?.tenantId
  const organizationId = prepared.ctx.selectedOrganizationId
  if (!tenantId || !organizationId) return Response.json({ error: 'Organization scope required' }, { status: 400 })
  try {
    const result = await requestMailboxPoll(prepared.container.resolve('em') as EntityManager, { tenantId, organizationId })
    await prepared.guardResult.runAfterSuccess()
    return Response.json(pollNowResponseSchema.parse({ queued: result.queued, requestedAt: result.requestedAt }), { status: 202 })
  } catch (error) {
    if (error instanceof SupplierDemoMailboxError) {
      return Response.json({ error: error.code, code: error.code }, { status: NOT_CONFIGURED_CODES.has(error.code) ? 503 : 409 })
    }
    logger.error('Supplier mailbox poll could not be queued', { err: error, tenantId, organizationId })
    return Response.json({ error: 'Request failed' }, { status: 500 })
  }
}

export const openApi = pollNowOpenApi
