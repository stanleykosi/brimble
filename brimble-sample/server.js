const http = require('node:http');
const os = require('node:os');

const port = Number(process.env.PORT || 3000);
const startedAt = new Date();
let requestCount = 0;
let sseClientCount = 0;
let eventSequence = 0;

const routes = [
  { method: 'GET', path: '/', purpose: 'interactive status page' },
  { method: 'GET', path: '/healthz', purpose: 'container health check' },
  { method: 'GET', path: '/api/runtime', purpose: 'runtime and ingress metadata' },
  { method: 'GET', path: '/api/checks', purpose: 'lightweight backend checks' },
  { method: 'GET', path: '/api/events', purpose: 'server-sent runtime heartbeat' },
  { method: 'POST', path: '/api/echo', purpose: 'request body round-trip probe' }
];

function json(res, statusCode, value) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function notFound(res, path) {
  json(res, 404, {
    error: 'Not Found',
    path,
    availableRoutes: routes
  });
}

function runtimeSnapshot(req) {
  const memory = process.memoryUsage();
  const uptimeSeconds = Math.round((Date.now() - startedAt.getTime()) / 1000);

  return {
    status: 'ok',
    service: 'brimble-sample',
    startedAt: startedAt.toISOString(),
    uptimeSeconds,
    port,
    pid: process.pid,
    nodeVersion: process.version,
    platform: `${process.platform}/${process.arch}`,
    hostname: os.hostname(),
    requestCount,
    sseClientCount,
    memory: {
      rssMb: Math.round(memory.rss / 1024 / 1024),
      heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024)
    },
    ingress: {
      host: req.headers.host || null,
      forwardedHost: req.headers['x-forwarded-host'] || null,
      forwardedProto: req.headers['x-forwarded-proto'] || null,
      forwardedFor: req.headers['x-forwarded-for'] || null
    },
    routes
  };
}

function health(req) {
  const snapshot = runtimeSnapshot(req);
  return {
    status: 'ok',
    service: snapshot.service,
    startedAt: snapshot.startedAt,
    uptimeSeconds: snapshot.uptimeSeconds,
    port: snapshot.port,
    checks: {
      process: 'ok',
      http: 'ok',
      sse: 'ready'
    }
  };
}

function checks(req) {
  const snapshot = runtimeSnapshot(req);
  return {
    status: 'ok',
    checkedAt: new Date().toISOString(),
    checks: [
      {
        name: 'runtime',
        status: 'pass',
        detail: `${snapshot.platform} on Node ${snapshot.nodeVersion}`
      },
      {
        name: 'ingress',
        status: snapshot.ingress.host ? 'pass' : 'warn',
        detail: snapshot.ingress.host || 'no host header observed'
      },
      {
        name: 'port',
        status: 'pass',
        detail: `listening on ${snapshot.port}`
      },
      {
        name: 'events',
        status: 'pass',
        detail: `${snapshot.sseClientCount} active SSE client(s)`
      }
    ]
  };
}

