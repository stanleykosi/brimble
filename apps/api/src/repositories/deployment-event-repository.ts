import type {
  DeploymentEvent,
  DeploymentEventPhase,
  DeploymentEventStream,
  DeploymentEventType,
  DeploymentLogPayload,
  DeploymentStatusPayload,
  DeploymentSystemPayload
} from '@brimble/contracts';
import type Database from 'better-sqlite3';

interface DeploymentEventRow {
  sequence: number;
  event_type: DeploymentEventType;
  phase: DeploymentEventPhase | null;
  stream: DeploymentEventStream | null;
  payload_json: string;
  created_at: string;
}

type DeploymentEventPayload = DeploymentLogPayload | DeploymentStatusPayload | DeploymentSystemPayload;

function mapEventRow(row: DeploymentEventRow): DeploymentEvent {
  return {
    sequence: row.sequence,
    eventType: row.event_type,
    phase: row.phase,
    stream: row.stream,
    payload: JSON.parse(row.payload_json) as DeploymentEventPayload,
    createdAt: row.created_at
  };
}

export class DeploymentEventRepository {
  private readonly appendTransaction;

  constructor(private readonly db: Database.Database) {
    this.appendTransaction = this.db.transaction(
      (
        deploymentId: string,
        eventType: DeploymentEventType,
        phase: DeploymentEventPhase | null,
        stream: DeploymentEventStream | null,
        payload: DeploymentEventPayload,
        createdAt: string
      ): DeploymentEvent => {
        const nextRow = this.db
          .prepare<[string], { nextSequence: number }>(
            `
              SELECT COALESCE(MAX(sequence), 0) + 1 AS nextSequence
              FROM deployment_events
              WHERE deployment_id = ?
            `
          )
          .get(deploymentId);

        const sequence = nextRow?.nextSequence ?? 1;

        this.db
          .prepare(
            `
              INSERT INTO deployment_events (
                deployment_id,
                sequence,
                event_type,
                phase,
                stream,
                payload_json,
                created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `
          )
          .run(
            deploymentId,
            sequence,
            eventType,
            phase,
            stream,
            JSON.stringify(payload),
            createdAt
          );

        const inserted = this.db
          .prepare<[string, number], DeploymentEventRow>(
            `
              SELECT sequence, event_type, phase, stream, payload_json, created_at
              FROM deployment_events
              WHERE deployment_id = ? AND sequence = ?
            `
          )
          .get(deploymentId, sequence);

        return mapEventRow(inserted!);
      }
    );
  }

  append(
    deploymentId: string,
    eventType: DeploymentEventType,
    phase: DeploymentEventPhase | null,
    stream: DeploymentEventStream | null,
    payload: DeploymentEventPayload,
    createdAt: string
  ): DeploymentEvent {
    return this.appendTransaction(deploymentId, eventType, phase, stream, payload, createdAt);
  }

  list(deploymentId: string, after = 0, limit = 500): DeploymentEvent[] {
    const rows = this.db
      .prepare<[string, number, number], DeploymentEventRow>(
        `
          SELECT sequence, event_type, phase, stream, payload_json, created_at
          FROM deployment_events
          WHERE deployment_id = ? AND sequence > ?
          ORDER BY sequence ASC
          LIMIT ?
        `
      )
      .all(deploymentId, after, limit);

    return rows.map(mapEventRow);
  }

  getLatestSequence(deploymentId: string): number {
    const row = this.db
      .prepare<[string], { latestSequence: number | null }>(
        `
          SELECT MAX(sequence) AS latestSequence
          FROM deployment_events
          WHERE deployment_id = ?
        `
      )
      .get(deploymentId);

    return row?.latestSequence ?? 0;
  }
}
