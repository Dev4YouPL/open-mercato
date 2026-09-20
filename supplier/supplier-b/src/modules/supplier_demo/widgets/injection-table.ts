import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'data-table:sales.orders:row-actions': {
    widgetId: 'supplier_demo.injection.report-supply-disruption-action',
    priority: 30,
  },
}

export default injectionTable
