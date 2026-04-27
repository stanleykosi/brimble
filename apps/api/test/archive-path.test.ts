import { describe, expect, it } from 'vitest';

import { resolveSafeArchivePath } from '../src/utils/filesystem.js';

describe('resolveSafeArchivePath', () => {
  it('rejects path traversal', () => {
    expect(() => resolveSafeArchivePath('/tmp/brimble', '../escape.txt')).toThrow(/escapes the workspace/);
    expect(() => resolveSafeArchivePath('/tmp/brimble', '/absolute.txt')).toThrow(/not allowed/);
  });

  it('keeps valid nested paths inside the root', () => {
    expect(resolveSafeArchivePath('/tmp/brimble', 'nested/file.txt')).toBe('/tmp/brimble/nested/file.txt');
  });
});
