import { describe, expect, it } from 'vitest';

import { AppError, toAppError } from '../src/utils/errors.js';

describe('toAppError', () => {
  it('returns existing AppError instances unchanged', () => {
    const error = new AppError({
      code: 'VALIDATION_ERROR',
      message: 'already normalized',
      statusCode: 400
    });

    expect(toAppError(error)).toBe(error);
  });

  it('preserves upstream statusCode values', () => {
    const error = new Error('archive upload too large') as Error & {
      statusCode: number;
    };
    error.statusCode = 413;

    const normalized = toAppError(error);

    expect(normalized.statusCode).toBe(413);
    expect(normalized.message).toBe('archive upload too large');
  });

  it('preserves upstream status values', () => {
    const error = new Error('unprocessable entity') as Error & {
      status: number;
    };
    error.status = 422;

    const normalized = toAppError(error);

    expect(normalized.statusCode).toBe(422);
    expect(normalized.message).toBe('unprocessable entity');
  });
});
