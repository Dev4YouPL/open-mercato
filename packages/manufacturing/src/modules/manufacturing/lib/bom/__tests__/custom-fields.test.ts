import { restoreBomCustomFields } from '../custom-fields'
import { loadCustomFieldSnapshot } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'

jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/customFieldSnapshots'),
  loadCustomFieldSnapshot: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({ setCustomFieldsIfAny: jest.fn() }))

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const ctx = { container: { resolve: () => ({ fork: () => ({}) }) } } as never

beforeEach(() => jest.clearAllMocks())

it('rejects a later change to a field being undone', async () => {
  jest.mocked(loadCustomFieldSnapshot).mockResolvedValue({ note: 'third author' })
  await expect(restoreBomCustomFields(ctx, scope, 'bom-1', { note: 'first' }, { note: 'second' })).rejects.toMatchObject({ code: 'bom.version_conflict' })
  expect(setCustomFieldsIfAny).not.toHaveBeenCalled()
})

it('preserves newer values of fields the action did not change', async () => {
  jest.mocked(loadCustomFieldSnapshot).mockResolvedValue({ note: 'second', owner: 'third author' })
  await restoreBomCustomFields(ctx, scope, 'bom-1', { note: 'first', owner: 'original' }, { note: 'second', owner: 'original' })
  expect(setCustomFieldsIfAny).toHaveBeenCalledWith(expect.objectContaining({ values: { note: 'first' } }))
})

it('compares nested custom field values structurally', async () => {
  jest.mocked(loadCustomFieldSnapshot).mockResolvedValue({ options: ['a', 'b'] })
  await restoreBomCustomFields(ctx, scope, 'bom-1', {}, { options: ['a', 'b'] })
  expect(setCustomFieldsIfAny).toHaveBeenCalledWith(expect.objectContaining({ values: { options: [] } }))
})
