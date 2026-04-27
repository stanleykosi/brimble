import {
  deploymentDetailSchema,
  deploymentEventSchema,
  deploymentEventsResponseSchema,
  listDeploymentsResponseSchema,
  publicConfigSchema,
  type DeploymentDetail,
  type DeploymentEvent,
  type DeploymentEventsResponse,
  type ListDeploymentsResponse,
  type PublicConfig
} from '@brimble/contracts';

const apiBase = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/+$/, '');

interface ApiErrorPayload {
  error?: {
    message?: string;
  };
}

async function requestJson<T>(input: RequestInfo, schema: { parse: (value: unknown) => T }, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
    throw new Error(payload?.error?.message ?? `Request failed with status ${response.status}`);
  }

  return schema.parse(await response.json());
}

export function buildApiPath(pathname: string): string {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${apiBase}${normalizedPath}`;
}

export function buildBrowserApiUrl(pathname: string): string {
  return new URL(buildApiPath(pathname), window.location.origin).toString();
}

export async function getPublicConfig(): Promise<PublicConfig> {
  return await requestJson(buildApiPath('/public-config'), publicConfigSchema);
}

export async function listDeployments(): Promise<ListDeploymentsResponse> {
  return await requestJson(buildApiPath('/deployments'), listDeploymentsResponseSchema);
}

export async function getDeployment(id: string): Promise<DeploymentDetail> {
  return await requestJson(buildApiPath(`/deployments/${id}`), deploymentDetailSchema);
}

export async function getDeploymentEvents(id: string): Promise<DeploymentEventsResponse> {
  return await requestJson(buildApiPath(`/deployments/${id}/events`), deploymentEventsResponseSchema);
}

export async function createDeployment(input: {
  sourceType: 'git' | 'archive';
  gitUrl?: string;
  file?: File | null;
  routeMode?: 'hostname' | 'path';
}): Promise<DeploymentDetail> {
  const formData = new FormData();
  formData.set('sourceType', input.sourceType);

  if (input.gitUrl) {
    formData.set('gitUrl', input.gitUrl);
  }

  if (input.routeMode) {
    formData.set('routeMode', input.routeMode);
  }

  if (input.file) {
    formData.set('archiveFile', input.file);
  }

  return await requestJson(buildApiPath('/deployments'), deploymentDetailSchema, {
    method: 'POST',
    body: formData
  });
}

export function parseStreamEvent(payload: string): DeploymentEvent {
  return deploymentEventSchema.parse(JSON.parse(payload));
}
