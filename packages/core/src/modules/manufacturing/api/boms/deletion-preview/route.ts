import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { bomDeletionPreviewQuerySchema } from '../../../data/validators'
import { loadBomDeletionPreview } from '../../../lib/bomDeletionQueries'
import { resolveBomActionContext } from '../../../lib/bomActionRoute'

export const metadata = { GET: { requireAuth: true, requireFeatures: ['manufacturing.manage'] } }

export async function GET(req: Request): Promise<Response> {
  try {
    const { translate } = await resolveTranslations()
    const { container, scope, userId } = await resolveBomActionContext(req, translate)
    const query = Object.fromEntries(new URL(req.url).searchParams.entries())
    const parsed = bomDeletionPreviewQuerySchema.safeParse(query)
    if (!parsed.success) return NextResponse.json({ error: translate('manufacturing.errors.invalidDeletePayload') }, { status: 400 })
    const em = container.resolve<EntityManager>('em').fork()
    try {
      return NextResponse.json(await loadBomDeletionPreview(em, container, userId, scope, parsed.data.id))
    } catch (error) {
      if (error instanceof Error && error.message === '[internal] manufacturing.bom.unavailable') return NextResponse.json({ error: translate('manufacturing.errors.bomUnavailable') }, { status: 404 })
      throw error
    }
  } catch (error) {
    getTelemetryRuntime()?.reportError(error, { module: 'manufacturing', code: 'manufacturing.bom_deletion_preview_failed' })
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    const { translate } = await resolveTranslations()
    return NextResponse.json({ error: translate('manufacturing.boms.delete.failed') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Manufacturing', summary: 'Preview BOM deletion',
  methods: { GET: { summary: 'Check whether a BOM revision or family can be deleted', query: bomDeletionPreviewQuerySchema, responses: [{ status: 200, description: 'Deletion preview', schema: z.object({ revisionVersion: z.string(), bomVersion: z.string() }).passthrough() }, { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) }, { status: 404, description: 'BOM unavailable', schema: z.object({ error: z.string() }) }] } },
}
