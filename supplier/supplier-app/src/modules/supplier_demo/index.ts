import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'supplier_demo',
  title: 'Supplier Demo Data',
  version: '0.1.0',
  description: 'Seeds the supplier demo supply proposal flow and its warehouse stock.',
  author: 'Supplier App Team',
  license: 'MIT',
  requires: ['catalog', 'customers', 'sales', 'wms', 'feature_toggles', 'communication_channels', 'notifications'],
}

export default metadata
