import { prepareInboundBody } from '../lib/inbound/prepareInboundBody'

describe('prepareInboundBody', () => {
  it('keeps the delivered body verbatim and hands the agent only the new text', () => {
    const delivered = [
      'Niestety w srode dostarczymy tylko 300 sztuk MAT-42.',
      '',
      'W dniu 2026-09-10 manufacturer@hackon-om-wro.cloud napisal:',
      '> Potwierdzamy 500 sztuk MAT-42 na srode.',
    ].join('\n')

    const result = prepareInboundBody({ text: delivered })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rawBody).toBe(delivered)
    expect(result.sanitizedBody).toBe('Niestety w srode dostarczymy tylko 300 sztuk MAT-42.')
    expect(result.strippedMarker).toBe('gmail-on-wrote')
  })

  it('never lets a superseded quantity reach the agent through quoted history', () => {
    const result = prepareInboundBody({
      text: 'Mozemy dac 300 sztuk.\n\n> Potwierdzamy 500 sztuk na srode.',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sanitizedBody).not.toContain('500')
    expect(result.rawBody).toContain('500')
  })

  it('refuses a message that is only quoted history instead of re-reading it as new text', () => {
    const result = prepareInboundBody({
      text: '> Potwierdzamy 500 sztuk MAT-42 na srode.\n> Pozdrawiam.',
    })

    expect(result).toEqual({ ok: false, reason: 'QUOTED_HISTORY_ONLY' })
  })

  it('converts an HTML-only body and keeps the HTML source as the audit copy', () => {
    const html = '<div><p>Dostawa <b>300</b> sztuk w srode.</p></div>'

    const result = prepareInboundBody({ text: '', html })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sanitizedBody).toContain('300')
    expect(result.rawBody).toBe(html)
  })

  it('reports an empty delivery rather than inventing content', () => {
    expect(prepareInboundBody({ text: '   ', html: null })).toEqual({ ok: false, reason: 'EMPTY_BODY' })
  })

  it('flags truncation while keeping the full raw body', () => {
    const long = `${'a'.repeat(50)} koniec`

    const result = prepareInboundBody({ text: long }, { maxLength: 20 })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.truncated).toBe(true)
    expect(result.sanitizedBody.length).toBeLessThanOrEqual(20)
    expect(result.rawBody).toBe(long)
  })
})
