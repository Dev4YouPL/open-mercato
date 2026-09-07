import { test } from '@playwright/test'
import { runCrudFormRoundTrip } from '@open-mercato/core/helpers/integration/crudFormPersistence'
import {
  WORK_CENTERS_PATH,
  adminToken,
  cleanupResource,
  createResourceFixture,
  readWorkCenter,
  uniqueCode,
} from './helpers'

/**
 * TC-MFG-CRUDFORM-WC-001: every field the Work Centre form edits survives a
 * create → read-back → edit → read-back cycle, including clearing the
 * description to null and toggling activity in both directions.
 *
 * Custom fields are N/A: the Work Centre form does not host them.
 */
test.describe('TC-MFG-CRUDFORM-WC-001: form field persistence', () => {
  test('persists every scalar field, including a cleared description', async ({ request }) => {
    const token = await adminToken(request)
    const createCode = uniqueCode('WC-CF1')
    const updateCode = uniqueCode('WC-CF1B')

    await runCrudFormRoundTrip({
      request,
      token,
      collectionPath: WORK_CENTERS_PATH,
      create: {
        payload: { code: createCode, name: 'Form cell', description: 'Initial notes', isActive: true },
        expectedStatus: 201,
      },
      update: {
        payload: (id) => ({ id, code: updateCode, name: 'Form cell edited', description: null, isActive: false }),
      },
      expectAfterCreate: {
        scalars: { code: createCode, name: 'Form cell', description: 'Initial notes', isActive: true },
      },
      expectAfterUpdate: {
        scalars: { code: updateCode, name: 'Form cell edited', description: null, isActive: false },
      },
      readById: (id) => readWorkCenter(request, token, id) as Promise<Record<string, unknown> | null>,
    })
  })

  test('re-activates a deactivated Work Centre', async ({ request }) => {
    const token = await adminToken(request)
    const code = uniqueCode('WC-CF2')

    await runCrudFormRoundTrip({
      request,
      token,
      collectionPath: WORK_CENTERS_PATH,
      create: { payload: { code, name: 'Toggles', isActive: false }, expectedStatus: 201 },
      update: { payload: (id) => ({ id, isActive: true }) },
      expectAfterCreate: { scalars: { isActive: false } },
      expectAfterUpdate: { scalars: { isActive: true } },
      readById: (id) => readWorkCenter(request, token, id) as Promise<Record<string, unknown> | null>,
    })
  })

  test('persists membership added and then cleared through the form payload', async ({ request }) => {
    const token = await adminToken(request)
    const resource = await createResourceFixture(request, token, `QA WC crudform ${Date.now()}`)
    test.skip(resource === null, 'resources module unavailable in this profile')

    try {
      await runCrudFormRoundTrip({
        request,
        token,
        collectionPath: WORK_CENTERS_PATH,
        create: {
          payload: { code: uniqueCode('WC-CF3'), name: 'With member', resourceIds: [resource!.id] },
          expectedStatus: 201,
        },
        // Clearing to an empty set is a real membership change, not an omission.
        update: { payload: (id) => ({ id, resourceIds: [] }) },
        expectAfterCreate: { scalars: { resourceIds: [resource!.id], resourceCount: 1 } },
        expectAfterUpdate: { scalars: { resourceIds: [], resourceCount: 0 } },
        readById: (id) => readWorkCenter(request, token, id) as Promise<Record<string, unknown> | null>,
      })
    } finally {
      await cleanupResource(request, token, resource?.id ?? null)
    }
  })
})
