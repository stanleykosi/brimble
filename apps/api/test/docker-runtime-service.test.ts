import { afterEach, describe, expect, it, vi } from 'vitest';

const { runCommandMock } = vi.hoisted(() => ({
  runCommandMock: vi.fn()
}));

vi.mock('../src/utils/process.js', () => ({
  runCommand: runCommandMock
}));

import { AppError } from '../src/utils/errors.js';
import { DockerRuntimeService } from '../src/services/docker-runtime-service.js';

afterEach(() => {
  runCommandMock.mockReset();
});

describe('DockerRuntimeService.containerExists', () => {
  it('returns true when docker inspect succeeds', async () => {
    runCommandMock.mockResolvedValueOnce({
      code: 0,
      stdout: ['{}'],
      stderr: []
    });

    const service = new DockerRuntimeService({} as never, {} as never);

    await expect(service.containerExists('brimble-app-sample')).resolves.toBe(true);
  });

  it('returns false when docker reports that the container does not exist', async () => {
    runCommandMock.mockResolvedValueOnce({
      code: 1,
      stdout: [],
      stderr: ['Error: No such object: brimble-app-sample']
    });

    const service = new DockerRuntimeService({} as never, {} as never);

    await expect(service.containerExists('brimble-app-sample')).resolves.toBe(false);
  });

  it('throws when docker inspect fails for transport reasons', async () => {
    runCommandMock.mockResolvedValueOnce({
      code: 1,
      stdout: [],
      stderr: [
        'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?'
      ]
    });

    const service = new DockerRuntimeService({} as never, {} as never);
    const inspection = service.containerExists('brimble-app-sample');

    await expect(inspection).rejects.toBeInstanceOf(AppError);
    await expect(inspection).rejects.toMatchObject({
      message: 'Failed to inspect container brimble-app-sample'
    });
  });
});

describe('DockerRuntimeService.stopAndRemoveContainer', () => {
  it('ignores missing-container docker rm results', async () => {
    runCommandMock.mockResolvedValueOnce({
      code: 1,
      stdout: [],
      stderr: ['Error response from daemon: No such container: brimble-app-sample']
    });

    const service = new DockerRuntimeService({} as never, {} as never);

    await expect(service.stopAndRemoveContainer('brimble-app-sample')).resolves.toBeUndefined();
  });

  it('throws when docker rm fails for transport reasons', async () => {
    runCommandMock.mockResolvedValueOnce({
      code: 1,
      stdout: [],
      stderr: [
        'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?'
      ]
    });

    const service = new DockerRuntimeService({} as never, {} as never);
    const removal = service.stopAndRemoveContainer('brimble-app-sample');

    await expect(removal).rejects.toBeInstanceOf(AppError);
    await expect(removal).rejects.toMatchObject({
      message: 'Failed to remove container brimble-app-sample'
    });
  });
});

describe('DockerRuntimeService.listManagedContainers', () => {
  it('throws when docker ps cannot reach the daemon', async () => {
    runCommandMock.mockResolvedValueOnce({
      code: 1,
      stdout: [],
      stderr: [
        'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?'
      ]
    });

    const service = new DockerRuntimeService({} as never, {} as never);
    const listing = service.listManagedContainers();

    await expect(listing).rejects.toBeInstanceOf(AppError);
    await expect(listing).rejects.toMatchObject({
      message: 'Failed to list managed containers'
    });
  });
});
