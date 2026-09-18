import { emailsMatch, normalizeEmail, normalizeEmailOrNull } from '../lib/email/normalizeEmail'

describe('normalizeEmail', () => {
  it('folds case and strips a display name to one canonical address', () => {
    const result = normalizeEmail('"Dostawca 1" <Supplier@Hackon-OM-Wro.Cloud>')
    expect(result).toEqual({
      ok: true,
      address: 'supplier@hackon-om-wro.cloud',
      localPart: 'supplier',
      domain: 'hackon-om-wro.cloud',
    })
  })

  it('treats the header forms a real mail client produces as one identity', () => {
    const forms = [
      'supplier@hackon-om-wro.cloud',
      '<SUPPLIER@hackon-om-wro.cloud>',
      '  Dostawca <Supplier@Hackon-OM-Wro.Cloud>  ',
      'Supplier@HACKON-OM-WRO.CLOUD',
    ]
    const normalized = forms.map((form) => normalizeEmailOrNull(form))
    expect(new Set(normalized)).toEqual(new Set(['supplier@hackon-om-wro.cloud']))
  })

  it('keeps plus-addressing and dots so distinct mailboxes stay distinct', () => {
    expect(normalizeEmailOrNull('supplier+rfq@example.com')).toBe('supplier+rfq@example.com')
    expect(normalizeEmailOrNull('first.last@example.com')).toBe('first.last@example.com')
    expect(emailsMatch('first.last@example.com', 'firstlast@example.com')).toBe(false)
    expect(emailsMatch('supplier+rfq@example.com', 'supplier@example.com')).toBe(false)
  })

  it.each([
    ['', 'EMPTY'],
    ['   ', 'EMPTY'],
    ['Dostawca 1', 'NO_ADDRESS'],
    ['<>', 'NO_ADDRESS'],
    ['a@b@c.com', 'MULTIPLE_AT_SIGNS'],
    ['@example.com', 'EMPTY_LOCAL_PART'],
    ['supplier@', 'EMPTY_DOMAIN'],
    ['supplier@localhost', 'EMPTY_DOMAIN'],
    ['sup plier@example.com', 'ILLEGAL_CHARACTER'],
    ['"odd@name"@example.com', 'QUOTED_LOCAL_PART_UNSUPPORTED'],
  ])('rejects %p with reason %p', (input, reason) => {
    const result = normalizeEmail(input)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe(reason)
  })

  it('rejects null and undefined without throwing', () => {
    expect(normalizeEmail(null).ok).toBe(false)
    expect(normalizeEmail(undefined).ok).toBe(false)
    expect(normalizeEmailOrNull(null)).toBeNull()
  })

  it('refuses to match on a substring of a longer domain', () => {
    expect(emailsMatch('supplier@hackon-om-wro.cloud', 'supplier@hackon-om-wro.cloud.evil.com')).toBe(false)
  })

  it('never matches an address that cannot be normalized, including against itself', () => {
    expect(emailsMatch('not-an-address', 'not-an-address')).toBe(false)
    expect(emailsMatch(null, null)).toBe(false)
  })
})
