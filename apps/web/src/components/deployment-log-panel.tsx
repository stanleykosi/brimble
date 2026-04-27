import { useEffect, useMemo, useRef, useState } from 'react';

import type { DeploymentEvent } from '@brimble/contracts';

import { isLogEvent } from '../lib/deployment-events';
import { formatLogTimestamp } from '../lib/format';

export function DeploymentLogPanel(props: {
  events: DeploymentEvent[];
  streamState: 'idle' | 'connecting' | 'live' | 'reconnecting';
  onRetry: () => void;
}) {
  const logRef = useRef<HTMLDivElement | null>(null);
  const [filterText, setFilterText] = useState('');
  const logEvents = useMemo(() => props.events.filter(isLogEvent), [props.events]);
  const filteredLogEvents = useMemo(() => {
    const query = filterText.trim().toLowerCase();
    if (!query) {
      return logEvents;
    }

    return logEvents.filter((event) => {
      const searchable = [
        String(event.sequence),
        event.phase ?? '',
        event.stream ?? '',
        event.payload.message
      ].join(' ').toLowerCase();

      return searchable.includes(query);
    });
  }, [filterText, logEvents]);

  useEffect(() => {
    const element = logRef.current;
    if (!element) {
      return;
    }

    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distanceFromBottom < 180) {
      requestAnimationFrame(() => {
        element.scrollTop = element.scrollHeight;
      });
    }
  }, [filteredLogEvents]);

  function downloadLogs() {
    const lines = logEvents.map((event) => {
      const sequence = String(event.sequence).padStart(4, '0');
      return `[${event.createdAt}] #${sequence} ${event.phase ?? 'system'} ${event.stream ?? 'meta'} ${event.payload.message}`;
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = 'deployment-logs.txt';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="panel panel-logs">
      <div className="panel-header logs-header">
        <div>
          <h2>Live Logs</h2>
          <p>Persisted history + SSE tail</p>
        </div>
        <div className="log-controls">
          <input
            className="log-filter"
            type="search"
            placeholder="Filter logs"
            value={filterText}
            onChange={(event) => setFilterText(event.target.value)}
          />
          <button type="button" className="icon-button" disabled={logEvents.length === 0} onClick={downloadLogs}>
            Download
          </button>
          {props.streamState === 'reconnecting' ? (
            <button type="button" className="retry-button" onClick={props.onRetry}>
              Retry
            </button>
          ) : null}
        </div>
      </div>

      <div className="stream-state">
        <span className={`stream-dot stream-${props.streamState}`} />
        <strong>{props.streamState}</strong>
      </div>

      <div ref={logRef} className="log-output">
        {filteredLogEvents.length === 0 ? (
          <p className="log-empty">Deployment logs will appear here as the pipeline runs.</p>
        ) : (
          filteredLogEvents.map((event) => (
            <div key={event.sequence} className={`log-line stream-${event.stream ?? 'meta'}`}>
              <span className="log-time">[{formatLogTimestamp(event.createdAt)}]</span>
              <span className="log-sequence">#{String(event.sequence).padStart(4, '0')}</span>
              <span className="log-phase">{event.phase ?? 'system'}</span>
              <span className="log-stream">{event.stream ?? 'meta'}</span>
              <span className="log-message">{event.payload.message}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
