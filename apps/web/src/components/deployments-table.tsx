import type { DeploymentSummary } from '@brimble/contracts';

import { formatShortTimestamp } from '../lib/format';
import { StatusBadge } from './status-badge';

export function DeploymentsTable(props: {
  items: DeploymentSummary[];
  selectedDeploymentId?: string;
  onSelect: (deploymentId: string) => void;
}) {
  return (
    <section className="panel panel-table">
      <div className="panel-header compact">
        <div>
          <h2>Recent Deployments</h2>
          <p>Newest first, persisted in SQLite</p>
        </div>
        <span className="count-chip">{props.items.length}</span>
      </div>

      {props.items.length === 0 ? (
        <div className="empty-state">
          <p>No deployments yet.</p>
          <span>Create one from Git or an archive to start the pipeline.</span>
        </div>
      ) : (
        <div className="deployment-table-wrap">
          <table className="deployment-table">
            <thead>
              <tr>
                <th>App</th>
                <th>Source</th>
                <th>Status</th>
                <th>Image</th>
                <th>URL</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {props.items.map((item) => (
                <tr key={item.id} className={item.id === props.selectedDeploymentId ? 'is-selected' : undefined}>
                  <td title={item.slug}>
                    <button
                      type="button"
                      className="deployment-name-button"
                      onClick={() => props.onSelect(item.id)}
                    >
                      <span className="selected-dot" aria-hidden="true" />
                      <strong>{item.slug}</strong>
                      {item.statusReason ? <small>{item.statusReason}</small> : null}
                    </button>
                  </td>
                  <td>{item.sourceType === 'git' ? 'Git' : 'Archive'}</td>
                  <td>
                    <StatusBadge status={item.status} />
                  </td>
                  <td className="mono-cell" title={item.imageTag ?? 'pending'}>{item.imageTag ?? 'pending'}</td>
                  <td className="url-cell" title={item.liveUrl ?? 'pending'}>
                    {item.liveUrl ? (
                      <a href={item.liveUrl} target="_blank" rel="noreferrer">
                        {item.liveUrl}
                      </a>
                    ) : (
                      'pending'
                    )}
                  </td>
                  <td>{formatShortTimestamp(item.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
