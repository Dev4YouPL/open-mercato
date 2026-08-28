import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'manufacturing',
  title: 'Manufacturing',
  version: '0.1.0',
  description: 'Manufacturing definitions, execution, and production history',
  author: 'Open Mercato Team',
  license: 'MIT',
  ejectable: true,
  requires: ['catalog'],
}

export default metadata
