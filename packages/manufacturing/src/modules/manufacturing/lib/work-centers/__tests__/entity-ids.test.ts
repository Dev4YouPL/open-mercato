import fs from 'node:fs'
import path from 'node:path'
import { toSnake } from '../../../../../../../cli/src/lib/utils'
import { WORK_CENTER_ENTITY_ID, WORK_CENTER_RESOURCE_ENTITY_ID } from '../entity-ids'
import { translatableFields } from '../../../translations'

const MODULE_ID = 'manufacturing'
const ENTITIES_FILE = path.join(__dirname, '..', '..', '..', 'data', 'entities.ts')

/**
 * Reproduces the generator's own derivation
 * (`packages/cli/src/lib/generators/entity-ids.ts`: exported class names →
 * `toSnake` → `<moduleId>:<name>`) against the real entities file, using the
 * generator's own `toSnake`.
 *
 * The app registry cannot be used as the oracle here: manufacturing is
 * deliberately absent from `enabledModules`, so `yarn generate` never emits its
 * ids in this repository. Deriving them the way the generator does proves the
 * same parity without activating the module.
 */
function deriveGeneratedEntityIds(): string[] {
  const source = fs.readFileSync(ENTITIES_FILE, 'utf8')
  const classNames = Array.from(source.matchAll(/^export class (\w+)/gm)).map((match) => match[1])
  const unique = classNames.map((name) => toSnake(name)).filter((name, index, all) => all.indexOf(name) === index)
  return unique.map((name) => `${MODULE_ID}:${name}`)
}

describe('Work Centre entity id parity', () => {
  const generated = deriveGeneratedEntityIds()

  it('matches the generated id for the Work Centre parent', () => {
    expect(generated).toContain(WORK_CENTER_ENTITY_ID)
    expect(WORK_CENTER_ENTITY_ID).toBe('manufacturing:manufacturing_work_center')
  })

  it('matches the generated id for the membership entity', () => {
    expect(generated).toContain(WORK_CENTER_RESOURCE_ENTITY_ID)
    expect(WORK_CENTER_RESOURCE_ENTITY_ID).toBe('manufacturing:manufacturing_work_center_resource')
  })

  it('keeps the two ids distinct', () => {
    expect(WORK_CENTER_ENTITY_ID).not.toBe(WORK_CENTER_RESOURCE_ENTITY_ID)
  })
})

describe('Work Centre translation registration', () => {
  it('registers exactly name and description under the canonical entity id', () => {
    expect(translatableFields[WORK_CENTER_ENTITY_ID]).toEqual(['name', 'description'])
  })

  it('does not register the membership entity or the operator-facing code', () => {
    expect(translatableFields[WORK_CENTER_RESOURCE_ENTITY_ID]).toBeUndefined()
    expect(translatableFields[WORK_CENTER_ENTITY_ID]).not.toContain('code')
  })
})
