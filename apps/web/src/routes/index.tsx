import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

import type { DeploymentDetail, DeploymentStatus, DeploymentSummary } from '@brimble/contracts';

import { CreateDeploymentCard } from '../components/create-deployment-card';
import { DeploymentLogPanel } from '../components/deployment-log-panel';
import { DeploymentOverviewPanel } from '../components/deployment-overview-panel';
import { DeploymentTimeline } from '../components/deployment-timeline';
import { DeploymentsTable } from '../components/deployments-table';
import {
  createDeployment,
  getDeployment,
  getDeploymentEvents,
  getPublicConfig,
  listDeployments
} from '../lib/api';
import { useDeploymentEvents } from '../hooks/use-deployment-events';

type Search = {
  deploymentId?: string;
};

export const Route = createFileRoute('/')({
  validateSearch: (search): Search => ({
    deploymentId: typeof search.deploymentId === 'string' ? search.deploymentId : undefined
  }),
  component: HomePage
});

function HomePage() {
  const navigate = useNavigate({ from: '/' });
  const queryClient = useQueryClient();
  const search = Route.useSearch();

  const publicConfigQuery = useQuery({
    queryKey: ['public-config'],
    queryFn: getPublicConfig
  });

  const deploymentsQuery = useQuery({
    queryKey: ['deployments'],
    queryFn: () => listDeployments(),
    refetchInterval: (query) => {
      const items = (query.state.data as Awaited<ReturnType<typeof listDeployments>> | undefined)?.items ?? [];
      return items.some((item) => item.status === 'pending' || item.status === 'building' || item.status === 'deploying')
        ? 2500
        : false;
    }
  });

  const selectedDeploymentId = search.deploymentId ?? deploymentsQuery.data?.items[0]?.id;
  const requireSelectedDeploymentId = () => {
    if (!selectedDeploymentId) {
      throw new Error('No deployment is selected');
    }

    return selectedDeploymentId;
  };

  const deploymentQuery = useQuery({
    queryKey: ['deployment', selectedDeploymentId],
    queryFn: () => getDeployment(requireSelectedDeploymentId()),
    enabled: Boolean(selectedDeploymentId)
  });

  const eventsQuery = useQuery({
    queryKey: ['deployment-events', selectedDeploymentId],
    queryFn: () => getDeploymentEvents(requireSelectedDeploymentId()),
    enabled: Boolean(selectedDeploymentId)
  });

  const liveEvents = useDeploymentEvents({
    deploymentId: selectedDeploymentId,
    enabled: Boolean(selectedDeploymentId && eventsQuery.data),
    initialAfter: eventsQuery.data?.nextAfter ?? 0
  });

  const createDeploymentMutation = useMutation({
    mutationFn: createDeployment,
    onSuccess: async (deployment) => {
      await queryClient.invalidateQueries({ queryKey: ['deployments'] });
      await queryClient.invalidateQueries({ queryKey: ['deployment', deployment.id] });
      navigate({
        to: '/',
        search: {
          deploymentId: deployment.id
        }
      });
    }
  });

  const mergedEvents = eventsQuery.data?.items ?? [];
  const selectedDeployment = deploymentQuery.data as DeploymentDetail | undefined;
  const deployments = deploymentsQuery.data?.items ?? [];
  const activeDeploymentCount = deployments.filter((deployment) =>
    deployment.status === 'pending' || deployment.status === 'building' || deployment.status === 'deploying'
  ).length;
  const lastRefreshTimestamp = Math.max(publicConfigQuery.dataUpdatedAt, deploymentsQuery.dataUpdatedAt);
  const lastRefreshLabel = lastRefreshTimestamp > 0
    ? new Date(lastRefreshTimestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    : 'Waiting';

  return (
    <main className="page-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <span />
          </div>
          <div>
            <h1>Brimble Control Plane</h1>
            <p>
              local <span>/</span> Caddy ingress <span>/</span> Docker runtime
            </p>
          </div>
        </div>

        <div className="header-status">
          <HealthPill tone={publicConfigQuery.isError ? 'bad' : publicConfigQuery.isSuccess ? 'good' : 'warn'}>
            {publicConfigQuery.isError ? 'API offline' : publicConfigQuery.isSuccess ? 'API healthy' : 'API checking'}
          </HealthPill>
          <HealthPill tone={publicConfigQuery.data?.controlPlaneUrl ? 'good' : 'warn'}>Caddy ingress</HealthPill>
          <HealthPill tone={activeDeploymentCount > 0 ? 'warn' : 'good'}>
            {`Worker ${activeDeploymentCount > 0 ? 'busy' : 'idle'}`}
          </HealthPill>
          <div className="refresh-chip" title="Last deployment list refresh">
            Last refresh {lastRefreshLabel}
          </div>
        </div>
      </header>

      <section className="dashboard-grid">
        <div className="dashboard-column left-column">
          <CreateDeploymentCard
            publicConfig={publicConfigQuery.data}
            isSubmitting={createDeploymentMutation.isPending}
            errorMessage={createDeploymentMutation.error instanceof Error ? createDeploymentMutation.error.message : null}
            onSubmit={async (input) => {
              await createDeploymentMutation.mutateAsync(input);
            }}
          />
          <StatusSummaryPanel items={deployments} />
        </div>

        <div className="dashboard-column center-column">
          <DeploymentsTable
            items={deployments}
            selectedDeploymentId={selectedDeploymentId}
            onSelect={(deploymentId) => {
              navigate({
                to: '/',
                search: {
                  deploymentId
                }
              });
            }}
          />
        </div>

        <div className="dashboard-column right-column">
          <DeploymentOverviewPanel deployment={selectedDeployment} />
          <DeploymentTimeline deployment={selectedDeployment} events={mergedEvents} />
        </div>
      </section>

      <section className="logs-page" aria-label="Deployment logs">
        <DeploymentLogPanel
          events={mergedEvents}
          streamState={liveEvents.streamState}
          onRetry={() => liveEvents.reconnect()}
        />
      </section>
    </main>
  );
}

function HealthPill({ children, tone }: { children: string; tone: 'good' | 'warn' | 'bad' }) {
  return (
    <span className={`health-pill health-${tone}`}>
      <span className="health-dot" />
      {children}
    </span>
  );
}

const statusSummary: Array<{
  status: DeploymentStatus;
  label: string;
  hint: string;
}> = [
  {
    status: 'pending',
    label: 'Queued',
    hint: 'waiting'
  },
  {
    status: 'building',
    label: 'Building',
    hint: 'railpack'
  },
  {
    status: 'running',
    label: 'Running',
    hint: 'live'
  },
  {
    status: 'failed',
    label: 'Failed',
    hint: 'needs attention'
  }
];

function StatusSummaryPanel({ items }: { items: DeploymentSummary[] }) {
  const counts = statusSummary.reduce<Record<DeploymentStatus, number>>(
    (current, item) => ({
      ...current,
      [item.status]: items.filter((deployment) => deployment.status === item.status).length
    }),
    {
      pending: 0,
      building: 0,
      deploying: 0,
      running: 0,
      failed: 0
    }
  );

  return (
    <section className="panel status-panel">
      <div className="panel-header compact">
        <div>
          <h2>Deployment Overview</h2>
          <p>{items.length} total deployments</p>
        </div>
      </div>
      <div className="metric-grid">
        {statusSummary.map((item) => (
          <div key={item.status} className={`metric-row metric-${item.status}`}>
            <span className="metric-icon" aria-hidden="true" />
            <div>
              <strong>{item.label}</strong>
              <span>{item.hint}</span>
            </div>
            <b>{counts[item.status]}</b>
          </div>
        ))}
      </div>
    </section>
  );
}
