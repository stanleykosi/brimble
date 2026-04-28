import { z } from 'zod';

export const acceptedArchiveExtensions = ['.zip', '.tar.gz', '.tgz'] as const;
export const deploymentStatuses = [
  'pending',
  'building',
  'deploying',
  'running',
  'failed'
] as const;
export const deploymentSubstages = [
  'queued',
  'source_fetching',
  'source_unpacking',
  'source_ready',
  'railpack_preparing',
  'image_building',
  'container_starting',
  'route_configuring',
  'health_checking',
  'cleanup',
  'complete'
] as const;
export const routeModes = ['hostname', 'path'] as const;
export const sourceTypes = ['git', 'archive'] as const;
export const deploymentEventTypes = ['log', 'status', 'system'] as const;
export const deploymentEventPhases = [
  'prepare',
  'build',
  'deploy',
  'runtime',
  'system'
] as const;
export const deploymentEventStreams = ['stdout', 'stderr', 'meta'] as const;
export const deploymentErrorCodes = [
  'VALIDATION_ERROR',
  'SOURCE_FETCH_FAILED',
  'SOURCE_EXTRACT_FAILED',
  'RAILPACK_PREPARE_FAILED',
  'IMAGE_BUILD_FAILED',
  'IMAGE_INSPECT_FAILED',
  'CONTAINER_START_FAILED',
  'CADDY_LOAD_FAILED',
  'HEALTHCHECK_TIMEOUT',
  'PIPELINE_INTERRUPTED_BY_RESTART'
] as const;

export type AcceptedArchiveExtension = (typeof acceptedArchiveExtensions)[number];
export type DeploymentStatus = (typeof deploymentStatuses)[number];
export type DeploymentSubstage = (typeof deploymentSubstages)[number];
export type RouteMode = (typeof routeModes)[number];
export type SourceType = (typeof sourceTypes)[number];
export type DeploymentEventType = (typeof deploymentEventTypes)[number];
export type DeploymentEventPhase = (typeof deploymentEventPhases)[number];
export type DeploymentEventStream = (typeof deploymentEventStreams)[number];
export type DeploymentErrorCode = (typeof deploymentErrorCodes)[number];

export const deploymentStatusSchema = z.enum(deploymentStatuses);
export const deploymentSubstageSchema = z.enum(deploymentSubstages);
export const routeModeSchema = z.enum(routeModes);
export const sourceTypeSchema = z.enum(sourceTypes);
export const deploymentEventTypeSchema = z.enum(deploymentEventTypes);
export const deploymentEventPhaseSchema = z.enum(deploymentEventPhases);
export const deploymentEventStreamSchema = z.enum(deploymentEventStreams);
export const deploymentErrorCodeSchema = z.enum(deploymentErrorCodes);

export const publicConfigSchema = z.object({
  controlPlaneUrl: z.string().url(),
  defaultRouteMode: routeModeSchema,
  hostnameSuffix: z.string().min(1),
  uploadMaxBytes: z.number().int().positive(),
  acceptedArchiveExtensions: z.array(z.string().min(1))
});

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  time: z.string().datetime(),
  version: z.string().min(1)
});

export const errorResponseSchema = z.object({
  error: z.object({
    code: deploymentErrorCodeSchema.or(z.literal('VALIDATION_ERROR')),
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).nullable().optional()
  })
});

export const deploymentLogPayloadSchema = z.object({
  message: z.string(),
  chunk: z.boolean().default(false)
});

export const deploymentStatusPayloadSchema = z.object({
  fromStatus: deploymentStatusSchema.nullable(),
  toStatus: deploymentStatusSchema,
  substage: deploymentSubstageSchema.nullable(),
  reason: z.string().nullable()
});

export const deploymentSystemPayloadSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  data: z.record(z.string(), z.unknown()).optional()
});

export const deploymentEventPayloadSchema = z.union([
  deploymentSystemPayloadSchema,
  deploymentStatusPayloadSchema,
  deploymentLogPayloadSchema
]);

const deploymentBaseSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  sourceType: sourceTypeSchema,
  sourceGitUrl: z.string().url().nullable(),
  sourceArchiveFilename: z.string().nullable(),
  status: deploymentStatusSchema,
  substage: deploymentSubstageSchema.nullable(),
  statusReason: z.string().nullable(),
  imageTag: z.string().nullable(),
  liveUrl: z.string().url().nullable(),
  routeMode: routeModeSchema,
  routeHost: z.string().nullable(),
  routePath: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const deploymentSummarySchema = deploymentBaseSchema.extend({
  runningAt: z.string().datetime().nullable()
});

