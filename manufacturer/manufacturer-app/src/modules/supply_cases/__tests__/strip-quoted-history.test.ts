import { stripQuotedHistory } from '../lib/inbound/stripQuotedHistory'

const NEW_TEXT = 'Dzien dobry,\n\nNiestety w srode mozemy dostarczyc tylko 300 sztuk.'

describe('stripQuotedHistory', () => {
  it('returns the body unchanged when there is nothing quoted', () => {
    const result = stripQuotedHistory(NEW_TEXT)
    expect(result).toEqual({ text: NEW_TEXT, removed: false, matchedMarker: null })
  })

  it('cuts a Gmail-style attribution line', () => {
    const body = `${NEW_TEXT}\n\nOn Tue, 16 Sep 2026 at 09:12, Manufacturer A <ops@example.com> wrote:\n> Prosimy o 500 sztuk na srode.`
    const result = stripQuotedHistory(body)
    expect(result.text).toBe(NEW_TEXT)
    expect(result.removed).toBe(true)
    expect(result.matchedMarker).toBe('gmail-on-wrote')
  })

  it('cuts a Polish attribution line', () => {
    const body = `${NEW_TEXT}\n\nW dniu 16.09.2026 o 09:12, Manufacturer A napisał(a):\n> Prosimy o 500 sztuk.`
    const result = stripQuotedHistory(body)
    expect(result.text).toBe(NEW_TEXT)
    expect(result.matchedMarker).toBe('gmail-on-wrote')
  })

  it('cuts an Outlook original-message separator', () => {
    const body = `${NEW_TEXT}\n\n-----Original Message-----\nFrom: ops@example.com\nProsimy o 500 sztuk.`
    const result = stripQuotedHistory(body)
    expect(result.text).toBe(NEW_TEXT)
    expect(result.matchedMarker).toBe('outlook-original-message')
  })

  it('cuts a Polish Outlook separator', () => {
    const body = `${NEW_TEXT}\n\n-----Wiadomość oryginalna-----\nOd: ops@example.com`
    const result = stripQuotedHistory(body)
    expect(result.text).toBe(NEW_TEXT)
  })

  it('cuts a forwarded header block introduced by From:', () => {
    const body = `${NEW_TEXT}\n\nFrom: Manufacturer A <ops@example.com>\nSent: Tuesday, 16 September 2026 09:12\nTo: Supplier\nSubject: MAT-42\n\nProsimy o 500 sztuk.`
    const result = stripQuotedHistory(body)
    expect(result.text).toBe(NEW_TEXT)
    expect(result.matchedMarker).toBe('header-block-from')
  })

  it('does not cut on the word From in ordinary prose', () => {
    const body = 'From our side the order stands.\n\nWe can ship 300 units.'
    const result = stripQuotedHistory(body)
    expect(result.removed).toBe(false)
    expect(result.text).toBe(body)
  })

  it('cuts a block of quote-prefixed lines', () => {
    const body = `${NEW_TEXT}\n\n> Prosimy o 500 sztuk na srode.\n> Pozdrawiam.`
    const result = stripQuotedHistory(body)
    expect(result.text).toBe(NEW_TEXT)
    expect(result.matchedMarker).toBe('quote-prefix')
  })

  it('cuts an RFC 3676 signature delimiter', () => {
    const body = `${NEW_TEXT}\n\n-- \nJan Kowalski\nSupplier 1 Sp. z o.o.`
    const result = stripQuotedHistory(body)
    expect(result.text).toBe(NEW_TEXT)
    expect(result.matchedMarker).toBe('rfc3676-signature')
  })

  it('cuts a mobile signature', () => {
    const body = `${NEW_TEXT}\n\nSent from my iPhone`
    const result = stripQuotedHistory(body)
    expect(result.text).toBe(NEW_TEXT)
    expect(result.matchedMarker).toBe('mobile-signature')
  })

  it('keeps only the newest statement when the thread supersedes earlier numbers', () => {
    const body = [
      'Niestety w srode mozemy dostarczyc tylko 300 sztuk.',
      '',
      'On Tue, 16 Sep 2026 at 09:12, Manufacturer A <ops@example.com> wrote:',
      '> Potwierdzamy 500 sztuk na srode.',
      '>',
      '> On Mon, 15 Sep 2026, Supplier wrote:',
      '>> Mozemy dostarczyc 500 sztuk.',
    ].join('\n')
    const result = stripQuotedHistory(body)
    expect(result.text).toBe('Niestety w srode mozemy dostarczyc tylko 300 sztuk.')
    expect(result.text).not.toContain('500')
  })

  it('cuts at the earliest marker when several are present', () => {
    const body = `${NEW_TEXT}\n\n-- \nJan Kowalski\n\n-----Original Message-----\nProsimy o 500 sztuk.`
    const result = stripQuotedHistory(body)
    expect(result.text).toBe(NEW_TEXT)
    expect(result.matchedMarker).toBe('rfc3676-signature')
  })

  it('returns empty text for a message that is only quoted history', () => {
    const body = '> Prosimy o 500 sztuk na srode.\n> Pozdrawiam.'
    const result = stripQuotedHistory(body)
    expect(result.text).toBe('')
    expect(result.removed).toBe(true)
  })

  it('normalizes CRLF before matching', () => {
    const body = `${NEW_TEXT}\r\n\r\n-----Original Message-----\r\nProsimy o 500 sztuk.`
    const result = stripQuotedHistory(body)
    expect(result.text).toBe(NEW_TEXT)
  })
})
