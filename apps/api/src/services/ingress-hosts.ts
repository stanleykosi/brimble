import type { AppConfig } from '../config/env.js';

function dedupeHosts(hosts: string[]): string[] {
  return [...new Set(hosts.filter(Boolean))];
}

export function getIngressHosts(config: Pick<AppConfig, 'CONTROL_PLANE_PUBLIC_URL'>): string[] {
  const hostname = new URL(config.CONTROL_PLANE_PUBLIC_URL).hostname;

  if (hostname === 'localhost') {
    return dedupeHosts([hostname, '127.0.0.1']);
  }

  if (hostname === '127.0.0.1') {
    return dedupeHosts([hostname, 'localhost']);
  }

  return [hostname];
}

export function getPrimaryIngressHost(config: Pick<AppConfig, 'CONTROL_PLANE_PUBLIC_URL'>): string {
  return getIngressHosts(config)[0] ?? 'localhost';
}