export const deploymentDetailSchema = deploymentBaseSchema.extend({
  projectId: z.string().min(1),
  sourceArchivePath: z.string().nullable(),
  sourceRootPath: z.string().min(1),
  containerName: z.string().nullable(),
  containerId: z.string().nullable(),
  internalPort: z.number().int().positive().nullable(),
  railpackPlanPath: z.string().nullable(),
  railpackInfoPath: z.string().nullable(),
  buildStartedAt: z.string().datetime().nullable(),
  buildFinishedAt: z.string().datetime().nullable(),
  deployStartedAt: z.string().datetime().nullable(),
  deployFinishedAt: z.string().datetime().nullable(),
  runningAt: z.string().datetime().nullable(),
  failedAt: z.string().datetime().nullable()
});

export const deploymentEventSchema = z.object({
  sequence: z.number().int().nonnegative(),
  eventType: deploymentEventTypeSchema,
  phase: deploymentEventPhaseSchema.nullable(),
  stream: deploymentEventStreamSchema.nullable(),
  payload: deploymentEventPayloadSchema,
  createdAt: z.string().datetime()
});

export const listDeploymentsResponseSchema = z.object({
  items: z.array(deploymentSummarySchema)
});

export const deploymentEventsResponseSchema = z.object({
  items: z.array(deploymentEventSchema),
  nextAfter: z.number().int().nonnegative()
});

export const listDeploymentsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50),
  status: deploymentStatusSchema.optional(),
  sourceType: sourceTypeSchema.optional()
});

export const deploymentEventsQuerySchema = z.object({
  after: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(2000).default(500)
});

export const createDeploymentFieldsSchema = z
  .object({
    sourceType: sourceTypeSchema,
    gitUrl: z.string().trim().url().optional(),
    routeMode: routeModeSchema.optional()
  })
  .superRefine((value, ctx) => {
    if (value.sourceType === 'git' && !value.gitUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'gitUrl is required when sourceType=git',
        path: ['gitUrl']
      });
    }
  });

export const nonTerminalStatuses = ['pending', 'building', 'deploying'] as const;

export type PublicConfig = z.infer<typeof publicConfigSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type DeploymentLogPayload = z.infer<typeof deploymentLogPayloadSchema>;
export type DeploymentStatusPayload = z.infer<typeof deploymentStatusPayloadSchema>;
export type DeploymentSystemPayload = z.infer<typeof deploymentSystemPayloadSchema>;
export type DeploymentEventPayload = z.infer<typeof deploymentEventPayloadSchema>;
export type DeploymentEvent = z.infer<typeof deploymentEventSchema>;
export type DeploymentLogEvent = DeploymentEvent & {
  eventType: 'log';
  payload: DeploymentLogPayload;
};
export type DeploymentStatusEvent = DeploymentEvent & {
  eventType: 'status';
  payload: DeploymentStatusPayload;
};
export type DeploymentSystemEvent = DeploymentEvent & {
  eventType: 'system';
  payload: DeploymentSystemPayload;
};
export type DeploymentSummary = z.infer<typeof deploymentSummarySchema>;
export type DeploymentDetail = z.infer<typeof deploymentDetailSchema>;
export type ListDeploymentsResponse = z.infer<typeof listDeploymentsResponseSchema>;
export type DeploymentEventsResponse = z.infer<typeof deploymentEventsResponseSchema>;
export type ListDeploymentsQuery = z.infer<typeof listDeploymentsQuerySchema>;
export type DeploymentEventsQuery = z.infer<typeof deploymentEventsQuerySchema>;
export type CreateDeploymentFields = z.infer<typeof createDeploymentFieldsSchema>;

export function isNonTerminalStatus(status: DeploymentStatus): boolean {
  return nonTerminalStatuses.includes(status as (typeof nonTerminalStatuses)[number]);
}

export function isLogEvent(event: DeploymentEvent): event is DeploymentLogEvent {
  return event.eventType === 'log';
}

export function isStatusEvent(event: DeploymentEvent): event is DeploymentStatusEvent {
  return event.eventType === 'status';
}

export function isSystemEvent(event: DeploymentEvent): event is DeploymentSystemEvent {
  return event.eventType === 'system';
}
