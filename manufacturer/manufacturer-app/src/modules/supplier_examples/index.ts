import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'supplier_examples',
  title: 'Supplier Examples',
  version: '0.1.0',
  description: 'Seeds supplier examples as customer companies with a supplier tag and classification field.',
  author: 'Manufacturer App',
  license: 'UNLICENSED',
  requires: ['auth', 'customers', 'entities'],
}

export default metadata
