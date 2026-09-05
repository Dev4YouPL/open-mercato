import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import { parseBooleanFlag } from '@open-mercato/shared/lib/boolean'
import { ManufacturingWorkCenter } from '../../data/entities'
import {
  createWorkCenterSchema,
  deleteWorkCenterSchema,
  listWorkCentersQuerySchema,
  updateWorkCenterSchema,
} from '../../data/validators'
import { WORK_CENTER_ENTITY_ID } from '../../lib/work-centers/entity-ids'
import { loadMembershipByWorkCenter } from '../../lib/work-centers/repository'
import {
  createWorkCenterOpenApi,
  defaultOkResponseSchema,
  workCenterCreateResponseSchema,
  workCenterListResponseSchema,
  workCenterResponseSchema,
} from './openapi'

const F = {
  id: 'id',
  tenant_id: 'tenant_id',
  organization_id: 'organization_id',
  code: 'code',
  name: 'name',
  description: 'description',
  is_active: 'is_active',
  created_at: 'created_at',
  updated_at: 'updated_at',
} as const

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['manufacturing.work_center.view'] },
  POST: { requireAuth: true, requireFeatures: ['manufacturing.work_center.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['manufacturing.work_center.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['manufacturing.work_center.manage'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const MAX_SEARCH_LENGTH = 200

function sanitizeSearchTerm(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().slice(0, MAX_SEARCH_LENGTH)
  return trimmed.length > 0 ? trimmed : null
}

function parseIdList(value: unknown): string[] | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null
  const ids = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  return ids.length > 0 ? ids : null
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: ManufacturingWorkCenter,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: WORK_CENTER_ENTITY_ID, cacheAliases: [] },
  list: {
    schema: listWorkCentersQuerySchema,
    entityId: WORK_CENTER_ENTITY_ID,
    fields: [
      F.id,
      F.tenant_id,
      F.organization_id,
      F.code,
      F.name,
      F.description,
      F.is_active,
      F.created_at,
      F.updated_at,
    ],
    // Open map rather than a closed zod enum, so an unknown `sortField` degrades
    // to the default instead of failing the whole request. `resourceCount` is a
    // non-sortable accessor until an aggregate sort is designed.
    sortFieldMap: {
      code: F.code,
      name: F.name,
      createdAt: F.created_at,
      isActive: F.is_active,
      updatedAt: F.updated_at,
    },
    // Primary keys are random UUIDs, so a stable page boundary needs an explicit
    // tiebreaker on every sort, not only the default one.
    defaultSort: { field: F.code, dir: 'asc' },
    tiebreakSortField: F.id,
    // The response is enriched per request by `afterList`; a cached list body
    // could serve a stale membership set after a membership-only change.
    disableListCache: true,
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      const ids = parseIdList(query.ids)
      if (ids) filters[F.id] = { $in: ids }
      const term = sanitizeSearchTerm(query.search)
      if (term) {
        const like = buildIlikeTerm(term)
        filters.$or = [{ [F.code]: { $ilike: like } }, { [F.name]: { $ilike: like } }]
      }
      // `parseBooleanFlag` yields undefined for an absent/unparseable value;
      // `parseBooleanToken` returns null, which would filter `is_active IS NULL`
      // on every unfiltered request and hide every row.
      const isActive = parseBooleanFlag(query.isActive)
      if (isActive !== undefined) filters[F.is_active] = isActive
      return filters
    },
    // Synchronous scalar mapping only. Membership is added by `afterList`,
    // which is the seam that can batch a query for the whole page.
    transformItem: (item: Record<string, unknown>) => ({
      id: item.id,
      code: item.code,
      name: item.name,
      description: item.description ?? null,
      isActive: item.is_active ?? false,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }),
  },
  hooks: {
    /**
     * Adds `resourceIds`/`resourceCount` to list and `ids` detail reads alike,
     * in exactly one scoped membership query per non-empty page and none at all
     * for an empty one. Runs before factory serialization, so pagination, scope
     * and empty-result behavior are untouched.
     */
    afterList: async (payload, ctx) => {
      const items: Array<Record<string, unknown>> = Array.isArray(payload?.items)
        ? (payload.items as Array<Record<string, unknown>>)
        : []
      if (items.length === 0) return
      const workCenterIds = items
        .map((item) => (typeof item.id === 'string' ? item.id : null))
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
      if (workCenterIds.length === 0) return

      const tenantId = ctx.organizationScope?.tenantId ?? ctx.auth?.tenantId ?? null
      if (!tenantId) return
      // Follow the parent query's organization narrowing instead of a single
      // selected id: in all-organizations mode `selectedId`/`orgId` are null and
      // the page may span organizations, so pinning one would report every row
      // as unassigned.
      const selectedOrganizationId = ctx.selectedOrganizationId ?? ctx.organizationScope?.selectedId ?? ctx.auth?.orgId ?? null
      const organizationIds = ctx.organizationIds
        ?? ctx.organizationScope?.filterIds
        ?? (selectedOrganizationId ? [selectedOrganizationId] : null)

      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const membership = await loadMembershipByWorkCenter(em, { tenantId, organizationIds }, workCenterIds)
      for (const item of items) {
        const id = typeof item.id === 'string' ? item.id : null
        const resourceIds = id ? (membership.get(id) ?? []) : []
        item.resourceIds = resourceIds
        item.resourceCount = resourceIds.length
      }
    },
  },
  actions: {
    create: {
      commandId: 'manufacturing.work_center.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(createWorkCenterSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.workCenter?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'manufacturing.work_center.update',
      schema: rawBodySchema,
      // The root `id` is preserved so the factory's own row-level guard and
      // optimistic-lock preflight still run; the BOM child-aggregate `{ body }`
      // wrapper would opt out of them.
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(updateWorkCenterSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'manufacturing.work_center.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
        return deleteWorkCenterSchema.parse({ id })
      },
      response: () => ({ ok: true }),
    },
  },
})

// Exported directly: the factory owns the GET lifecycle, and wrapping its
// Response would bypass interceptors, caching decisions and the afterList seam.
export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

export const openApi = createWorkCenterOpenApi({
  resourceName: 'Work Centre',
  pluralName: 'Work Centres',
  querySchema: listWorkCentersQuerySchema,
  listResponseSchema: workCenterListResponseSchema,
  create: {
    schema: createWorkCenterSchema,
    responseSchema: workCenterCreateResponseSchema,
    description:
      'Creates a Work Centre in the authenticated tenant/organization. Omitted and empty `resourceIds` are the same unassigned request and resolve no optional provider.',
  },
  update: {
    schema: updateWorkCenterSchema,
    responseSchema: defaultOkResponseSchema,
    description:
      'Updates a Work Centre by id. Omitting `resourceIds` preserves membership; any changed set requires the resources provider and `resources.view`.',
  },
  del: {
    schema: deleteWorkCenterSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a Work Centre by id and marks it inactive. Membership rows are retained.',
  },
})

export { workCenterResponseSchema }
