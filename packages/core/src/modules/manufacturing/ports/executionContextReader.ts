import type { AwilixContainer } from 'awilix'
import type { ExecutionContext } from '../domain/executionContext'
import type { ManufacturingScope } from '../domain/manufacturingScope'

export const EXECUTION_CONTEXT_READER_DI_KEY = 'manufacturingExecutionContextReader'

export interface ExecutionContextReader {
  getContext(executionId: string, scope: ManufacturingScope): Promise<ExecutionContext | null>
}

export function resolveExecutionContextReader(container: AwilixContainer): ExecutionContextReader {
  return container.resolve<ExecutionContextReader>(EXECUTION_CONTEXT_READER_DI_KEY)
}
