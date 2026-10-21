import type { EntityManager } from '@mikro-orm/postgresql'
import { E } from '#generated/entities.ids.generated'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  createProductionExecution,
  type ProductionExecutionCreationResultDto,
} from '../application/productionExecutionCreation'
import type { ProductionOperationResultDto } from '../application/productionOperations'
import { ProductionExecution } from '../data/entities'
import {
  createProductionExecutionSchema,
  recordExecutionOperationSchema,
  resumeExecutionOperationSchema,
  reverseExecutionDocumentSchema,
  type RecordExecutionOperationInput,
} from '../data/validators'
import type { ManufacturingScope } from '../domain/manufacturingScope'
import { buildProductionOperations } from '../lib/executionServices'
import { resolveManufacturingActor } from '../lib/manufacturingActor'
import { resolveManufacturingScope } from '../lib/manufacturingScope'
import { resolveInventoryPolicyReader } from '../ports/inventoryPolicyReader'
import { resolveProductionExecutionStore } from '../ports/productionExecutionStore'
import { resolveProductionOrderReader } from '../ports/productionOrderReader'

export const CREATE_PRODUCTION_EXECUTION_COMMAND_ID = 'manufacturing.executions.create'
export const RECORD_EXECUTION_OPERATION_COMMAND_ID = 'manufacturing.executions.record_operation'
export const REVERSE_EXECUTION_DOCUMENT_COMMAND_ID = 'manufacturing.executions.reverse_document'
export const RESUME_EXECUTION_OPERATION_COMMAND_ID = 'manufacturing.executions.resume_operation'
export const PRODUCTION_EXECUTION_RESOURCE_KIND = 'manufacturing.production_execution'
export const EXECUTION_DOCUMENT_RESOURCE_KIND = 'manufacturing.execution_document'

export type CreateProductionExecutionResult = {
  executionId: string
  executionNumber: string
}

export type ExecutionOperationResult = {
  status: 'accepted'
  operationId: string
  movementId: string | null
}

type Translate = Awaited<ReturnType<typeof resolveTranslations>>['translate']

async function resolveActor(ctx: CommandRuntimeContext, translate: Translate) {
  const scope = resolveManufacturingScope(ctx, translate('manufacturing.errors.scopeRequired', 'Select an organization.'))

  return resolveManufacturingActor(ctx, scope.organizationId)
}

function creationRejection(
  rejection: Extract<ProductionExecutionCreationResultDto, { status: 'rejected' }>,
  translate: Translate,
): CrudHttpError {
  const message = translate(`manufacturing.executions.errors.${rejection.code}`, rejection.message)

  return new CrudHttpError(422, {
    error: message,
    code: rejection.code,
    ...(rejection.field ? { fieldErrors: { [rejection.field]: message } } : {}),
  })
}

export function toExecutionOperationResult(
  result: ProductionOperationResultDto,
  operationId: string,
  translate: Translate,
): ExecutionOperationResult {
  switch (result.status) {
    case 'accepted':
      return { status: 'accepted', operationId, movementId: result.movementId }
    case 'rejected':
      throw new CrudHttpError(422, {
        error: translate(`manufacturing.executions.errors.${result.code}`, result.message),
        code: result.code,
      })
    case 'blocked':
      throw new CrudHttpError(409, {
        error: translate(
          'manufacturing.executions.errors.operation_blocked',
          'An earlier operation of this kind has an unknown result. Retry it before starting a new one.',
        ),
        code: 'operation_blocked',
        blockingOperationId: result.blockingOperationId,
      })
    case 'unknown':
      throw new CrudHttpError(503, {
        error: translate(
          'manufacturing.executions.errors.operation_outcome_unknown',
          'The inventory result is unknown. Retry the same operation to finish it safely.',
        ),
        code: 'operation_outcome_unknown',
        operationId,
      })
  }
}

async function emitExecutionCreated(ctx: CommandRuntimeContext, executionId: string, scope: ManufacturingScope): Promise<void> {
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const execution = await findOneWithDecryption(em, ProductionExecution, { ...scope, id: executionId }, undefined, scope)

  if (!execution) throw new Error(`[internal] production execution ${executionId} disappeared right after it was created`)

  await emitCrudSideEffects({
    dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
    action: 'created',
    entity: execution,
    identifiers: { id: execution.id, organizationId: execution.organizationId, tenantId: execution.tenantId },
    actorUserId: ctx.auth?.sub ?? null,
    indexer: { entityType: E.manufacturing.production_execution },
  })
}

async function recordOperation(input: RecordExecutionOperationInput, ctx: CommandRuntimeContext, translate: Translate) {
  const operations = buildProductionOperations(ctx, await resolveActor(ctx, translate))

  switch (input.action) {
    case 'issueMaterial':
      return operations.issueMaterial(input)
    case 'returnMaterial':
      return operations.returnMaterial(input)
    case 'confirmProduction':
      return operations.confirmProduction(input)
  }
}

