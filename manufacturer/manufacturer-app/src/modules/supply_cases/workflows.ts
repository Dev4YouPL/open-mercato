import { createWorkflowsModuleConfig, defineWorkflow } from '@open-mercato/shared/modules/workflows'

export const INBOUND_CASE_WORKFLOW_ID = 'supply_cases.inbound-case'
export const INBOUND_CASE_REPLY_SIGNAL = 'supply_cases.inbound.reply'

const inboundCase = defineWorkflow({
  workflowId: INBOUND_CASE_WORKFLOW_ID,
  workflowName: 'Supply case inbound flow',
  description: 'Keeps a supplier supply case workflow waiting for correlated replies.',
  metadata: {
    category: 'Supply Cases',
    tags: ['supply_cases', 'inbound', 'supplier'],
    icon: 'package-check',
  },
  steps: [
    {
      stepId: 'start',
      stepName: 'Inbound proposal accepted',
      stepType: 'START',
      description: 'Start after deterministic transport and triage acceptance.',
    },
    {
      stepId: 'await-reply',
      stepName: 'Await supplier reply',
      stepType: 'WAIT_FOR_SIGNAL',
      description: 'Pause until another scoped inbound message is correlated to the case.',
      signalConfig: { signalName: INBOUND_CASE_REPLY_SIGNAL },
    },
    {
      stepId: 'end',
      stepName: 'Inbound flow complete',
      stepType: 'END',
      description: 'The workflow is completed by a later case-owned phase.',
    },
  ] as const,
  transitions: [
    {
      transitionId: 'start-to-await-reply',
      transitionName: 'Wait for a reply',
      fromStepId: 'start',
      toStepId: 'await-reply',
      trigger: 'auto',
      priority: 100,
    },
    {
      transitionId: 'reply-to-end',
      transitionName: 'Hand the reply to the case workflow',
      fromStepId: 'await-reply',
      toStepId: 'end',
      trigger: 'auto',
      priority: 100,
    },
  ],
})

export const workflowsConfig = createWorkflowsModuleConfig({
  moduleId: 'supply_cases',
  workflows: [inboundCase],
})

export default workflowsConfig
