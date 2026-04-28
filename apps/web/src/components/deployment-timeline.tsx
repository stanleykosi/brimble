import { isStatusEvent, isSystemEvent, type DeploymentDetail, type DeploymentEvent } from '@brimble/contracts';

export function DeploymentTimeline({
  deployment,
  events
}: {
  deployment?: DeploymentDetail;
  events: DeploymentEvent[];
}) {
  const timelineEvents = events.filter((event) => isStatusEvent(event) || isSystemEvent(event));
  const systemCodes = new Set(timelineEvents.filter(isSystemEvent).map((event) => event.payload.code));
  const statusSubstages = new Set(
    timelineEvents
      .filter(isStatusEvent)
      .map((event) => event.payload.substage)
      .filter(Boolean)
  );
  const stages = [
    {
      key: 'received',
      label: 'Received',
      isComplete: Boolean(deployment)
    },
    {
      key: 'prepared',
      label: 'Prepared',
      isComplete: systemCodes.has('RAILPACK_PREPARE_FINISHED') || Boolean(deployment?.imageTag)
    },
    {
      key: 'built',
      label: 'Built',
      isComplete: systemCodes.has('IMAGE_BUILD_FINISHED') || Boolean(deployment?.imageTag)
    },
    {
      key: 'container',
      label: 'Container Started',
      isComplete: systemCodes.has('CONTAINER_STARTED') || Boolean(deployment?.containerName)
    },
    {
      key: 'route',
      label: 'Route Attached',
      isComplete:
        statusSubstages.has('health_checking') ||
        deployment?.status === 'running' ||
        systemCodes.has('DEPLOYMENT_RUNNING')
    },
    {
      key: 'healthy',
      label: 'Healthy',
      isComplete: deployment?.status === 'running' || systemCodes.has('DEPLOYMENT_RUNNING')
    }
  ];
  const firstIncompleteIndex = stages.findIndex((stage) => !stage.isComplete);
  const activeIndex = firstIncompleteIndex === -1 ? stages.length - 1 : firstIncompleteIndex;

  return (
    <section className="panel timeline-panel">
      <div className="panel-header compact">
        <div>
          <h2>Pipeline Stages</h2>
          <p>Received through healthy ingress</p>
        </div>
      </div>

      {!deployment ? (
        <div className="empty-state">
          <p>No selected deployment yet.</p>
        </div>
      ) : (
        <>
          <ol className="pipeline-steps">
            {stages.map((stage, index) => {
              const state = stage.isComplete
                ? 'complete'
                : deployment.status === 'failed' && index === activeIndex
                  ? 'failed'
                  : index === activeIndex
                    ? 'active'
                    : 'pending';

              return (
                <li key={stage.key} className={`pipeline-step is-${state}`}>
                  <span className="pipeline-node" aria-hidden="true" />
                  <strong>{stage.label}</strong>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
