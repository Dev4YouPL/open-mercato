import type { SubscriberContext } from '@open-mercato/events/types'
import { projectActivityFromSubscriber } from '../lib/activity/projectActivity'

export const metadata = {
  event: 'supply_cases.*',
  persistent: true,
  id: 'supply_cases:activity-events',
}

export default async function handler(payload: unknown, ctx: SubscriberContext): Promise<void> {
  if (!ctx.eventName) return
  await projectActivityFromSubscriber(ctx.eventName, payload, ctx)
}
