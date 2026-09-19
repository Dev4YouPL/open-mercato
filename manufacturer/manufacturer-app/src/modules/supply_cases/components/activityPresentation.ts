import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, Bot, CheckCircle2, Clock3, FileText, Mail, PackageCheck, RefreshCw, Search, XCircle } from 'lucide-react'
import type { ActivityItem } from '../lib/activity/readActivity'

export type ActivityStatusVariant = 'neutral' | 'info' | 'success' | 'warning' | 'error'

export function getActivityIcon(item: ActivityItem): LucideIcon {
  switch (item.kind) {
    case 'email_received': return Mail
    case 'analysis_started': return Search
    case 'sender_classified': return Bot
    case 'supplier_offer_extracted': return PackageCheck
    case 'analysis_completed': return CheckCircle2
    case 'risk_detected': return AlertTriangle
    case 'case_created': return FileText
    case 'operation_failed': return XCircle
    case 'retry_started': return RefreshCw
    default: return Clock3
  }
}

export function getActivityStatusVariant(status: ActivityItem['status']): ActivityStatusVariant {
  if (status === 'success') return 'success'
  if (status === 'warning' || status === 'waiting') return 'warning'
  if (status === 'error') return 'error'
  if (status === 'running') return 'info'
  return 'neutral'
}
