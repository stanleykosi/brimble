import { createWriteStream } from 'node:fs';
import { chmod, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import type { DeploymentDetail } from '@brimble/contracts';
import unzipper from 'unzipper';
import { type ReadEntry, t as listTarEntries, x as extractTarball } from 'tar';

import type { AppConfig } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import {
  ensureEmptyDir,
  normalizeExtractedSource,
  resolveSafeArchivePath
} from '../utils/filesystem.js';
import { runCommand } from '../utils/process.js';
import { DeploymentEventService } from './deployment-event-service.js';

export class SourceService {
  constructor(
    private readonly config: AppConfig,
    private readonly eventService: DeploymentEventService
  ) {}

  async acquireSource(deployment: DeploymentDetail): Promise<string> {
    const workspaceRoot = path.join(this.config.STORAGE_ROOT, 'workspaces', deployment.id);
    const extractedRoot = path.join(workspaceRoot, 'extracted');
    const sourceRoot = path.join(workspaceRoot, 'src');

    await mkdir(workspaceRoot, { recursive: true });

    if (deployment.sourceType === 'git') {
      return await this.cloneGitSource(deployment, sourceRoot);
    }

    return await this.extractArchiveSource(deployment, extractedRoot, sourceRoot);
  }

  async cleanupWorkspace(deploymentId: string): Promise<void> {
    if (this.config.KEEP_WORKSPACES) {
      return;
    }

    const workspaceRoot = path.join(this.config.STORAGE_ROOT, 'workspaces', deploymentId);
    await rm(workspaceRoot, { recursive: true, force: true });
  }

  private async cloneGitSource(deployment: DeploymentDetail, sourceRoot: string): Promise<string> {
    if (!deployment.sourceGitUrl) {
      throw new AppError({
        code: 'SOURCE_FETCH_FAILED',
        message: 'Git deployment is missing sourceGitUrl'
      });
    }

    await ensureEmptyDir(sourceRoot);
    this.eventService.appendSystem(deployment.id, 'SOURCE_FETCH_STARTED', 'Cloning repository', 'prepare', {
      gitUrl: deployment.sourceGitUrl
    });

    const result = await runCommand({
      command: 'git',
      args: ['clone', '--depth=1', deployment.sourceGitUrl, sourceRoot],
      onStdoutLine: (line) => {
        this.eventService.appendLog(deployment.id, 'prepare', 'stdout', { message: line, chunk: false });
      },
      onStderrLine: (line) => {
        this.eventService.appendLog(deployment.id, 'prepare', 'stderr', { message: line, chunk: false });
      }
    });

    if (result.code !== 0) {
      throw new AppError({
        code: 'SOURCE_FETCH_FAILED',
        message: `Failed to clone ${deployment.sourceGitUrl}`,
        details: {
          stderr: result.stderr.join('\n')
        }
      });
    }

    this.eventService.appendSystem(
      deployment.id,
      'SOURCE_FETCH_FINISHED',
      'Repository cloned successfully',
      'prepare'
    );

    return sourceRoot;
  }

  private async extractArchiveSource(
    deployment: DeploymentDetail,
    extractedRoot: string,
    sourceRoot: string
  ): Promise<string> {
    if (!deployment.sourceArchivePath) {
      throw new AppError({
        code: 'SOURCE_EXTRACT_FAILED',
        message: 'Archive deployment is missing sourceArchivePath'
      });
    }

    await ensureEmptyDir(extractedRoot);
    await ensureEmptyDir(sourceRoot);

    this.eventService.appendSystem(
      deployment.id,
      'SOURCE_EXTRACT_STARTED',
      'Extracting uploaded archive',
      'prepare',
      {
        archivePath: deployment.sourceArchivePath
      }
    );

    if (deployment.sourceArchivePath.endsWith('.zip')) {
      await this.extractZip(deployment, deployment.sourceArchivePath, extractedRoot);
    } else {
      await this.extractTarball(deployment, deployment.sourceArchivePath, extractedRoot);
    }

    await normalizeExtractedSource(extractedRoot, sourceRoot);

    this.eventService.appendSystem(
      deployment.id,
      'SOURCE_EXTRACT_FINISHED',
      'Archive extracted successfully',
      'prepare'
    );

    return sourceRoot;
  }

  private async extractZip(
    deployment: DeploymentDetail,
    archivePath: string,
    destinationRoot: string
  ): Promise<void> {
    const directory = await unzipper.Open.file(archivePath);

    for (const entry of directory.files) {
      const entryPath = resolveSafeArchivePath(destinationRoot, entry.path);
      const type = entry.type;
      const mode = getZipEntryPermissions(entry.externalFileAttributes);

      if ((getZipEntryType(entry.externalFileAttributes) & 0o170000) === 0o120000) {
        throw new AppError({
          code: 'SOURCE_EXTRACT_FAILED',
          message: `Archive entry "${entry.path}" is a symbolic link and is not allowed`,
          statusCode: 400
        });
      }

      if (type === 'Directory') {
        await mkdir(entryPath, { recursive: true });
        continue;
      }

      await mkdir(path.dirname(entryPath), { recursive: true });
      await new Promise<void>((resolve, reject) => {
        entry
          .stream()
          .pipe(createWriteStream(entryPath, mode ? { mode } : undefined))
          .on('finish', resolve)
          .on('error', reject);
      });

      if (mode) {
        await chmod(entryPath, mode);
      }
    }

    this.eventService.appendLog(deployment.id, 'prepare', 'stdout', {
      message: 'Zip archive extracted',
      chunk: false
    });
  }

  private async extractTarball(
    deployment: DeploymentDetail,
    archivePath: string,
    destinationRoot: string
  ): Promise<void> {
    const invalidEntries: string[] = [];

    await listTarEntries({
      file: archivePath,
      onentry: (entry: ReadEntry) => {
        try {
          resolveSafeArchivePath(destinationRoot, entry.path);
        } catch {
          invalidEntries.push(entry.path);
        }

        if (entry.type === 'SymbolicLink' || entry.type === 'Link') {
          invalidEntries.push(entry.path);
        }
      }
    });

    if (invalidEntries.length > 0) {
      throw new AppError({
        code: 'SOURCE_EXTRACT_FAILED',
        message: 'Archive contains unsafe paths',
        statusCode: 400,
        details: {
          entries: invalidEntries
        }
      });
    }

    await extractTarball({
      file: archivePath,
      cwd: destinationRoot,
      strict: true,
      preservePaths: false
    });

    this.eventService.appendLog(deployment.id, 'prepare', 'stdout', {
      message: 'Tar archive extracted',
      chunk: false
    });
  }
}

function getZipEntryType(externalFileAttributes: number | undefined): number {
  return ((externalFileAttributes ?? 0) >> 16) & 0o170000;
}

export function getZipEntryPermissions(externalFileAttributes: number | undefined): number | null {
  const rawMode = (externalFileAttributes ?? 0) >> 16;
  const permissions = rawMode & 0o777;
  return permissions === 0 ? null : permissions;
}
