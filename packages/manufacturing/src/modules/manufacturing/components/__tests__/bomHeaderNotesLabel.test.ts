import en from '../../i18n/en.json'
import pl from '../../i18n/pl.json'
import de from '../../i18n/de.json'
import es from '../../i18n/es.json'
import ko from '../../i18n/ko.json'

// The BOM header form's revision-label field was relabeled to a generic
// "Notes" field. This pins the translated label so a locale edit can't
// silently reintroduce the old "revision label" wording.
describe('manufacturing.boms.form.revisionLabel — renamed to Notes', () => {
  const cases: Array<{ locale: string; dict: Record<string, string>; label: string }> = [
    { locale: 'en', dict: en, label: 'Notes' },
    { locale: 'pl', dict: pl, label: 'Uwagi' },
    { locale: 'de', dict: de, label: 'Notizen' },
    { locale: 'es', dict: es, label: 'Notas' },
    { locale: 'ko', dict: ko, label: '메모' },
  ]

  for (const { locale, dict, label } of cases) {
    it(`labels the field "${label}" in ${locale}`, () => {
      expect(dict['manufacturing.boms.form.revisionLabel']).toBe(label)
    })

    it(`does not mention "revision" in the ${locale} hint`, () => {
      const hint = dict['manufacturing.boms.form.revisionLabelHint']
      expect(hint).toBeTruthy()
      expect(hint.toLowerCase()).not.toContain('revision')
    })
  }
})
