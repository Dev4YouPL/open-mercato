import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SupplyCase, SupplyMessage } from '../../../data/entities'
import { buildSupplyCaseTimeline, SUPPLY_TIMELINE_STEPS } from '../../../lib/timeline'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['supplier_demo.supply_cases.view'] },
}

const commitmentSchema = z.object({ quantity: z.number(), date: z.string() })
const messageSchema = z.object({
  id: z.string(),
  direction: z.enum(['inbound', 'outbound']),
  messageType: z.string().nullable(),
  businessMessageId: z.string(),
  validationStatus: z.string().nullable(),
  validationReason: z.string().nullable(),
  deliveryStatus: z.string(),
  sender: z.string().nullable(),
  recipient: z.string().nullable(),
  subject: z.string(),
  bodyExcerpt: z.string().nullable(),
  envelope: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  receivedAt: z.string().nullable(),
  queuedAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  appliedAt: z.string().nullable(),
  duplicateCount: z.number(),
  inReplyToBusinessId: z.string().nullable(),
})
const timelineStepSchema = z.object({
  key: z.enum(SUPPLY_TIMELINE_STEPS),
  state: z.enum(['done', 'current', 'pending', 'error', 'skipped']),
  at: z.string().nullable(),
  params: z.record(z.string(), z.union([z.string(), z.number()])),
})

export const supplyCaseDetailResponseSchema = z.object({
  id: z.string(),
  correlationId: z.string(),
  orderNumber: z.string(),
  customerDisplayName: z.string().nullable(),
  recipientEmail: z.string().nullable(),
  sku: z.string(),
  trigger: z.string(),
  status: z.string(),
  statusReason: z.string().nullable(),
  originalCommitment: z.array(commitmentSchema),
  baselineCommitment: z.array(commitmentSchema),
  currentCommitment: z.array(commitmentSchema),
  acceptedCommitment: z.array(commitmentSchema).nullable(),
  cancelledCommitment: z.array(commitmentSchema).nullable(),
  freedCapacity: z.array(commitmentSchema).nullable(),
  updatedAt: z.string(),
  messages: z.array(messageSchema),
  timeline: z.array(timelineStepSchema),
})

const errorSchema = z.object({ error: z.string() })

function date(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function commitments(value: unknown): Array<{ quantity: number; date: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const row = entry as Record<string, unknown>
    return typeof row.date === 'string' && typeof row.quantity === 'number' ? [{ quantity: row.quantity, date: row.date }] : []
  })
}

function envelope(message: SupplyMessage): Record<string, unknown> | null {
  const payload = message.envelopePayload
  return payload && typeof payload === 'object' && Object.keys(payload).length ? payload : null
}

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId || !auth.sub) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: 'Invalid supply case id' }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }
  const supplyCase = await findOneWithDecryption(em, SupplyCase, { ...scope, id, deletedAt: null }, undefined, scope)
  if (!supplyCase) return Response.json({ error: 'Supply case not found' }, { status: 404 })
  const messages = await findWithDecryption(em, SupplyMessage, { ...scope, supplyCaseId: supplyCase.id, deletedAt: null }, { orderBy: { createdAt: 'asc' } }, scope)
  const response = {
    id: supplyCase.id,
    correlationId: supplyCase.correlationId,
    orderNumber: supplyCase.orderNumber,
    customerDisplayName: supplyCase.customerDisplayName ?? null,
    recipientEmail: supplyCase.recipientEmail ?? null,
    sku: supplyCase.sku,
    trigger: supplyCase.trigger,
    status: supplyCase.status,
    statusReason: supplyCase.statusReason ?? null,
    originalCommitment: commitments(supplyCase.originalCommitment),
    baselineCommitment: commitments(supplyCase.baselineCommitment),
    currentCommitment: commitments(supplyCase.currentCommitment),
    acceptedCommitment: supplyCase.acceptedCommitment ? commitments(supplyCase.acceptedCommitment) : null,
    cancelledCommitment: supplyCase.cancelledCommitment ? commitments(supplyCase.cancelledCommitment) : null,
    freedCapacity: supplyCase.freedCapacity ? commitments(supplyCase.freedCapacity) : null,
    updatedAt: supplyCase.updatedAt.toISOString(),
    messages: messages.map((message) => ({
      id: message.id,
      direction: message.direction,
      messageType: message.messageType ?? null,
      businessMessageId: message.businessMessageId,
      validationStatus: message.validationStatus ?? null,
      validationReason: message.validationReason ?? null,
      deliveryStatus: message.deliveryStatus,
      sender: message.senderEmail ?? null,
      recipient: message.recipientEmail ?? null,
      subject: message.subject,
      bodyExcerpt: message.bodyExcerpt ?? null,
      envelope: envelope(message),
      createdAt: message.createdAt.toISOString(),
      receivedAt: date(message.receivedAt),
      queuedAt: date(message.queuedAt),
      deliveredAt: date(message.deliveredAt),
      appliedAt: date(message.appliedAt),
      duplicateCount: message.duplicateCount,
      inReplyToBusinessId: message.inReplyToBusinessId ?? null,
    })),
    timeline: buildSupplyCaseTimeline(supplyCase, messages),
  }
  return Response.json(supplyCaseDetailResponseSchema.parse(response))
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Supplier Demo',
  summary: 'Supply case detail',
  methods: {
    GET: {
      summary: 'Get a supply case with its messages and roadmap timeline',
      responses: [{ status: 200, description: 'Supply case detail', schema: supplyCaseDetailResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid supply case id', schema: errorSchema },
        { status: 401, description: 'Authentication required', schema: errorSchema },
        { status: 403, description: 'View permission required', schema: errorSchema },
        { status: 404, description: 'Supply case not found in scope', schema: errorSchema },
      ],
    } satisfies OpenApiMethodDoc,
  },
}
