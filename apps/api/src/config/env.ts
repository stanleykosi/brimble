import path from 'node:path';

import { acceptedArchiveExtensions, routeModeSchema, type PublicConfig } from '@brimble/contracts';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  APP_PORT: z.coerce.number().int().positive().default(3001),
  SQLITE_PATH: z.string().min(1).default('/data/db/app.sqlite'),
  STORAGE_ROOT: z.string().min(1).default('/data'),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(104857600),
  PIPELINE_MAX_CONCURRENCY: z.coerce.number().int().positive().default(1),
  DEFAULT_ROUTE_MODE: routeModeSchema.default('hostname'),
  HOSTNAME_SUFFIX: z.string().min(1).default('localhost'),
  CONTROL_PLANE_PUBLIC_URL: z.string().url().default('http://localhost:8080'),
  DEPLOY_DEFAULT_PORT: z.coerce.number().int().positive().default(3000),
  DEPLOY_HEALTHCHECK_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  DEPLOY_HEALTHCHECK_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  CADDY_ADMIN_URL: z.string().url().default('http://caddy:2019'),
  APP_NETWORK_NAME: z.string().min(1).default('brimble_local_network'),
  RAILPACK_FRONTEND_IMAGE: z.string().min(1).default('ghcr.io/railwayapp/railpack-frontend'),
  KEEP_WORKSPACES: z
    .string()
    .transform((value) => value !== 'false')
    .default('true'),
  VITE_API_BASE: z.string().min(1).default('/api')
});

export type AppConfig = z.infer<typeof envSchema> & {
  acceptedArchiveExtensions: string[];
};

export function getPublishedControlPlaneUrl(
  config: Pick<AppConfig, 'CONTROL_PLANE_PUBLIC_URL'>
): string {
  const url = new URL(config.CONTROL_PLANE_PUBLIC_URL);
  url.protocol = 'http:';
  url.port = '8080';
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);

  return {
    ...parsed,
    SQLITE_PATH: path.resolve(parsed.SQLITE_PATH),
    STORAGE_ROOT: path.resolve(parsed.STORAGE_ROOT),
    acceptedArchiveExtensions: [...acceptedArchiveExtensions]
  };
}

export function toPublicConfig(config: AppConfig): PublicConfig {
  return {
    controlPlaneUrl: getPublishedControlPlaneUrl(config),
    defaultRouteMode: config.DEFAULT_ROUTE_MODE,
    hostnameSuffix: config.HOSTNAME_SUFFIX,
    uploadMaxBytes: config.UPLOAD_MAX_BYTES,
    acceptedArchiveExtensions: config.acceptedArchiveExtensions
  };
}
