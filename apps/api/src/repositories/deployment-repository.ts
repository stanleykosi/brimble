import type {
  DeploymentDetail,
  DeploymentStatus,
  DeploymentSubstage,
  ListDeploymentsQuery,
  RouteMode,
  SourceType
} from '@brimble/contracts';
import type Database from 'better-sqlite3';

import { AppError } from '../utils/errors.js';

interface DeploymentRow {
  id: string;
  project_id: string;
  slug: string;
  source_type: SourceType;
  source_git_url: string | null;
  source_archive_filename: string | null;
  source_archive_path: string | null;
  source_root_path: string;
  status: DeploymentStatus;
  substage: DeploymentSubstage | null;
  status_reason: string | null;
  image_tag: string | null;
  container_name: string | null;
  container_id: string | null;
  route_mode: RouteMode;
  route_host: string | null;
  route_path: string | null;
  live_url: string | null;
  internal_port: number | null;
  railpack_plan_path: string | null;
  railpack_info_path: string | null;
  build_started_at: string | null;
  build_finished_at: string | null;
  deploy_started_at: string | null;
  deploy_finished_at: string | null;
  running_at: string | null;
  failed_at: string | null;
  created_at: string;
  updated_at: string;
}

type DeploymentInsert = {
  id: string;
  projectId: string;
  slug: string;
  sourceType: SourceType;
  sourceGitUrl: string | null;
  sourceArchiveFilename: string | null;
  sourceArchivePath: string | null;
  sourceRootPath: string;
  status: DeploymentStatus;
  substage: DeploymentSubstage | null;
  statusReason: string | null;
  imageTag: string | null;
  containerName: string | null;
  containerId: string | null;
  routeMode: RouteMode;
  routeHost: string | null;
  routePath: string | null;
  liveUrl: string | null;
  internalPort: number | null;
  railpackPlanPath: string | null;
  railpackInfoPath: string | null;
  buildStartedAt: string | null;
  buildFinishedAt: string | null;
  deployStartedAt: string | null;
  deployFinishedAt: string | null;
  runningAt: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DeploymentPatch = Partial<{
  sourceArchivePath: string | null;
  sourceRootPath: string;
  status: DeploymentStatus;
  substage: DeploymentSubstage | null;
  statusReason: string | null;
  imageTag: string | null;
  containerName: string | null;
  containerId: string | null;
  liveUrl: string | null;
  internalPort: number | null;
  railpackPlanPath: string | null;
  railpackInfoPath: string | null;
  buildStartedAt: string | null;
  buildFinishedAt: string | null;
  deployStartedAt: string | null;
  deployFinishedAt: string | null;
  runningAt: string | null;
  failedAt: string | null;
  updatedAt: string;
}>;

const deploymentColumnMap: Record<keyof DeploymentPatch, string> = {
  sourceArchivePath: 'source_archive_path',
  sourceRootPath: 'source_root_path',
  status: 'status',
  substage: 'substage',
  statusReason: 'status_reason',
  imageTag: 'image_tag',
  containerName: 'container_name',
  containerId: 'container_id',
  liveUrl: 'live_url',
  internalPort: 'internal_port',
  railpackPlanPath: 'railpack_plan_path',
  railpackInfoPath: 'railpack_info_path',
  buildStartedAt: 'build_started_at',
  buildFinishedAt: 'build_finished_at',
  deployStartedAt: 'deploy_started_at',
  deployFinishedAt: 'deploy_finished_at',
  runningAt: 'running_at',
  failedAt: 'failed_at',
  updatedAt: 'updated_at'
};

function mapDeploymentRow(row: DeploymentRow): DeploymentDetail {
  return {
    id: row.id,
    projectId: row.project_id,
    slug: row.slug,
    sourceType: row.source_type,
    sourceGitUrl: row.source_git_url,
    sourceArchiveFilename: row.source_archive_filename,
    sourceArchivePath: row.source_archive_path,
    sourceRootPath: row.source_root_path,
    status: row.status,
    substage: row.substage,
    statusReason: row.status_reason,
    imageTag: row.image_tag,
    containerName: row.container_name,
    containerId: row.container_id,
    routeMode: row.route_mode,
    routeHost: row.route_host,
    routePath: row.route_path,
    liveUrl: row.live_url,
    internalPort: row.internal_port,
    railpackPlanPath: row.railpack_plan_path,
    railpackInfoPath: row.railpack_info_path,
    buildStartedAt: row.build_started_at,
    buildFinishedAt: row.build_finished_at,
    deployStartedAt: row.deploy_started_at,
    deployFinishedAt: row.deploy_finished_at,
    runningAt: row.running_at,
    failedAt: row.failed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class DeploymentRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: DeploymentInsert): void {
    this.db
      .prepare(
        `
          INSERT INTO deployments (
            id, project_id, slug, source_type, source_git_url, source_archive_filename, source_archive_path,
            source_root_path, status, substage, status_reason, image_tag, container_name, container_id,
            route_mode, route_host, route_path, live_url, internal_port, railpack_plan_path, railpack_info_path,
            build_started_at, build_finished_at, deploy_started_at, deploy_finished_at, running_at, failed_at,
            created_at, updated_at
          ) VALUES (
            @id, @projectId, @slug, @sourceType, @sourceGitUrl, @sourceArchiveFilename, @sourceArchivePath,
            @sourceRootPath, @status, @substage, @statusReason, @imageTag, @containerName, @containerId,
            @routeMode, @routeHost, @routePath, @liveUrl, @internalPort, @railpackPlanPath, @railpackInfoPath,
            @buildStartedAt, @buildFinishedAt, @deployStartedAt, @deployFinishedAt, @runningAt, @failedAt,
            @createdAt, @updatedAt
          )
        `
      )
      .run(input);
  }

  list(query: ListDeploymentsQuery): DeploymentDetail[] {
    const filters: string[] = [];
    const parameters: unknown[] = [];

    if (query.status) {
      filters.push('status = ?');
      parameters.push(query.status);
    }

    if (query.sourceType) {
      filters.push('source_type = ?');
      parameters.push(query.sourceType);
    }

    const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = this.db
      .prepare<unknown[], DeploymentRow>(
        `
          SELECT * FROM deployments
          ${where}
          ORDER BY created_at DESC
          LIMIT ?
        `
      )
      .all(...parameters, query.limit);

    return rows.map(mapDeploymentRow);
  }

  getById(id: string): DeploymentDetail | null {
    const row = this.db
      .prepare<[string], DeploymentRow>('SELECT * FROM deployments WHERE id = ?')
      .get(id);

    return row ? mapDeploymentRow(row) : null;
  }

  requireById(id: string): DeploymentDetail {
    const deployment = this.getById(id);

    if (!deployment) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: `Deployment ${id} was not found`,
        statusCode: 404
      });
    }

    return deployment;
  }

  getOldestPending(): DeploymentDetail | null {
    const row = this.db
      .prepare<[], DeploymentRow>(
        `
          SELECT * FROM deployments
          WHERE status = 'pending'
          ORDER BY created_at ASC
          LIMIT 1
        `
      )
      .get();

    return row ? mapDeploymentRow(row) : null;
  }

  claimOldestPending(now: string): DeploymentDetail | null {
    const claim = this.db.transaction((timestamp: string): DeploymentRow | null => {
      const row = this.db
        .prepare<[], DeploymentRow>(
          `
            SELECT * FROM deployments
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT 1
          `
        )
        .get();

      if (!row) {
        return null;
      }

      const result = this.db
        .prepare(
          `
            UPDATE deployments
            SET status = 'building',
                substage = 'queued',
                status_reason = NULL,
                build_started_at = COALESCE(build_started_at, @now),
                updated_at = @now
            WHERE id = @id AND status = 'pending'
          `
        )
        .run({
          id: row.id,
          now: timestamp
        });

      if (result.changes === 0) {
        return null;
      }

      return this.db
        .prepare<[string], DeploymentRow>('SELECT * FROM deployments WHERE id = ?')
        .get(row.id) ?? null;
    });

    const claimed = claim(now);
    return claimed ? mapDeploymentRow(claimed) : null;
  }

  listByStatuses(statuses: DeploymentStatus[]): DeploymentDetail[] {
    if (statuses.length === 0) {
      return [];
    }

    const placeholders = statuses.map(() => '?').join(', ');
    const rows = this.db
      .prepare<unknown[], DeploymentRow>(
        `SELECT * FROM deployments WHERE status IN (${placeholders}) ORDER BY created_at ASC`
      )
      .all(...statuses);

    return rows.map(mapDeploymentRow);
  }

  listRunning(): DeploymentDetail[] {
    const rows = this.db
      .prepare<[], DeploymentRow>(
        `SELECT * FROM deployments WHERE status = 'running' ORDER BY created_at ASC`
      )
      .all();

    return rows.map(mapDeploymentRow);
  }

  update(id: string, patch: DeploymentPatch): void {
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined) as Array<
      [keyof DeploymentPatch, DeploymentPatch[keyof DeploymentPatch]]
    >;

    if (entries.length === 0) {
      return;
    }

    const assignments = entries.map(([key]) => `${deploymentColumnMap[key]} = ?`);
    const values = entries.map(([, value]) => value);

    this.db
      .prepare(
        `
          UPDATE deployments
          SET ${assignments.join(', ')}
          WHERE id = ?
        `
      )
      .run(...values, id);
  }
}
