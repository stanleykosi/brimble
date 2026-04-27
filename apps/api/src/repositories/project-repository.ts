import type Database from 'better-sqlite3';

const LOCAL_PROJECT_ID = 'project_local';
const LOCAL_PROJECT_NAME = 'Local Brimble Project';
const LOCAL_PROJECT_SLUG = 'local';

export class ProjectRepository {
  constructor(private readonly db: Database.Database) {}

  ensureSeedProject(): void {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
          INSERT INTO projects (id, name, slug, created_at, updated_at)
          VALUES (@id, @name, @slug, @createdAt, @updatedAt)
          ON CONFLICT(id) DO NOTHING
        `
      )
      .run({
        id: LOCAL_PROJECT_ID,
        name: LOCAL_PROJECT_NAME,
        slug: LOCAL_PROJECT_SLUG,
        createdAt: now,
        updatedAt: now
      });
  }

  getLocalProjectId(): string {
    return LOCAL_PROJECT_ID;
  }

  getLocalProjectSlug(): string {
    return LOCAL_PROJECT_SLUG;
  }
}
