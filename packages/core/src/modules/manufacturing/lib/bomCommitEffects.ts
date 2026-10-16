import type { EventManager } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'

type BomCommitEffect = () => Promise<void>

const pendingEffectsByManager = new WeakMap<
  EventManager,
  Map<object, BomCommitEffect[]>
>()

export async function runBomCommitEffects(
  em: EntityManager,
  effect: BomCommitEffect,
): Promise<void> {
  const transaction = em.getTransactionContext()

  if (!transaction) {
    await effect()
    return
  }

  const eventManager = em.getEventManager()

  let pendingEffects = pendingEffectsByManager.get(eventManager)

  if (!pendingEffects) {
    const transactionEffects = new Map<object, BomCommitEffect[]>()

    pendingEffectsByManager.set(eventManager, transactionEffects)
    pendingEffects = transactionEffects

    eventManager.registerSubscriber({
      async afterTransactionCommit(args) {
        if (!args.transaction) return

        const effects = transactionEffects.get(args.transaction)

        if (!effects) return

        transactionEffects.delete(args.transaction)

        for (const queuedEffect of effects) {
          await queuedEffect()
        }
      },

      afterTransactionRollback(args) {
        if (!args.transaction) return

        transactionEffects.delete(args.transaction)
      },
    })
  }

  const effects = pendingEffects.get(transaction) ?? []

  effects.push(effect)
  pendingEffects.set(transaction, effects)
}