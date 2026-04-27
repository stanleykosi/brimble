import { useRef, useState } from 'react';

import type { PublicConfig, RouteMode, SourceType } from '@brimble/contracts';

import { formatBytes } from '../lib/format';

export function CreateDeploymentCard(props: {
  publicConfig?: PublicConfig;
  isSubmitting: boolean;
  errorMessage: string | null;
  onSubmit: (input: {
    sourceType: SourceType;
    gitUrl?: string;
    file?: File | null;
    routeMode?: RouteMode;
  }) => Promise<void>;
}) {
  const [sourceType, setSourceType] = useState<SourceType>('git');
  const [gitUrl, setGitUrl] = useState('');
  const [routeModeOverride, setRouteModeOverride] = useState<RouteMode | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const archiveInputRef = useRef<HTMLInputElement>(null);
  const routeMode = routeModeOverride ?? props.publicConfig?.defaultRouteMode ?? 'hostname';

  return (
    <section className="panel card-create">
      <div className="panel-header compact">
        <div>
          <h2>Create Deployment</h2>
          <p>Git source or archive upload</p>
        </div>
      </div>

      <div className="panel-body">
        <div className="toggle-row">
          <button
            type="button"
            className={sourceType === 'git' ? 'toggle is-active' : 'toggle'}
            onClick={() => setSourceType('git')}
          >
            Git URL
          </button>
          <button
            type="button"
            className={sourceType === 'archive' ? 'toggle is-active' : 'toggle'}
            onClick={() => setSourceType('archive')}
          >
            Archive
          </button>
        </div>

        {sourceType === 'git' ? (
          <label className="field-group">
            <span className="field-label">Git repository URL</span>
            <input
              className="text-input"
              type="url"
              placeholder="https://github.com/your-org/brimble-sample"
              value={gitUrl}
              onChange={(event) => setGitUrl(event.target.value)}
            />
          </label>
        ) : (
          <div className="field-group">
            <span className="field-label">Upload archive</span>
            <input
              ref={archiveInputRef}
              className="file-input-hidden"
              type="file"
              accept={props.publicConfig?.acceptedArchiveExtensions.join(',') ?? '.zip,.tar.gz,.tgz'}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              className="archive-dropzone"
              onClick={() => archiveInputRef.current?.click()}
            >
              <span className="upload-mark" aria-hidden="true" />
              <strong>{file ? file.name : 'Choose .tgz, .tar.gz, or .zip'}</strong>
              <small>
                Max {formatBytes(props.publicConfig?.uploadMaxBytes ?? 104857600)}
              </small>
            </button>
          </div>
        )}

        <label className="field-group">
          <span className="field-label">Route mode</span>
          <select
            className="text-input"
            value={routeMode}
            onChange={(event) => setRouteModeOverride(event.target.value as RouteMode)}
          >
            <option value="hostname">Hostname</option>
            <option value="path">Path</option>
          </select>
        </label>

        {(localError || props.errorMessage) ? <p className="error-text">{localError ?? props.errorMessage}</p> : null}

        <button
          type="button"
          className="primary-button"
          disabled={props.isSubmitting}
          onClick={async () => {
            setLocalError(null);

            if (sourceType === 'git' && !gitUrl.trim()) {
              setLocalError('Git deployments require a public repository URL.');
              return;
            }

            if (sourceType === 'archive' && !file) {
              setLocalError('Archive deployments require an uploaded file.');
              return;
            }

            await props.onSubmit({
              sourceType,
              gitUrl: sourceType === 'git' ? gitUrl.trim() : undefined,
              file: sourceType === 'archive' ? file : null,
              routeMode: routeModeOverride ?? props.publicConfig?.defaultRouteMode
            });

            if (sourceType === 'git') {
              setGitUrl('');
            } else {
              setFile(null);
              if (archiveInputRef.current) {
                archiveInputRef.current.value = '';
              }
            }
          }}
        >
          {props.isSubmitting ? 'Creating...' : 'Deploy'}
        </button>

        <p className="source-support">
          Supported sources: public HTTPS Git repositories and uploaded archives.
        </p>
      </div>
    </section>
  );
}
