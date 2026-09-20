import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SupplierRfq } from '../../../data/entities'

export const metadata = { GET: { requireAuth: true, requireFeatures: ['supplier_demo.rfqs.view'] } }

export const rfqDetailResponseSchema = z.object({
  id: z.string(), correlationId: z.string(), subject: z.string(), senderEmail: z.string(), recipientEmail: z.string().nullable(), rfcMessageId: z.string().nullable(), threadId: z.string().nullable(), rawBody: z.string(), sku: z.string(), requestedQuantity: z.number().nullable(), requestedDeliveryDate: z.string().nullable(), interpretationStatus: z.string(), interpretationRecord: z.record(z.string(), z.unknown()).nullable(), availabilitySnapshot: z.record(z.string(), z.unknown()).nullable(), priceSnapshot: z.record(z.string(), z.unknown()).nullable(), computedOffer: z.record(z.string(), z.unknown()).nullable(), status: z.string(), operatorDecision: z.string(), sendStatus: z.string(), replySubject: z.string().nullable(), replyBody: z.string().nullable(), lastError: z.string().nullable(), history: z.array(z.record(z.string(), z.unknown())), createdAt: z.string().nullable(), updatedAt: z.string().nullable(),
})

function iso(value: Date | null | undefined): string | null { return value ? value.toISOString() : null }

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const rfq = await findOneWithDecryption(em, SupplierRfq, { id, tenantId: auth.tenantId, organizationId: auth.orgId, deletedAt: null }, undefined, { tenantId: auth.tenantId, organizationId: auth.orgId })
  if (!rfq) return Response.json({ error: 'RFQ not found' }, { status: 404 })
  return Response.json({ id: rfq.id, correlationId: rfq.correlationId, subject: rfq.subject, senderEmail: rfq.senderEmail, recipientEmail: rfq.recipientEmail ?? null, rfcMessageId: rfq.rfcMessageId ?? null, threadId: rfq.threadId ?? null, rawBody: rfq.rawBody, sku: rfq.sku, requestedQuantity: rfq.requestedQuantity ?? null, requestedDeliveryDate: rfq.requestedDeliveryDate ?? null, interpretationStatus: rfq.interpretationStatus, interpretationRecord: rfq.interpretationRecord ?? null, availabilitySnapshot: rfq.availabilitySnapshot ?? null, priceSnapshot: rfq.priceSnapshot ?? null, computedOffer: rfq.computedOffer ?? null, status: rfq.status, operatorDecision: rfq.operatorDecision, sendStatus: rfq.sendStatus, replySubject: rfq.replySubject ?? null, replyBody: rfq.replyBody ?? null, lastError: rfq.lastError ?? null, history: rfq.history, createdAt: iso(rfq.createdAt), updatedAt: iso(rfq.updatedAt) })
}
