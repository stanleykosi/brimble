import type { DeploymentDetail } from '@brimble/contracts';

import { formatTimestamp } from '../lib/format';
import { StatusBadge } from './status-badge';

export function DeploymentOverviewPanel({ deployment }: { deployment?: DeploymentDetail }) {
  return (
    <section className="panel detail-panel">
      <div className="panel-header compact">
        <div>
          <h2>Deployment Details</h2>
          <p>{deployment ? 'Selected runtime and route metadata' : 'Choose a deployment to inspect'}</p>
        </div>
        {deployment ? <StatusBadge status={deployment.status} /> : null}
      </div>

      {!deployment ? (
        <div className="empty-state">
          <p>Select a deployment to inspect its status, image, route, and runtime metadata.</p>
        </div>
      ) : (
        <div className="deployment-detail-body">
          <div className="deployment-detail-title">
            <span className={`status-dot-small status-dot-${deployment.status}`} aria-hidden="true" />
            <div>
              <strong>{deployment.slug}</strong>
              <span>{deployment.substage ?? 'waiting for worker'}</span>
            </div>
          </div>

          <dl className="definition-grid">
            <div>
              <dt>Status</dt>
              <dd>{deployment.status}</dd>
            </div>
            <div>
              <dt>Live URL</dt>
              <dd>
                {deployment.liveUrl ? (
                  <a href={deployment.liveUrl} target="_blank" rel="noreferrer">
                    {deployment.liveUrl}
                  </a>
                ) : (
                  'Pending route'
                )}
              </dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{deployment.sourceType === 'git' ? 'Git URL' : 'Archive'}</dd>
            </div>
            <div>
              <dt>Ingress</dt>
              <dd>{deployment.routeMode === 'hostname' ? deployment.routeHost : deployment.routePath}</dd>
            </div>
            <div>
              <dt>Image tag</dt>
              <dd>{deployment.imageTag ?? 'Pending build'}</dd>
            </div>
            <div>
              <dt>Container</dt>
              <dd>{deployment.containerName ?? 'Pending runtime'}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatTimestamp(deployment.createdAt)}</dd>
            </div>
            <div>
              <dt>Running at</dt>
              <dd>{formatTimestamp(deployment.runningAt)}</dd>
            </div>
            {deployment.statusReason ? (
              <div className="definition-span">
                <dt>Failure reason</dt>
                <dd className="error-text">{deployment.statusReason}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      )}
    </section>
  );
}
