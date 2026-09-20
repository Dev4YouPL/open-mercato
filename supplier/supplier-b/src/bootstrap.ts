/** Full app bootstrap used by backend and portal page runtimes. */
import { createBootstrap, isBootstrapped } from '@open-mercato/shared/lib/bootstrap'
import { register as registerAppDi } from '@/di'
import { claimCommandLoaderEntries, serverFoundationBootstrapData } from '@/bootstrap-common'

import { dashboardWidgetEntries } from '@/.mercato/generated/dashboard-widgets.generated'
import { injectionWidgetEntries } from '@/.mercato/generated/injection-widgets.generated'
import { componentOverrideEntries } from '@/.mercato/generated/component-overrides.generated'
import { notificationHandlerEntries } from '@/.mercato/generated/notification-handlers.generated'

const bootstrapImplementation = createBootstrap({
  ...serverFoundationBootstrapData,
  commandLoaderEntries: claimCommandLoaderEntries(),
  dashboardWidgetEntries,
  injectionWidgetEntries,
  componentOverrideEntries,
  notificationHandlerEntries,
}, {
  appDiRegistrar: registerAppDi,
  registrationKey: 'full',
})

type BootstrapGlobalState = typeof globalThis & {
  __supplierBFullBootstrapRegistered?: boolean
}

export function bootstrap(): void {
  if (process.env.NODE_ENV !== 'production') {
    bootstrapImplementation()
    return
  }

  const globalState = globalThis as BootstrapGlobalState
  if (globalState.__supplierBFullBootstrapRegistered) return
  bootstrapImplementation()
  globalState.__supplierBFullBootstrapRegistered = true
}

export { isBootstrapped }
