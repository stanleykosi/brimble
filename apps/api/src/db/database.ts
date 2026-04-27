import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import Database from 'better-sqlite3';

import type { AppConfig } from '../config/env.js';

const migrations: Array<{ id: string; sql: string }> = [
  {
    id: '001_initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS deployments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        slug TEXT NOT NULL UNIQUE,
        source_type TEXT NOT NULL,
        source_git_url TEXT,
        source_archive_filename TEXT,
        source_archive_path TEXT,
        source_root_path TEXT NOT NULL,
        status TEXT NOT NULL,
        substage TEXT,
        status_reason TEXT,
        image_tag TEXT,
        container_name TEXT,
        container_id TEXT,
        route_mode TEXT NOT NULL,
        route_host TEXT,
        route_path TEXT,
        live_url TEXT,
        internal_port INTEGER,
        railpack_plan_path TEXT,
        railpack_info_path TEXT,
        build_started_at TEXT,
        build_finished_at TEXT,
        deploy_started_at TEXT,
        deploy_finished_at TEXT,
        running_at TEXT,
        failed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_deployments_created_at ON deployments(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);
      CREATE INDEX IF NOT EXISTS idx_deployments_project_created_at ON deployments(project_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS deployment_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        deployment_id TEXT NOT NULL REFERENCES deployments(id),
        sequence INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        phase TEXT,
        stream TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(deployment_id, sequence)
      );

      CREATE INDEX IF NOT EXISTS idx_deployment_events_sequence ON deployment_events(deployment_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_deployment_events_created_at ON deployment_events(deployment_id, created_at);
    `
  }
];

export async function createDatabase(config: AppConfig): Promise<Database.Database> {
  await mkdir(path.dirname(config.SQLITE_PATH), { recursive: true });

  const db = new Database(config.SQLITE_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedIds = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: string }>).map((row) => row.id)
  );

  const recordMigration = db.prepare(
    'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)'
  );

  for (const migration of migrations) {
    if (appliedIds.has(migration.id)) {
      continue;
    }

    const transaction = db.transaction(() => {
      db.exec(migration.sql);
      recordMigration.run(migration.id, new Date().toISOString());
    });

    transaction();
  }

  return db;
}
