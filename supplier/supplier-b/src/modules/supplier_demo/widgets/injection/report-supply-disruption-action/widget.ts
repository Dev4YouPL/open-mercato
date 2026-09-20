import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import type { InjectionRowActionWidget } from '@open-mercato/shared/modules/widgets/injection'

export const REPORT_SUPPLY_DISRUPTION_HREF = '/backend/supplier-demo/supply-cases/report'

// Navigates to a dedicated form page (the pattern core row actions such as shipping_carriers use) instead of
// opening a dialog mounted in another injection spot: the DataTable toolbar spot resolves widgets from an
// injection-table cache that is not invalidated when later modules register, so a toolbar-mounted dialog
// never received the open event.
const widget: InjectionRowActionWidget = {
  metadata: {
    id: 'supplier_demo.injection.report-supply-disruption-action',
    requiredModules: ['sales'],
    features: ['supplier_demo.supply_cases.manage'],
    priority: 30,
  },
  rowActions: [{
    id: 'supplier_demo.report_supply_disruption',
    label: 'supplier_demo.supplyCases.actions.reportDisruption',
    placement: { position: InjectionPosition.After, relativeTo: 'delete' },
    onSelect: (row, context) => {
      if (!row || typeof row !== 'object') return
      const salesOrderId = (row as Record<string, unknown>).id
      if (typeof salesOrderId !== 'string' || salesOrderId.length === 0) return
      const href = `${REPORT_SUPPLY_DISRUPTION_HREF}?orderId=${encodeURIComponent(salesOrderId)}`
      ;(context as { navigate?: (path: string) => void } | null)?.navigate?.(href)
    },
  }],
}

export default widget
