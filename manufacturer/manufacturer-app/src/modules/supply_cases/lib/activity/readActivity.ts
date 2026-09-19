import { z } from 'zod'
import type { StoreScope, SupplyCasesStore } from '../../data/repositories'
import {
  decodeActivityCursor,
  encodeActivityCursor,
  isActivityBeforeCursor,
  type ActivityCursor,
  type SupplyActivityEntry,
} from '../../data/activity'

export type ActivityReadOptions = {
  caseId?: string
  cursor?: string
  limit: number
  canViewMessages: boolean
  canViewTrace: boolean
  now?: string
}

export type ActivityEvidence = {
  type: 'inbound_message' | 'case' | 'workflow'
  href: string
}

export type ActivityTechnicalDetail = {
  type: 'workflow_instance' | 'agent_run'
  href: string
}

export type ActivityItem = {
  id: string
  caseId: string | null
  caseCorrelationId: string | null
  kind: SupplyActivityEntry['kind']
  status: SupplyActivityEntry['status']
  actorType: SupplyActivityEntry['actorType']
  titleKey: string
  detailKey: string | null
  params: SupplyActivityEntry['params']
  occurredAt: string
  recordedAt: string
  groupKey: string | null
  isStale: boolean
  evidence: ActivityEvidence | null
  technicalDetail: ActivityTechnicalDetail | null
}

export type ActivityPage = {
  items: ActivityItem[]
  nextCursor: string | null
  asOf: string
}

export async function readActivityPage(
  store: SupplyCasesStore,
  scope: StoreScope,
  options: ActivityReadOptions,
): Promise<ActivityPage | null> {
  const safeLimit = z.number().int().min(1).max(100).parse(options.limit)
  const safeCaseId = options.caseId ? queryIdentifierSchema.parse(options.caseId) : undefined
  const cursor = options.cursor ? decodeActivityCursor(queryCursorSchema.parse(options.cursor)) : null
  const all = await store.activities.list(scope)
  let candidates = all

  if (safeCaseId) {
    const supplyCase = await store.supplyCases.findById(scope, safeCaseId)
    if (!supplyCase) return null
    const messages = await store.inboundMessages.list(scope, { where: { caseId: safeCaseId } })
    const messageIds = new Set(messages.map((message) => message.id))
    candidates = candidates.filter((entry) => entry.caseId === safeCaseId || (entry.evidenceType === 'inbound_message' && entry.evidenceId !== null && messageIds.has(entry.evidenceId)))
  }

  const now = options.now ?? new Date().toISOString()
  const staleEntries = findStaleEntries(candidates, now)
  const pageEntries = cursor ? candidates.filter((entry) => isActivityBeforeCursor(entry, cursor)) : candidates
  const page = pageEntries.slice(0, safeLimit + 1)
  const hasMore = page.length > safeLimit
  const items = page.slice(0, safeLimit).map((entry) => projectItem(entry, staleEntries.has(entry.id), { ...options, caseId: safeCaseId, limit: safeLimit }))
  const last = page[safeLimit - 1]

  return {
    items,
    nextCursor: hasMore && last ? encodeActivityCursor({ occurredAt: last.occurredAt, id: last.id }) : null,
    asOf: now,
  }
}

function projectItem(entry: SupplyActivityEntry, isStale: boolean, options: ActivityReadOptions): ActivityItem {
  const evidenceCaseId = entry.caseId ?? options.caseId
  const evidence = options.canViewMessages && entry.evidenceType === 'inbound_message' && entry.evidenceId
      ? { type: entry.evidenceType, href: evidenceCaseId ? `/backend/supply-cases/${encodeURIComponent(evidenceCaseId)}#message-${encodeURIComponent(entry.evidenceId)}` : '' }
    : entry.evidenceType !== 'inbound_message' && entry.evidenceId && entry.caseId
      ? { type: entry.evidenceType as 'case' | 'workflow', href: `/backend/supply-cases/${encodeURIComponent(entry.caseId)}` }
      : null

  return {
    id: entry.id,
    caseId: entry.caseId,
    caseCorrelationId: entry.caseCorrelationId,
    kind: entry.kind,
    status: entry.status,
    actorType: entry.actorType,
    titleKey: entry.titleKey,
    detailKey: entry.detailKey,
    params: entry.params,
    occurredAt: entry.occurredAt,
    recordedAt: entry.recordedAt,
    groupKey: entry.groupKey,
    isStale,
    evidence: evidence && evidence.href ? evidence : null,
    technicalDetail: options.canViewTrace && entry.technicalRefType && entry.technicalRefId
      ? { type: entry.technicalRefType, href: entry.technicalRefType === 'workflow_instance' ? `/backend/processes/${encodeURIComponent(entry.technicalRefId)}` : `/backend/traces/${encodeURIComponent(entry.technicalRefId)}` }
      : null,
  }
}

function findStaleEntries(entries: SupplyActivityEntry[], now: string): Set<string> {
  const terminalGroups = new Set(entries.filter((entry) => isTerminal(entry.kind)).map((entry) => entry.groupKey).filter((key): key is string => key !== null))
  const stale = new Set<string>()
  const nowMs = Date.parse(now)
  for (const entry of entries) {
    if (!['analysis_started', 'retry_started'].includes(entry.kind) || !entry.groupKey || terminalGroups.has(entry.groupKey)) continue
    const threshold = isImpactAnalysis(entry) ? 5 * 60_000 : 2 * 60_000
    if (nowMs - Date.parse(entry.occurredAt) >= threshold) stale.add(entry.id)
  }
  return stale
}

function isTerminal(kind: SupplyActivityEntry['kind']): boolean {
  return ['analysis_completed', 'sender_classified', 'operation_failed'].includes(kind)
}

function isImpactAnalysis(entry: SupplyActivityEntry): boolean {
  return 'agentKey' in entry.params && entry.params.agentKey === 'initialImpact'
}

export function parseActivityQuery(searchParams: URLSearchParams): { caseId?: string; cursor?: string; limit: number } {
  const rawLimit = searchParams.get('limit')
  const rawCaseId = searchParams.get('caseId')
  const rawCursor = searchParams.get('cursor')
  const caseId = rawCaseId === null ? undefined : queryIdentifierSchema.safeParse(rawCaseId.trim()).success ? rawCaseId.trim() : invalidQuery('caseId')
  const cursor = rawCursor === null ? undefined : queryCursorSchema.safeParse(rawCursor.trim()).success ? rawCursor.trim() : invalidQuery('cursor')
  const limit = rawLimit === null ? (caseId ? 50 : 20) : Number(rawLimit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('[internal] invalid_limit')
  if (cursor) {
    try {
      decodeActivityCursor(cursor)
    } catch {
      throw new Error('[internal] invalid_cursor')
    }
  }
  return { caseId, cursor, limit }
}

const queryIdentifierSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9:_-]+$/)
const queryCursorSchema = z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/)

function invalidQuery(field: 'caseId' | 'cursor'): never {
  throw new Error(`[internal] invalid_${field}`)
}
