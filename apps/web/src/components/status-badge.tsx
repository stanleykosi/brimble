import type { DeploymentStatus } from '@brimble/contracts';

export function StatusBadge({ status }: { status: DeploymentStatus }) {
  return <span className={`status-badge status-${status}`}>{status}</span>;
}
