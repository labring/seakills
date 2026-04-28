#!/usr/bin/env node
// Sealos Devbox CLI - single entry point for all devbox operations.
// Zero external dependencies. Requires Node.js (guaranteed by Claude Code).
//
// Usage:
//   node sealos-devbox.mjs <command> [args...]
//
// Config resolution:
//   ~/.sealos/auth.json region field → derives API URL automatically
//   Kubeconfig is always read from ~/.sealos/kubeconfig
//
// Commands:
//   templates                         List available runtimes (no auth needed)
//   list                              List all devboxes
//   get <name>                        Get devbox details + SSH info
//   create <json>                     Create devbox (saves SSH key automatically)
//   create-wait <json>                Create + poll until running (timeout 2min)
//   update <name> <json>              Update quota/ports
//   delete <name>                     Delete devbox
//   start <name>                      Start stopped devbox
//   pause <name>                      Pause running devbox
//   shutdown <name>                   Shutdown devbox
//   restart <name>                    Restart devbox
//   autostart <name> [json]           Configure autostart command
//   list-releases <name>              List releases
//   create-release <name> <json>      Create release (tag, description, etc.)
//   delete-release <name> <tag>       Delete release
//   deploy <name> <tag>               Deploy release to AppLaunchpad
//   list-deployments <name>           List deployments
//   monitor <name> [start] [end] [step]  Get CPU/memory metrics

import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const KC_PATH = resolve(homedir(), '.sealos/kubeconfig');
const AUTH_PATH = resolve(homedir(), '.sealos/auth.json');
const KEYS_DIR = resolve(homedir(), '.config/sealos-devbox/keys');
const API_PATH = '/api/v2alpha'; // API version — update here if the version changes

// --- config ---

function loadConfig() {
  // Derive API URL from auth.json region
  if (!existsSync(AUTH_PATH)) {
    throw new Error('Not authenticated. Run: node sealos-auth.mjs login');
  }

  let auth;
  try {
    auth = JSON.parse(readFileSync(AUTH_PATH, 'utf-8'));
  } catch {
    throw new Error('Invalid auth.json. Run: node sealos-auth.mjs login');
  }

  if (!auth.region) {
    throw new Error('No region in auth.json. Run: node sealos-auth.mjs login');
  }

  // Derive API URL: region "https://gzg.sealos.run" → "https://devbox.gzg.sealos.run/api/v2alpha"
  const regionUrl = new URL(auth.region);
  const apiUrl = `https://devbox.${regionUrl.hostname}${API_PATH}`;

  if (!existsSync(KC_PATH)) {
    throw new Error(`Kubeconfig not found at ${KC_PATH}. Run: node sealos-auth.mjs login`);
  }

  return { apiUrl, regionUrl: regionUrl.origin, kubeconfigPath: KC_PATH };
}

// --- SSH key management ---

function savePrivateKey(name, base64Key) {
  mkdirSync(KEYS_DIR, { recursive: true });
  const keyPath = resolve(KEYS_DIR, `${name}.pem`);
  const keyData = Buffer.from(base64Key, 'base64').toString('utf-8');
  writeFileSync(keyPath, keyData, { mode: 0o600 });
  try { chmodSync(keyPath, 0o600); } catch { /* best effort */ }
  return keyPath;
}

// --- auth ---

function getEncodedKubeconfig(path) {
  if (!existsSync(path)) {
    throw new Error(`Kubeconfig not found at ${path}`);
  }
  return encodeURIComponent(readFileSync(path, 'utf-8'));
}

// --- HTTP ---

