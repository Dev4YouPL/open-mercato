import { createWorkflowsModuleConfig, defineWorkflow } from '@open-mercato/shared/modules/workflows'

export const INBOUND_CASE_WORKFLOW_ID = 'supply_cases.inbound-case'
export const INBOUND_CASE_REPLY_SIGNAL = 'supply_cases.inbound.reply'
export const INITIAL_IMPACT_READY_SIGNAL = 'supply_cases.initial-impact.ready'
export const SOURCING_DECISION_SIGNAL = 'supply_cases.sourcing.decision-recorded'
export const ALTERNATIVE_REQUEST_DELIVERED_SIGNAL = 'supply_cases.alternative-request.delivered'

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
      stepId: 'initial-impact-advisor',
      stepName: 'Calculate impact and prepare advice',
      stepType: 'WAIT_FOR_SIGNAL',
      description: 'Pause until deterministic impact and the advisory result are stored on the case.',
      signalConfig: { signalName: INITIAL_IMPACT_READY_SIGNAL },
    },
    {
      stepId: 'human-sourcing-decision',
      stepName: 'Await human sourcing decision',
      stepType: 'WAIT_FOR_SIGNAL',
      description: 'Pause until an authorized user selects one of the canonical sourcing options.',
      signalConfig: { signalName: SOURCING_DECISION_SIGNAL },
    },
    {
      stepId: 'alternative-request-delivery',
      stepName: 'Await alternative request delivery evidence',
      stepType: 'WAIT_FOR_SIGNAL',
      description: 'Pause until the outbound request has trusted delivery evidence.',
      signalConfig: { signalName: ALTERNATIVE_REQUEST_DELIVERED_SIGNAL },
    },
    {
      stepId: 'await-reply',
      stepName: 'Await alternative supplier offer',
      stepType: 'WAIT_FOR_SIGNAL',
      description: 'Pause for at most three days after confirmed request delivery.',
      signalConfig: { signalName: INBOUND_CASE_REPLY_SIGNAL, timeout: 'P3D' },
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
      transitionId: 'start-to-initial-impact',
      transitionName: 'Calculate initial impact',
      fromStepId: 'start',
      toStepId: 'initial-impact-advisor',
      trigger: 'auto',
      priority: 100,
    },
    {
      transitionId: 'impact-to-sourcing-decision',
      transitionName: 'Ask for sourcing decision',
      fromStepId: 'initial-impact-advisor',
      toStepId: 'human-sourcing-decision',
      trigger: 'auto',
      priority: 100,
    },
    {
      transitionId: 'decision-to-delivery-evidence',
      transitionName: 'Send request to alternative supplier',
      fromStepId: 'human-sourcing-decision',
      toStepId: 'alternative-request-delivery',
      trigger: 'auto',
      priority: 100,
    },
    {
      transitionId: 'delivery-to-await-reply',
      transitionName: 'Wait for the alternative offer',
      fromStepId: 'alternative-request-delivery',
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
