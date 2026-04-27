import { describe, expect, it } from 'vitest';

import { resolveRuntimePortFromInspect } from '../src/services/docker-runtime-service.js';

describe('resolveRuntimePortFromInspect', () => {
  it('uses the single exposed tcp port when present', () => {
    expect(
      resolveRuntimePortFromInspect([{ Config: { ExposedPorts: { '8080/tcp': {} } } }], 3000)
    ).toBe(8080);
  });

  it('falls back when multiple or no tcp ports exist', () => {
    expect(
      resolveRuntimePortFromInspect(
        [{ Config: { ExposedPorts: { '8080/tcp': {}, '3000/tcp': {} } } }],
        3000
      )
    ).toBe(3000);
    expect(resolveRuntimePortFromInspect([{}], 3000)).toBe(3000);
  });
});
