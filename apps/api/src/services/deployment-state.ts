import type { DeploymentStatus } from '@brimble/contracts';

import { AppError } from '../utils/errors.js';

const allowedTransitions: Record<DeploymentStatus, DeploymentStatus[]> = {
  pending: ['building'],
  building: ['deploying', 'failed'],
  deploying: ['running', 'failed'],
  running: [],
  failed: []
};

export function assertValidTransition(fromStatus: DeploymentStatus, toStatus: DeploymentStatus): void {
  if (fromStatus === toStatus) {
    return;
  }

  if (!allowedTransitions[fromStatus].includes(toStatus)) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: `Invalid deployment transition: ${fromStatus} -> ${toStatus}`,
      statusCode: 409
    });
  }
}
