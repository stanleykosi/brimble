import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { normalizeExtractedSource } from '../src/utils/filesystem.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    await cleanup?.();
  }
});

describe('normalizeExtractedSource', () => {
  it('collapses a single project directory even when archive metadata is present', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'brimble-filesystem-test-'));
    cleanups.push(async () => {
      await rm(root, { recursive: true, force: true });
    });

    const extractedRoot = path.join(root, 'extracted');
    const destinationRoot = path.join(root, 'normalized');
    const projectRoot = path.join(extractedRoot, 'brimble-sample');

    await mkdir(projectRoot, { recursive: true });
    await mkdir(path.join(extractedRoot, '__MACOSX'), { recursive: true });
    await writeFile(path.join(extractedRoot, '.DS_Store'), 'finder metadata');
    await writeFile(path.join(projectRoot, 'package.json'), '{"name":"brimble-sample"}');

    await normalizeExtractedSource(extractedRoot, destinationRoot);

    const entries = await readdir(destinationRoot);
    expect(entries).toContain('package.json');
    expect(entries).not.toContain('brimble-sample');
  });
});
