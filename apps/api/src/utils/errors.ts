import type { DeploymentErrorCode } from '@brimble/contracts';

export class AppError extends Error {
  code: DeploymentErrorCode | 'VALIDATION_ERROR';
  details?: Record<string, unknown>;
  statusCode: number;

  constructor(options: {
    code: DeploymentErrorCode | 'VALIDATION_ERROR';
    message: string;
    statusCode?: number;
    details?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(options.message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = options.code;
    this.statusCode = options.statusCode ?? 500;
    this.details = options.details;
  }
}

function getErrorStatusCode(error: unknown): number {
  if (!error || typeof error !== 'object') {
    return 500;
  }

  const errorWithStatus = error as {
    statusCode?: unknown;
    status?: unknown;
  };

  if (typeof errorWithStatus.statusCode === 'number') {
    return errorWithStatus.statusCode;
  }

  if (typeof errorWithStatus.status === 'number') {
    return errorWithStatus.status;
  }

  return 500;
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError({
      code: 'VALIDATION_ERROR',
      message: error.message,
      statusCode: getErrorStatusCode(error),
      cause: error
    });
  }

  return new AppError({
    code: 'VALIDATION_ERROR',
    message: 'Unknown error',
    statusCode: getErrorStatusCode(error),
    details: {
      value: error
    }
  });
}
