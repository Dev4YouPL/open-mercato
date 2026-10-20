import { NextResponse } from 'next/server'
import { z } from 'zod'

import type {
  CommandBus,
} from '@open-mercato/shared/lib/commands'
import {
  getCommandInterceptorHttpRejection,
} from '@open-mercato/shared/lib/commands/errors'
import {
  CrudHttpError,
  isCrudHttpError,
} from '@open-mercato/shared/lib/crud/errors'
import {
  runRouteMutationGuards,
} from '@open-mercato/shared/lib/crud/route-mutation-guard'
import {
  readJsonSafe,
} from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  resolveTranslations,
} from '@open-mercato/shared/lib/i18n/server'
import type {
  OpenApiRouteDoc,
} from '@open-mercato/shared/lib/openapi'
import {
  getTelemetryRuntime,
} from '@open-mercato/shared/lib/telemetry/runtime'

import {
  bomReleaseSchema,
} from '../../../data/validators'
import type {
  BomReleaseInput,
} from '../../../data/validators'
import { attachOperationHeader, resolveBomActionContext } from '../../../lib/bomActionRoute'

const uuidSchema = z.string().uuid()

const commandResultSchema = z.object({
  bomId: uuidSchema,
  isIncomplete: z.boolean(),
})

type BomReleaseResult = z.infer<typeof commandResultSchema>

const responseSchema = z.object({
  id: uuidSchema,
  status: z.literal('released'),
  isIncomplete: z.boolean(),
})

const errorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
}).passthrough()

const trackingViolationSchema = z.object({
  variantId: uuidSchema,
  role: z.enum(['output', 'component']),
  name: z.string().nullable(),
  sku: z.string().nullable(),
  requirements: z.array(
    z.enum(['lot', 'serial', 'expiration']),
  ),
})

const releaseBlockedSchema = errorSchema.extend({
  violations: z.array(trackingViolationSchema).optional(),
  variantIds: z.array(uuidSchema).optional(),
})

export const metadata = {
  POST: {
    requireAuth: true,
    requireFeatures: ['manufacturing.manage'],
  },
}

export async function POST(req: Request): Promise<Response> {
  try {
    const { translate } = await resolveTranslations()

    const { container, ctx, scope, userId } = await resolveBomActionContext(req, translate)

    const parsed = bomReleaseSchema.safeParse(
      await readJsonSafe<unknown>(req),
    )

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: translate(
            'manufacturing.errors.invalidReleasePayload',
          ),
        },
        { status: 400 },
      )
    }

    const guard = await runRouteMutationGuards({
      container,
      req,
      auth: {
        userId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      input: {
        resourceKind: 'manufacturing.bom',
        resourceId: parsed.data.id,
        operation: 'custom',
        mutationPayload: parsed.data,
      },
    })

    if (!guard.ok) {
      return guard.response
    }

    const guardedInput = bomReleaseSchema.safeParse(
      guard.modifiedPayload ?? parsed.data,
    )

    if (
      !guardedInput.success ||
      guardedInput.data.id.toLowerCase() !==
        parsed.data.id.toLowerCase()
    ) {
      return NextResponse.json(
        {
          error: translate(
            'manufacturing.errors.invalidReleasePayload',
          ),
        },
        { status: 400 },
      )
    }

    const commandBus =
      container.resolve<CommandBus>('commandBus')

    const { result, logEntry } = await commandBus.execute<
      BomReleaseInput,
      BomReleaseResult
    >(
      'manufacturing.boms.release',
      {
        input: guardedInput.data,
        ctx,
      },
    )

    const released = commandResultSchema.parse(result)

    await guard.runAfterSuccess()

    const response = NextResponse.json(
      responseSchema.parse({
        id: released.bomId,
        status: 'released',
        isIncomplete: released.isIncomplete,
      }),
      { status: 200 },
    )

    attachOperationHeader(response, logEntry)

    return response
  } catch (error) {
    getTelemetryRuntime()?.reportError(error, {
      module: 'manufacturing',
      code: 'manufacturing.bom_release_request_failed',
    })

    if (isCrudHttpError(error)) {
      return NextResponse.json(
        error.body,
        { status: error.status },
      )
    }

    const interceptorRejection =
      getCommandInterceptorHttpRejection(error)

    if (interceptorRejection) {
      return NextResponse.json(
        interceptorRejection.body,
        { status: interceptorRejection.status },
      )
    }

    const { translate } = await resolveTranslations()

    return NextResponse.json(
      {
        error: translate(
          'manufacturing.errors.bomReleaseFailed',
        ),
      },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Manufacturing',
  summary: 'Release a BOM revision',
  methods: {
    POST: {
      summary: 'Release a draft BOM',
      description:
        'Releases a draft revision after verifying item versions, catalog variants and WMS tracking requirements. Empty BOMs are released as incomplete.',
      requestBody: {
        contentType: 'application/json',
        schema: bomReleaseSchema,
      },
      responses: [
        {
          status: 200,
          description: 'BOM revision released',
          schema: responseSchema,
        },
        {
          status: 400,
          description: 'Invalid payload or missing organization context',
          schema: errorSchema,
        },
        {
          status: 401,
          description: 'Unauthorized',
          schema: errorSchema,
        },
        {
          status: 403,
          description: 'Forbidden',
          schema: errorSchema,
        },
        {
          status: 404,
          description: 'BOM unavailable in the current scope',
          schema: errorSchema,
        },
        {
          status: 409,
          description: 'Revision already released or a version conflict',
          schema: errorSchema,
        },
        {
          status: 422,
          description: 'Unavailable variants, tracking requirements or a mutation guard rejection',
          schema: releaseBlockedSchema,
        },
        {
          status: 423,
          description: 'Record locked',
          schema: errorSchema,
        },
        {
          status: 500,
          description: 'Unexpected release failure',
          schema: errorSchema,
        },
      ],
    },
  },
}
