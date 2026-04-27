import type {
  DeploymentEvent,
  DeploymentEventPhase,
  DeploymentEventStream,
  DeploymentLogPayload,
  DeploymentStatusPayload,
  DeploymentSystemPayload
} from '@brimble/contracts';

import { DeploymentEventRepository } from '../repositories/deployment-event-repository.js';

type Subscriber = (event: DeploymentEvent) => void;

export class DeploymentEventService {
  private readonly subscribers = new Map<string, Set<Subscriber>>();

  constructor(private readonly repository: DeploymentEventRepository) {}

  list(deploymentId: string, after = 0, limit = 500): DeploymentEvent[] {
    return this.repository.list(deploymentId, after, limit);
  }

  getLatestSequence(deploymentId: string): number {
    return this.repository.getLatestSequence(deploymentId);
  }

  appendLog(
    deploymentId: string,
    phase: DeploymentEventPhase,
    stream: DeploymentEventStream,
    payload: DeploymentLogPayload
  ): DeploymentEvent {
    return this.append(deploymentId, 'log', phase, stream, payload);
  }

  appendStatus(deploymentId: string, payload: DeploymentStatusPayload): DeploymentEvent {
    return this.append(deploymentId, 'status', 'system', 'meta', payload);
  }

  appendSystem(
    deploymentId: string,
    code: string,
    message: string,
    phase: DeploymentEventPhase = 'system',
    data?: Record<string, unknown>
  ): DeploymentEvent {
    const payload: DeploymentSystemPayload = {
      code,
      message,
      ...(data ? { data } : {})
    };

    return this.append(deploymentId, 'system', phase, 'meta', payload);
  }

  subscribe(deploymentId: string, subscriber: Subscriber): () => void {
    const listeners = this.subscribers.get(deploymentId) ?? new Set<Subscriber>();
    listeners.add(subscriber);
    this.subscribers.set(deploymentId, listeners);

    return () => {
      const currentListeners = this.subscribers.get(deploymentId);
      currentListeners?.delete(subscriber);

      if (currentListeners && currentListeners.size === 0) {
        this.subscribers.delete(deploymentId);
      }
    };
  }

  private append(
    deploymentId: string,
    eventType: 'log' | 'status' | 'system',
    phase: DeploymentEventPhase | null,
    stream: DeploymentEventStream | null,
    payload: DeploymentLogPayload | DeploymentStatusPayload | DeploymentSystemPayload
  ): DeploymentEvent {
    const event = this.repository.append(
      deploymentId,
      eventType,
      phase,
      stream,
      payload,
      new Date().toISOString()
    );

    const listeners = this.subscribers.get(deploymentId);
    listeners?.forEach((listener) => listener(event));
    return event;
  }
}