function apiCall(method, endpoint, { apiUrl, auth, body, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(apiUrl + endpoint);
    const isHttps = url.protocol === 'https:';
    const reqFn = isHttps ? httpsRequest : httpRequest;

    const headers = {};
    if (auth) headers['Authorization'] = auth;
    if (body) headers['Content-Type'] = 'application/json';

    const bodyStr = body ? JSON.stringify(body) : null;
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const opts = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers,
      timeout,
      rejectUnauthorized: false, // Sealos clusters may use self-signed certificates
    };

    const req = reqFn(opts, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString();
        let parsed = null;
        try { parsed = JSON.parse(rawBody); } catch { parsed = rawBody || null; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// --- helpers ---

function requireName(args) {
  if (!args[0]) throw new Error('Devbox name required');
  return args[0];
}

function output(data) {
  console.log(JSON.stringify(data, null, 2));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- individual commands ---

async function listTemplates(cfg) {
  const res = await apiCall('GET', '/devbox/templates', { apiUrl: cfg.apiUrl });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function list(cfg) {
  const auth = getEncodedKubeconfig(cfg.kubeconfigPath);
  const res = await apiCall('GET', '/devbox', { apiUrl: cfg.apiUrl, auth });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function get(cfg, name) {
  const auth = getEncodedKubeconfig(cfg.kubeconfigPath);
  const res = await apiCall('GET', `/devbox/${name}`, { apiUrl: cfg.apiUrl, auth });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

function validateCreateBody(body) {
  const errors = [];
  if (!body.name) {
    errors.push('name is required');
  } else {
    if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(body.name)) errors.push('name must match ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$');
    if (body.name.length > 63) errors.push('name must be at most 63 characters');
  }
  if (!body.runtime) errors.push('runtime is required');
  if (body.quota) {
    const q = body.quota;
    if (q.cpu !== undefined && (typeof q.cpu !== 'number' || q.cpu < 0.1 || q.cpu > 32)) errors.push('cpu must be 0.1-32');
    if (q.memory !== undefined && (typeof q.memory !== 'number' || q.memory < 0.1 || q.memory > 32)) errors.push('memory must be 0.1-32 GB');
  }
  if (body.ports) {
    if (!Array.isArray(body.ports)) {
      errors.push('ports must be an array');
    } else {
      for (const p of body.ports) {
        if (p.number !== undefined && (typeof p.number !== 'number' || p.number < 1 || p.number > 65535)) errors.push(`port number must be 1-65535, got ${p.number}`);
        if (p.protocol && !['http', 'grpc', 'ws'].includes(p.protocol)) errors.push(`port protocol must be http, grpc, or ws, got ${p.protocol}`);
      }
    }
  }
  if (errors.length) throw new Error('Validation failed: ' + errors.join('; '));
}

function validateUpdateBody(body) {
  const errors = [];
  if (body.quota) {
    const q = body.quota;
    if (q.cpu !== undefined && (typeof q.cpu !== 'number' || q.cpu < 0.1 || q.cpu > 32)) errors.push('cpu must be 0.1-32');
    if (q.memory !== undefined && (typeof q.memory !== 'number' || q.memory < 0.1 || q.memory > 32)) errors.push('memory must be 0.1-32 GB');
  }
  if (body.ports) {
    if (!Array.isArray(body.ports)) {
      errors.push('ports must be an array');
    } else {
      for (const p of body.ports) {
        if (p.number !== undefined && (typeof p.number !== 'number' || p.number < 1 || p.number > 65535)) errors.push(`port number must be 1-65535, got ${p.number}`);
        if (p.protocol && !['http', 'grpc', 'ws'].includes(p.protocol)) errors.push(`port protocol must be http, grpc, or ws, got ${p.protocol}`);
      }
    }
  }
  if (errors.length) throw new Error('Validation failed: ' + errors.join('; '));
}

async function create(cfg, jsonBody) {
  const body = typeof jsonBody === 'string' ? JSON.parse(jsonBody) : jsonBody;
  validateCreateBody(body);
  const auth = getEncodedKubeconfig(cfg.kubeconfigPath);
  const res = await apiCall('POST', '/devbox', { apiUrl: cfg.apiUrl, auth, body });
  if (res.status !== 201) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);

  // Auto-save SSH private key
  if (res.body && res.body.base64PrivateKey) {
    const keyPath = savePrivateKey(body.name || res.body.name, res.body.base64PrivateKey);
    res.body.savedKeyPath = keyPath;
  }

  return res.body;
}

async function update(cfg, name, jsonBody) {
  const body = typeof jsonBody === 'string' ? JSON.parse(jsonBody) : jsonBody;
  validateUpdateBody(body);
  const auth = getEncodedKubeconfig(cfg.kubeconfigPath);
  const res = await apiCall('PATCH', `/devbox/${name}`, { apiUrl: cfg.apiUrl, auth, body });
  if (res.status !== 204) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  // Re-fetch to return updated state
  try {
    const updated = await get(cfg, name);
    return { success: true, message: 'Devbox update initiated', devbox: updated };
  } catch {
    return { success: true, message: 'Devbox update initiated' };
  }
}

async function del(cfg, name) {
  const auth = getEncodedKubeconfig(cfg.kubeconfigPath);
  const res = await apiCall('DELETE', `/devbox/${name}`, { apiUrl: cfg.apiUrl, auth });
  if (res.status !== 204) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  return { success: true, message: `Devbox '${name}' deleted` };
}

async function action(cfg, name, actionName) {
  const auth = getEncodedKubeconfig(cfg.kubeconfigPath);
  const bodyNeeded = ['pause', 'shutdown', 'restart'].includes(actionName);
  const opts = { apiUrl: cfg.apiUrl, auth };
  if (bodyNeeded) opts.body = {};
  const res = await apiCall('POST', `/devbox/${name}/${actionName}`, opts);
  if (res.status !== 204) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  return { success: true, message: `Action '${actionName}' on '${name}' completed` };
}

async function autostart(cfg, name, jsonBody) {
  const body = jsonBody ? (typeof jsonBody === 'string' ? JSON.parse(jsonBody) : jsonBody) : {};
  const auth = getEncodedKubeconfig(cfg.kubeconfigPath);
  const res = await apiCall('POST', `/devbox/${name}/autostart`, { apiUrl: cfg.apiUrl, auth, body });
  if (res.status !== 204) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  return { success: true, message: `Autostart configured for '${name}'` };
}

// --- release commands ---

async function listReleases(cfg, name) {
  const auth = getEncodedKubeconfig(cfg.kubeconfigPath);
  const res = await apiCall('GET', `/devbox/${name}/releases`, { apiUrl: cfg.apiUrl, auth });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function createRelease(cfg, name, jsonBody) {
  const body = typeof jsonBody === 'string' ? JSON.parse(jsonBody) : jsonBody;
  if (!body.tag) throw new Error('Validation failed: tag is required');
  const auth = getEncodedKubeconfig(cfg.kubeconfigPath);
  const res = await apiCall('POST', `/devbox/${name}/releases`, { apiUrl: cfg.apiUrl, auth, body });
  if (res.status !== 202) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body || { name, tag: body.tag, status: 'creating' };
}

async function deleteRelease(cfg, name, tag) {
  const auth = getEncodedKubeconfig(cfg.kubeconfigPath);
  const res = await apiCall('DELETE', `/devbox/${name}/releases/${encodeURIComponent(tag)}`, { apiUrl: cfg.apiUrl, auth });
  if (res.status !== 204) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  return { success: true, message: `Release '${tag}' deleted from '${name}'` };
}

// --- deployment commands ---

async function listDeployments(cfg, name) {
  const auth = getEncodedKubeconfig(cfg.kubeconfigPath);
  const res = await apiCall('GET', `/devbox/${name}/deployments`, { apiUrl: cfg.apiUrl, auth });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function deploy(cfg, name, tag) {
  const auth = getEncodedKubeconfig(cfg.kubeconfigPath);
  const res = await apiCall('POST', `/devbox/${name}/releases/${encodeURIComponent(tag)}/deploy`, { apiUrl: cfg.apiUrl, auth });
  if (res.status !== 204) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  return { success: true, message: `Release '${tag}' of '${name}' deployed to AppLaunchpad` };
}

// --- monitor command ---

async function monitor(cfg, name, start, end, step) {
  const auth = getEncodedKubeconfig(cfg.kubeconfigPath);
  let query = '';
  const params = [];
  if (start) params.push(`start=${encodeURIComponent(start)}`);
  if (end) params.push(`end=${encodeURIComponent(end)}`);
  if (step) params.push(`step=${encodeURIComponent(step)}`);
  if (params.length) query = '?' + params.join('&');
  const res = await apiCall('GET', `/devbox/${name}/monitor${query}`, { apiUrl: cfg.apiUrl, auth });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

// --- batch commands ---

async function createWait(cfg, jsonBody) {
  // 1. Create
  const body = typeof jsonBody === 'string' ? JSON.parse(jsonBody) : jsonBody;
  const createResult = await create(cfg, body);
  const name = body.name || createResult.name;

  // 2. Poll every 5s until running (max 2 min)
  const timeout = 120000;
  const interval = 5000;
  const start = Date.now();

  let lastStatus = 'pending';
  let consecutiveErrors = 0;
  while (Date.now() - start < timeout) {
    await sleep(interval);
    try {
      const info = await get(cfg, name);
      consecutiveErrors = 0;
      lastStatus = info.status;
      process.stderr.write(`Status: ${lastStatus}\n`);
      if (lastStatus.toLowerCase() === 'running') {
        // Merge SSH key info from create response
        if (createResult.savedKeyPath) info.savedKeyPath = createResult.savedKeyPath;
        if (createResult.base64PrivateKey) info.base64PrivateKey = createResult.base64PrivateKey;
        return info;
      }
      if (lastStatus.toLowerCase() === 'error' || lastStatus.toLowerCase() === 'failed') {
        throw new Error(`Devbox creation failed. Status: ${lastStatus}`);
      }
    } catch (e) {
      consecutiveErrors++;
      if (consecutiveErrors >= 5 || Date.now() - start > timeout) throw e;
    }
  }

  // Timeout - return last known state
  try {
    const info = await get(cfg, name);
    if (createResult.savedKeyPath) info.savedKeyPath = createResult.savedKeyPath;
    return { ...info, consoleUrl: cfg.regionUrl, warning: `Timed out after 2 minutes. Last status: ${info.status}` };
  } catch {
    return { name, status: lastStatus, consoleUrl: cfg.regionUrl, warning: 'Timed out after 2 minutes' };
  }
}

// --- main ---

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  if (!cmd) {
    console.error('ERROR: Command required.');
    console.error('Commands: templates|list|get|create|create-wait|update|delete|start|pause|shutdown|restart|autostart|list-releases|create-release|delete-release|deploy|list-deployments|monitor');
    process.exit(1);
  }

  try {
    const cfg = loadConfig();
    let result;

    switch (cmd) {
      case 'templates': {
        result = await listTemplates(cfg);
        break;
      }

      case 'list': {
        result = await list(cfg);
        break;
      }

      case 'get': {
        const name = requireName(args);
        result = await get(cfg, name);
        break;
      }

      case 'create': {
        if (!args[0]) throw new Error('JSON body required');
        result = await create(cfg, args[0]);
        break;
      }

      case 'create-wait': {
        if (!args[0]) throw new Error('JSON body required');
        result = await createWait(cfg, args[0]);
        break;
      }

      case 'update': {
        const name = requireName(args);
        if (!args[1]) throw new Error('JSON body required');
        result = await update(cfg, name, args[1]);
        break;
      }

      case 'delete': {
        const name = requireName(args);
        result = await del(cfg, name);
        break;
      }

      case 'start':
      case 'pause':
      case 'shutdown':
      case 'restart': {
        const name = requireName(args);
        result = await action(cfg, name, cmd);
        break;
      }

      case 'autostart': {
        const name = requireName(args);
        result = await autostart(cfg, name, args[1]);
        break;
      }

      case 'list-releases': {
        const name = requireName(args);
        result = await listReleases(cfg, name);
        break;
      }

      case 'create-release': {
        const name = requireName(args);
        if (!args[1]) throw new Error('JSON body required');
        result = await createRelease(cfg, name, args[1]);
        break;
      }

      case 'delete-release': {
        const name = requireName(args);
        if (!args[1]) throw new Error('Release tag required');
        result = await deleteRelease(cfg, name, args[1]);
        break;
      }

      case 'deploy': {
        const name = requireName(args);
        if (!args[1]) throw new Error('Release tag required');
        result = await deploy(cfg, name, args[1]);
        break;
      }

      case 'list-deployments': {
        const name = requireName(args);
        result = await listDeployments(cfg, name);
        break;
      }

      case 'monitor': {
        const name = requireName(args);
        result = await monitor(cfg, name, args[1], args[2], args[3]);
        break;
      }

      default:
        throw new Error(`Unknown command '${cmd}'. Commands: templates|list|get|create|create-wait|update|delete|start|pause|shutdown|restart|autostart|list-releases|create-release|delete-release|deploy|list-deployments|monitor`);
    }

    if (result !== undefined) output(result);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
}

main();
