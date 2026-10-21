import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { ManufacturingScope } from '../domain/manufacturingScope'
import { resolveManufacturingScope } from './manufacturingScope'

export async function resolveManufacturingApiScope(ctx: CommandRuntimeContext): Promise<ManufacturingScope> {
  const { translate } = await resolveTranslations()

  return resolveManufacturingScope(ctx, translate('manufacturing.errors.scopeRequired', 'Select an organization.'))
}
