"use client"

import * as React from 'react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import type { ActivityItem, ActivityPage } from '../lib/activity/readActivity'

export function useSupplyActivity(options: { caseId?: string; limit: number; errorMessage: string }) {
  const { caseId, limit, errorMessage } = options
  const [items, setItems] = React.useState<ActivityItem[]>([])
  const [nextCursor, setNextCursor] = React.useState<string | null>(null)
  const nextCursorRef = React.useRef<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const [isLoadingOlder, setIsLoadingOlder] = React.useState(false)
  const [error, setError] = React.useState<unknown>(null)
  const [isLive, setIsLive] = React.useState(true)
  const [updateSequence, setUpdateSequence] = React.useState(0)
  const refreshTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestSequence = React.useRef(0)
  const itemsRef = React.useRef<ActivityItem[]>([])
  const pendingEventRef = React.useRef(false)

  const buildUrl = React.useCallback((cursor?: string | null) => {
    const params = new URLSearchParams({ limit: String(limit) })
    if (caseId) params.set('caseId', caseId)
    if (cursor) params.set('cursor', cursor)
    return `/api/supply_cases/activity?${params.toString()}`
  }, [caseId, limit])

  const load = React.useCallback(async (mode: 'replace' | 'append') => {
    const cursor = mode === 'append' ? nextCursorRef.current : null
    if (mode === 'append' && !cursor) return
    const sequence = ++requestSequence.current
    if (mode === 'replace') setIsRefreshing(true)
    else setIsLoadingOlder(true)
    setError(null)
    try {
      const page = await readApiResultOrThrow<ActivityPage>(buildUrl(cursor), undefined, { errorMessage })
      if (sequence !== requestSequence.current) return
       const previous = itemsRef.current
       const merged = mode === 'append' ? mergeItems(previous, page.items) : page.items
       itemsRef.current = merged
       setItems(merged)
       nextCursorRef.current = page.nextCursor
       setNextCursor(page.nextCursor)
       if (mode === 'replace' && pendingEventRef.current) {
         const previousIds = new Set(previous.map((item) => item.id))
         if (page.items.some((item) => !previousIds.has(item.id))) setUpdateSequence((current) => current + 1)
         pendingEventRef.current = false
       }
    } catch (caught) {
      if (sequence === requestSequence.current) {
        setError(caught)
      }
    } finally {
      if (sequence === requestSequence.current) {
        setIsLoading(false)
        setIsRefreshing(false)
        setIsLoadingOlder(false)
      }
    }
  }, [buildUrl, errorMessage])

  const scheduleRefresh = React.useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null
      void load('replace')
    }, 500)
  }, [load])

  useAppEvent('supply_cases.activity.recorded', (event) => {
    const eventCaseId = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
      ? (event.payload as { caseId?: unknown }).caseId
      : null
    if (caseId && typeof eventCaseId === 'string' && eventCaseId !== caseId) return
    pendingEventRef.current = true
    scheduleRefresh()
  }, [caseId, scheduleRefresh])

  React.useEffect(() => {
    void load('replace')
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
    }
  }, [load])

  React.useEffect(() => {
    setIsLive(navigator.onLine)
    const recover = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void load('replace')
    }
    const onOffline = () => setIsLive(false)
    const onOnline = () => {
      setIsLive(true)
      void load('replace')
    }
    document.addEventListener('visibilitychange', recover)
    window.addEventListener('focus', recover)
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', recover)
      window.removeEventListener('focus', recover)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
    }
  }, [load])

  return {
    items,
    nextCursor,
    isLoading,
    isRefreshing,
    isLoadingOlder,
    error,
    isLive,
    hasNewActivity: updateSequence > 0,
    updateSequence,
    refresh: () => void load('replace'),
    loadOlder: () => void load('append'),
  }
}

function mergeItems(previous: ActivityItem[], incoming: ActivityItem[]): ActivityItem[] {
  const byId = new Map(previous.map((item) => [item.id, item]))
  for (const item of incoming) byId.set(item.id, item)
  return [...byId.values()].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id))
}
