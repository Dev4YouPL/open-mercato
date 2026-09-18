import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'supply_cases',
  title: 'Supply Cases',
  version: '0.1.0',
  description:
    'Supply exception cases for Manufacturer A. Ships a local JSON-backed store for ProductionOrder, ProductionPlan, SupplyCase and InboundMessage; the ORM-backed implementation replaces it behind the same repository contracts.',
  author: 'Manufacturer App',
  license: 'UNLICENSED',
  requires: [],
}

export default metadata
