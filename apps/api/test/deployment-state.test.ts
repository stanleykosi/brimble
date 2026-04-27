import { describe, expect, it } from 'vitest';

import { assertValidTransition } from '../src/services/deployment-state.js';

describe('deployment state transitions', () => {
  it('accepts valid status transitions', () => {
    expect(() => assertValidTransition('pending', 'building')).not.toThrow();
    expect(() => assertValidTransition('building', 'deploying')).not.toThrow();
    expect(() => assertValidTransition('deploying', 'running')).not.toThrow();
  });

  it('rejects invalid status transitions', () => {
    expect(() => assertValidTransition('pending', 'running')).toThrow(/Invalid deployment transition/);
    expect(() => assertValidTransition('running', 'building')).toThrow(/Invalid deployment transition/);
  });
});
