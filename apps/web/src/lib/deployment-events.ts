import type {
  DeploymentEvent,
  DeploymentLogPayload,
  DeploymentStatusPayload,
  DeploymentSystemPayload
} from '@brimble/contracts';

export type DeploymentLogEvent = DeploymentEvent & {
  eventType: 'log';
  payload: DeploymentLogPayload;
};

export type DeploymentStatusEvent = DeploymentEvent & {
  eventType: 'status';
  payload: DeploymentStatusPayload;
};

export type DeploymentSystemEvent = DeploymentEvent & {
  eventType: 'system';
  payload: DeploymentSystemPayload;
};

export function isLogEvent(event: DeploymentEvent): event is DeploymentLogEvent {
  return event.eventType === 'log';
}

export function isStatusEvent(event: DeploymentEvent): event is DeploymentStatusEvent {
  return event.eventType === 'status';
}

export function isSystemEvent(event: DeploymentEvent): event is DeploymentSystemEvent {
  return event.eventType === 'system';
}