function streamEvents(req, res) {
  sseClientCount += 1;

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  });

  function send(event, value) {
    eventSequence += 1;
    res.write(`id: ${eventSequence}\n`);
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(value)}\n\n`);
  }

  send('runtime.ready', runtimeSnapshot(req));

  const interval = setInterval(() => {
    send('runtime.tick', {
      time: new Date().toISOString(),
      uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
      requestCount,
      sseClientCount,
      rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024)
    });
  }, 1500);

  req.on('close', () => {
    clearInterval(interval);
    sseClientCount = Math.max(0, sseClientCount - 1);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new Error('Request body limit exceeded'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function html() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Brimble Sample Infra Probe</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f6f8;
        --panel: #ffffff;
        --ink: #18202a;
        --muted: #667085;
        --line: #d7dde5;
        --teal: #0f766e;
        --blue: #3157d5;
        --amber: #b7791f;
        --red: #b42318;
        --green-soft: #e7f6f2;
        --blue-soft: #e9efff;
        --amber-soft: #fff4d7;
        --shadow: 0 16px 44px rgba(24, 32, 42, 0.10);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
        background:
          linear-gradient(180deg, #f8fafc 0%, var(--bg) 44%, #eef2f7 100%);
        color: var(--ink);
      }

      button,
      input,
      textarea {
        font: inherit;
      }

      .shell {
        width: min(1180px, calc(100% - 32px));
        margin: 0 auto;
        padding: 28px 0 36px;
      }

      header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 20px;
        padding: 20px 0 24px;
      }

      .title {
        display: grid;
        gap: 8px;
      }

      .eyebrow {
        margin: 0;
        color: var(--teal);
        font-size: 0.84rem;
        font-weight: 800;
        text-transform: uppercase;
      }

      h1 {
        margin: 0;
        font-size: 2.55rem;
        line-height: 1.02;
      }

      .subhead {
        max-width: 720px;
        margin: 0;
        color: var(--muted);
        font-size: 1rem;
        line-height: 1.55;
      }

      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        min-height: 40px;
        padding: 0 14px;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: var(--panel);
        box-shadow: var(--shadow);
        color: var(--ink);
        white-space: nowrap;
      }

      .dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: var(--amber);
      }

      .dot.live {
        background: var(--teal);
      }

      .grid {
        display: grid;
        grid-template-columns: 1.12fr 0.88fr;
        gap: 16px;
      }

      .panel {
        min-width: 0;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.92);
        box-shadow: var(--shadow);
      }

      .panel-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 16px 18px;
        border-bottom: 1px solid var(--line);
      }

      h2 {
        margin: 0;
        font-size: 1rem;
      }

      .panel-body {
        padding: 18px;
      }

      .topology {
        display: grid;
        grid-template-columns: repeat(4, minmax(110px, 1fr));
        gap: 12px;
        position: relative;
      }

      .node {
        min-height: 128px;
        display: grid;
        align-content: space-between;
        padding: 14px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #fbfcfe;
      }

      .node strong {
        display: block;
        font-size: 0.98rem;
      }

      .node span {
        display: block;
        margin-top: 6px;
        color: var(--muted);
        font-size: 0.86rem;
        line-height: 1.35;
      }

      .node-code {
        margin-top: 16px;
        color: var(--blue);
        font-family: "SFMono-Regular", Consolas, monospace;
        font-size: 0.78rem;
        overflow-wrap: anywhere;
      }

      .node.client {
        background: var(--blue-soft);
      }

      .node.edge {
        background: var(--green-soft);
      }

      .node.runtime {
        background: var(--amber-soft);
      }

      .node.api {
        background: #f7f2ff;
      }

      .metrics {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
        margin-top: 16px;
      }

      .metric {
        min-height: 92px;
        padding: 14px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel);
      }

      .metric span {
        display: block;
        color: var(--muted);
        font-size: 0.78rem;
        font-weight: 700;
        text-transform: uppercase;
      }

      .metric strong {
        display: block;
        margin-top: 10px;
        font-size: 1.32rem;
        overflow-wrap: anywhere;
      }

      .checks {
        display: grid;
        gap: 10px;
      }

      .check {
        display: grid;
        grid-template-columns: 84px 1fr;
        gap: 12px;
        align-items: center;
        padding: 12px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #fbfcfe;
      }

      .badge {
        display: inline-grid;
        place-items: center;
        min-height: 28px;
        padding: 0 10px;
        border-radius: 999px;
        background: var(--green-soft);
        color: var(--teal);
        font-size: 0.75rem;
        font-weight: 800;
        text-transform: uppercase;
      }

      .check strong {
        display: block;
        font-size: 0.94rem;
      }

      .check span:last-child {
        display: block;
        margin-top: 3px;
        color: var(--muted);
        font-size: 0.84rem;
        line-height: 1.35;
      }

      .log {
        height: 260px;
        margin: 0;
        padding: 14px;
        overflow: auto;
        border-radius: 8px;
        background: #10151f;
        color: #d7e4f2;
        font-family: "SFMono-Regular", Consolas, monospace;
        font-size: 0.82rem;
        line-height: 1.55;
      }

      .actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }

      .button {
        border: 1px solid var(--line);
        border-radius: 8px;
        min-height: 38px;
        padding: 0 12px;
        color: var(--ink);
        background: var(--panel);
        cursor: pointer;
      }

      .button.primary {
        color: #ffffff;
        border-color: var(--blue);
        background: var(--blue);
      }

      .json {
        max-height: 250px;
        margin: 14px 0 0;
        overflow: auto;
        padding: 14px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #fbfcfe;
        color: #26313f;
        font-family: "SFMono-Regular", Consolas, monospace;
        font-size: 0.8rem;
        line-height: 1.5;
      }

      footer {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-top: 16px;
        color: var(--muted);
        font-size: 0.84rem;
      }

      code {
        font-family: "SFMono-Regular", Consolas, monospace;
      }

      @media (max-width: 900px) {
        header,
        footer {
          flex-direction: column;
        }

        h1 {
          font-size: 2rem;
        }

        .grid,
        .topology,
        .metrics {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <header>
        <div class="title">
          <p class="eyebrow">Brimble Sample</p>
          <h1>Infra Probe</h1>
          <p class="subhead">A small Node app with live runtime telemetry, health checks, and an SSE heartbeat. It is built to make routing, container startup, and backend behavior visible after deployment.</p>
        </div>
        <div class="status-pill" aria-live="polite">
          <span id="liveDot" class="dot"></span>
          <strong id="liveStatus">connecting</strong>
        </div>
      </header>

      <main class="grid">
        <section class="panel">
          <div class="panel-head">
            <h2>Route Path</h2>
            <span><code id="hostLabel">loading</code></span>
          </div>
          <div class="panel-body">
            <div class="topology" aria-label="deployment topology">
              <div class="node client">
                <div>
                  <strong>Browser</strong>
                  <span>Loads the page and subscribes to events.</span>
                </div>
                <div class="node-code">EventSource</div>
              </div>
              <div class="node edge">
                <div>
                  <strong>Ingress</strong>
                  <span>Proves proxy headers and host routing.</span>
                </div>
                <div class="node-code" id="ingressLabel">host pending</div>
              </div>
              <div class="node runtime">
                <div>
                  <strong>Container</strong>
                  <span>Runs on the platform-provided port.</span>
                </div>
                <div class="node-code" id="portLabel">PORT pending</div>
              </div>
              <div class="node api">
                <div>
                  <strong>Node API</strong>
                  <span>Returns checks, metrics, and live ticks.</span>
                </div>
                <div class="node-code">/api/runtime</div>
              </div>
            </div>

            <div class="metrics">
              <div class="metric"><span>Uptime</span><strong id="uptime">0s</strong></div>
              <div class="metric"><span>Requests</span><strong id="requests">0</strong></div>
              <div class="metric"><span>RSS Memory</span><strong id="memory">0 MB</strong></div>
              <div class="metric"><span>SSE Clients</span><strong id="clients">0</strong></div>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2>Checks</h2>
            <button class="button" id="refreshChecks" type="button">Refresh</button>
          </div>
          <div class="panel-body">
            <div class="checks" id="checks"></div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2>Live Stream</h2>
            <span><code>/api/events</code></span>
          </div>
          <div class="panel-body">
            <pre class="log" id="eventLog"></pre>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2>Backend Probe</h2>
            <div class="actions">
              <button class="button primary" id="runtimeButton" type="button">Runtime</button>
              <button class="button" id="echoButton" type="button">Echo</button>
            </div>
          </div>
          <div class="panel-body">
            <pre class="json" id="jsonPanel">{}</pre>
          </div>
        </section>
      </main>

      <footer>
        <span>Node <code id="nodeVersion">pending</code></span>
        <span>Started <code id="startedAt">pending</code></span>
      </footer>
    </div>

    <script>
      const ids = {
        liveDot: document.getElementById('liveDot'),
        liveStatus: document.getElementById('liveStatus'),
        hostLabel: document.getElementById('hostLabel'),
        ingressLabel: document.getElementById('ingressLabel'),
        portLabel: document.getElementById('portLabel'),
        uptime: document.getElementById('uptime'),
        requests: document.getElementById('requests'),
        memory: document.getElementById('memory'),
        clients: document.getElementById('clients'),
        checks: document.getElementById('checks'),
        eventLog: document.getElementById('eventLog'),
        jsonPanel: document.getElementById('jsonPanel'),
        nodeVersion: document.getElementById('nodeVersion'),
        startedAt: document.getElementById('startedAt')
      };

      function formatJson(value) {
        return JSON.stringify(value, null, 2);
      }

      function renderRuntime(value) {
        ids.hostLabel.textContent = location.host;
        ids.ingressLabel.textContent = value.ingress.forwardedHost || value.ingress.host || location.host;
        ids.portLabel.textContent = 'PORT ' + value.port;
        ids.uptime.textContent = value.uptimeSeconds + 's';
        ids.requests.textContent = String(value.requestCount);
        ids.memory.textContent = value.memory.rssMb + ' MB';
        ids.clients.textContent = String(value.sseClientCount);
        ids.nodeVersion.textContent = value.nodeVersion;
        ids.startedAt.textContent = value.startedAt;
      }

      function appendEvent(label, value) {
        const line = '[' + new Date().toLocaleTimeString() + '] ' + label + ' ' + formatJson(value);
        ids.eventLog.textContent = (line + '\\n' + ids.eventLog.textContent).slice(0, 9000);
      }

      async function loadRuntime() {
        const response = await fetch('/api/runtime', { cache: 'no-store' });
        const value = await response.json();
        renderRuntime(value);
        ids.jsonPanel.textContent = formatJson(value);
      }

      async function loadChecks() {
        const response = await fetch('/api/checks', { cache: 'no-store' });
        const value = await response.json();
        ids.checks.innerHTML = value.checks.map((check) => (
          '<div class="check">' +
            '<span class="badge">' + check.status + '</span>' +
            '<span><strong>' + check.name + '</strong><span>' + check.detail + '</span></span>' +
          '</div>'
        )).join('');
      }

      async function runEcho() {
        const response = await fetch('/api/echo', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ probe: 'brimble-sample', sentAt: new Date().toISOString() })
        });
        ids.jsonPanel.textContent = formatJson(await response.json());
      }

      function connectEvents() {
        const source = new EventSource('/api/events');

        source.addEventListener('open', () => {
          ids.liveDot.classList.add('live');
          ids.liveStatus.textContent = 'live';
        });

        source.addEventListener('runtime.ready', (event) => {
          const value = JSON.parse(event.data);
          renderRuntime(value);
          appendEvent('ready', value);
        });

        source.addEventListener('runtime.tick', (event) => {
          const value = JSON.parse(event.data);
          ids.uptime.textContent = value.uptimeSeconds + 's';
          ids.requests.textContent = String(value.requestCount);
          ids.memory.textContent = value.rssMb + ' MB';
          ids.clients.textContent = String(value.sseClientCount);
          appendEvent('tick', value);
        });

        source.addEventListener('error', () => {
          ids.liveDot.classList.remove('live');
          ids.liveStatus.textContent = 'reconnecting';
        });
      }

      document.getElementById('refreshChecks').addEventListener('click', loadChecks);
      document.getElementById('runtimeButton').addEventListener('click', loadRuntime);
      document.getElementById('echoButton').addEventListener('click', runEcho);

      loadRuntime().catch((error) => appendEvent('runtime.error', { message: error.message }));
      loadChecks().catch((error) => appendEvent('checks.error', { message: error.message }));
      connectEvents();
      setInterval(() => loadRuntime().catch(() => {}), 6000);
    </script>
  </body>
</html>`;
}

async function handle(req, res) {
  requestCount += 1;

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/') {
    const body = html();
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(body)
    });
    res.end(body);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/healthz') {
    json(res, 200, health(req));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime') {
    json(res, 200, runtimeSnapshot(req));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/checks') {
    json(res, 200, checks(req));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/events') {
    streamEvents(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/echo') {
    try {
      const body = await readBody(req);
      json(res, 200, {
        status: 'ok',
        receivedAt: new Date().toISOString(),
        contentType: req.headers['content-type'] || null,
        bytes: Buffer.byteLength(body),
        preview: body.slice(0, 240)
      });
    } catch (error) {
      json(res, 413, {
        status: 'error',
        message: error instanceof Error ? error.message : 'Invalid request body'
      });
    }
    return;
  }

  notFound(res, url.pathname);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    json(res, 500, {
      status: 'error',
      message: error instanceof Error ? error.message : 'Internal Server Error'
    });
  });
});

server.listen(port, () => {
  console.log(`Brimble sample infra probe listening on ${port}`);
});
