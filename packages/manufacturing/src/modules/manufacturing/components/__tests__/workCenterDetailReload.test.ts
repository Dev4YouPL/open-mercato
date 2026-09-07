import fs from 'node:fs'
import path from 'node:path'

const componentsDir = path.join(__dirname, '..')
const detailSource = fs.readFileSync(path.join(componentsDir, 'WorkCenterDetailClient.tsx'), 'utf8')
const formSource = fs.readFileSync(path.join(componentsDir, 'WorkCenterFormClient.tsx'), 'utf8')

/**
 * Regression: the form submits the optimistic-lock token from `initial`, and the
 * detail record is fetched by a client effect. `router.refresh()` re-renders
 * server components without re-running that effect, so a second save resubmitted
 * the pre-save version and conflicted with the user's own first save.
 */
describe('Work Centre detail reload after save', () => {
  it('re-reads the record after a successful edit instead of refreshing the route', () => {
    expect(formSource).toContain('onSaved?.()')
    expect(formSource).not.toContain('router.refresh()')
  })

  it('keys the detail fetch on a reload token so the effect actually re-runs', () => {
    expect(detailSource).toContain('reloadToken')
    expect(detailSource).toContain('}, [reloadToken, workCenterId])')
  })

  it('passes the reload callback down to the form', () => {
    expect(detailSource).toContain('onSaved={() => setReloadToken((token) => token + 1)}')
  })
})

describe('Work Centre membership availability states', () => {
  it('distinguishes an absent provider from a missing permission', () => {
    // A wildcard grant satisfies `resources.view` even when the module is not
    // deployed, so the module itself is probed rather than inferred.
    expect(formSource).toContain('probeResourcesProvider')
    expect(formSource).toContain('"provider"')
    expect(formSource).toContain('"forbidden"')
  })
})
