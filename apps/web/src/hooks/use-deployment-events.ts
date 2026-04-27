import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { buildBrowserApiUrl, parseStreamEvent } from '../lib/api';

type StreamState = 'idle' | 'connecting' | 'live' | 'reconnecting';

export function useDeploymentEvents(options: {
  deploymentId?: string;
  enabled: boolean;
  initialAfter: number;
}) {
  const queryClient = useQueryClient();
  const [streamState, setStreamState] = useState<StreamState>('idle');
  const [retryToken, setRetryToken] = useState(0);
  const openedKeyRef = useRef<string | null>(null);
  const latestAfterRef = useRef(0);
  const latestDeploymentIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (options.deploymentId !== latestDeploymentIdRef.current) {
      latestDeploymentIdRef.current = options.deploymentId;
      latestAfterRef.current = options.initialAfter;
      return;
    }

    latestAfterRef.current = Math.max(latestAfterRef.current, options.initialAfter);
  }, [options.deploymentId, options.initialAfter]);

  useEffect(() => {
    if (!options.enabled || !options.deploymentId) {
      setStreamState('idle');
      openedKeyRef.current = null;
      latestAfterRef.current = 0;
      return;
    }

    const streamKey = `${options.deploymentId}:${retryToken}`;
    openedKeyRef.current = streamKey;
    setStreamState('connecting');

    const url = new URL(buildBrowserApiUrl(`/deployments/${options.deploymentId}/events/stream`));
    if (latestAfterRef.current > 0) {
      url.searchParams.set('after', String(latestAfterRef.current));
    }

    const eventSource = new EventSource(url);

    eventSource.addEventListener('open', () => {
      if (openedKeyRef.current !== streamKey) {
        return;
      }

      setStreamState('live');
    });

    eventSource.addEventListener('deployment.event', (event) => {
      if (openedKeyRef.current !== streamKey) {
        return;
      }

      const parsed = parseStreamEvent((event as MessageEvent<string>).data);
      latestAfterRef.current = Math.max(latestAfterRef.current, parsed.sequence);

      queryClient.setQueryData(
        ['deployment-events', options.deploymentId],
        (current: { items: Array<{ sequence: number }>; nextAfter: number } | undefined) => {
          const items = current?.items ?? [];
          if (items.some((existing) => existing.sequence === parsed.sequence)) {
            return current;
          }

          return {
            items: [...items, parsed],
            nextAfter: Math.max(current?.nextAfter ?? 0, parsed.sequence)
          };
        }
      );

      if (parsed.eventType !== 'log') {
        void queryClient.invalidateQueries({ queryKey: ['deployments'] });
        void queryClient.invalidateQueries({ queryKey: ['deployment', options.deploymentId] });
      }
    });

    eventSource.addEventListener('error', () => {
      if (openedKeyRef.current !== streamKey) {
        return;
      }

      setStreamState('reconnecting');
    });

    return () => {
      if (openedKeyRef.current === streamKey) {
        openedKeyRef.current = null;
      }

      eventSource.close();
    };
  }, [options.deploymentId, options.enabled, queryClient, retryToken]);

  return {
    streamState,
    reconnect: () => setRetryToken((value) => value + 1)
  };
}
