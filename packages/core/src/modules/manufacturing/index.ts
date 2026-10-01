import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'manufacturing',
  title: 'Manufacturing',
  version: '0.1.0',
  description: 'Manufacturing management.',
  author: 'Open Mercato Team',
  license: 'MIT',
}

export { features } from './acl'
