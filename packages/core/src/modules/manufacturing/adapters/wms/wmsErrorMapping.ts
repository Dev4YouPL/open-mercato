import { ZodError } from 'zod'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import type { InventoryMovementResultDto } from '../../ports/inventoryGateway'

type HttpRejection = {
  status: number
  body: Record<string, unknown>
}

function readHttpRejection(error: unknown): HttpRejection | null {
  if (isCrudHttpError(error)) return { status: error.status, body: error.body }

  return getCommandInterceptorHttpRejection(error)
}

export function mapWmsError(error: unknown): InventoryMovementResultDto {
  if (error instanceof ZodError) return { status: 'rejected', code: 'invalid_input', message: error.message }

  const rejection = readHttpRejection(error)

  if (rejection && rejection.status < 500) {
    const code = typeof rejection.body.error === 'string' ? rejection.body.error : `http_${rejection.status}`

    return { status: 'rejected', code, message: error instanceof Error ? error.message : code }
  }
  
  return { status: 'unknown', cause: error }
}