export const createProductionExecutionCommand: CommandHandler<unknown, CreateProductionExecutionResult> = {
  id: CREATE_PRODUCTION_EXECUTION_COMMAND_ID,

  async execute(rawInput, ctx) {
    const { translate } = await resolveTranslations()
    const input = createProductionExecutionSchema.parse(rawInput)
    const actor = await resolveActor(ctx, translate)
    const result = await createProductionExecution(
      {
        productionOrderReader: resolveProductionOrderReader(ctx.container),
        inventoryPolicyReader: resolveInventoryPolicyReader(ctx.container),
        productionExecutionStore: resolveProductionExecutionStore(ctx.container),
        scope: actor.scope,
        userId: actor.userId,
      },
      input,
    )

    if (result.status === 'rejected') throw creationRejection(result, translate)

    await emitExecutionCreated(ctx, result.executionId, actor.scope)

    return { executionId: result.executionId, executionNumber: result.executionNumber }
  },

  async buildLog({ result, ctx }) {
    const { translate } = await resolveTranslations()

    return {
      actionLabel: translate('manufacturing.audit.executions.create', 'Create production execution'),
      resourceKind: PRODUCTION_EXECUTION_RESOURCE_KIND,
      resourceId: result.executionId,
      tenantId: ctx.auth?.tenantId ?? null,
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

export const recordExecutionOperationCommand: CommandHandler<unknown, ExecutionOperationResult> = {
  id: RECORD_EXECUTION_OPERATION_COMMAND_ID,

  async execute(rawInput, ctx) {
    const { translate } = await resolveTranslations()
    const input = recordExecutionOperationSchema.parse(rawInput)
    const result = await recordOperation(input, ctx, translate)

    return toExecutionOperationResult(result, input.operationId, translate)
  },

  async buildLog({ input, ctx }) {
    const { translate } = await resolveTranslations()
    const parsed = recordExecutionOperationSchema.parse(input)

    return {
      actionLabel: translate(`manufacturing.audit.executions.${parsed.action}`, parsed.action),
      resourceKind: PRODUCTION_EXECUTION_RESOURCE_KIND,
      resourceId: parsed.executionId,
      tenantId: ctx.auth?.tenantId ?? null,
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      payload: { operationId: parsed.operationId },
    }
  },
}

export const reverseExecutionDocumentCommand: CommandHandler<unknown, ExecutionOperationResult> = {
  id: REVERSE_EXECUTION_DOCUMENT_COMMAND_ID,

  async execute(rawInput, ctx) {
    const { translate } = await resolveTranslations()
    const input = reverseExecutionDocumentSchema.parse(rawInput)
    const operations = buildProductionOperations(ctx, await resolveActor(ctx, translate))
    const result = await operations.reverseDocument(input)

    return toExecutionOperationResult(result, input.operationId, translate)
  },

  async buildLog({ input, ctx }) {
    const { translate } = await resolveTranslations()
    const parsed = reverseExecutionDocumentSchema.parse(input)

    return {
      actionLabel: translate('manufacturing.audit.executions.reverseDocument', 'Reverse execution document'),
      resourceKind: EXECUTION_DOCUMENT_RESOURCE_KIND,
      resourceId: parsed.documentId,
      tenantId: ctx.auth?.tenantId ?? null,
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      payload: { operationId: parsed.operationId },
    }
  },
}

export const resumeExecutionOperationCommand: CommandHandler<unknown, ExecutionOperationResult> = {
  id: RESUME_EXECUTION_OPERATION_COMMAND_ID,

  async execute(rawInput, ctx) {
    const { translate } = await resolveTranslations()
    const input = resumeExecutionOperationSchema.parse(rawInput)
    const operations = buildProductionOperations(ctx, await resolveActor(ctx, translate))
    const result = await operations.resumeOperation(input.operationId)

    return toExecutionOperationResult(result, input.operationId, translate)
  },

  async buildLog({ input, ctx }) {
    const { translate } = await resolveTranslations()
    const parsed = resumeExecutionOperationSchema.parse(input)

    return {
      actionLabel: translate('manufacturing.audit.executions.resumeOperation', 'Retry execution operation'),
      resourceKind: PRODUCTION_EXECUTION_RESOURCE_KIND,
      resourceId: parsed.operationId,
      tenantId: ctx.auth?.tenantId ?? null,
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

registerCommand(createProductionExecutionCommand)
registerCommand(resumeExecutionOperationCommand)
registerCommand(recordExecutionOperationCommand)
registerCommand(reverseExecutionDocumentCommand)
