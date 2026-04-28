#!/usr/bin/env node
// Sealos Database CLI - single entry point for all database operations.
// Zero external dependencies. Requires Node.js (guaranteed by Claude Code).
//
// Usage:
//   node sealos-db.mjs <command> [args...]
//
// Config resolution:
//   ~/.sealos/auth.json region field → derives API URL automatically
//   Kubeconfig is always read from ~/.sealos/kubeconfig
//
// Commands:
//   list-versions                    List available database versions (no auth needed)
//   list                             List all databases
//   get <name>                       Get database details and connection info
//   create <json>                    Create a new database
//   create-wait <json>               Create + poll until running (timeout 2min)
//   update <name> <json>             Update database resources
//   delete <name>                    Delete a database
//   start <name>                     Start a stopped database
//   pause <name>                     Pause a running database
//   restart <name>                   Restart a database
//   enable-public <name>             Enable public access
//   disable-public <name>            Disable public access
//   list-backups <name>              List backups for a database
//   create-backup <name> [json]     Create a backup (optional: {"description":"...","name":"..."})
//   delete-backup <name> <backup>   Delete a specific backup
//   restore-backup <name> <backup> [json]  Restore from backup (optional: {"name":"...","replicas":N})
//   log-files <name> <dbType> <logType>    List log files for a database pod
//   logs <name> <dbType> <logType> <logPath> [page] [pageSize]  Get log entries

import { readFileSync, existsSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const KC_PATH = resolve(homedir(), '.sealos/kubeconfig');
const AUTH_PATH = resolve(homedir(), '.sealos/auth.json');
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

  // Derive API URL: region "https://gzg.sealos.run" → "https://dbprovider.gzg.sealos.run/api/v2alpha"
  const regionUrl = new URL(auth.region);
  const apiUrl = `https://dbprovider.${regionUrl.hostname}${API_PATH}`;

  if (!existsSync(KC_PATH)) {
    throw new Error(`Kubeconfig not found at ${KC_PATH}. Run: node sealos-auth.mjs login`);
  }

  return { apiUrl, kubeconfigPath: KC_PATH };
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
  if (!args[0]) throw new Error('Database name required');
  return args[0];
}

function output(data) {
  console.log(JSON.stringify(data, null, 2));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- individual commands ---

async function listVersions(cfg) {
  const res = await apiCall('GET', '/databases/versions', { apiUrl: cfg.apiUrl });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function list(cfg) {
  const auth = getEncodedKubeconfig(cfg.kubeconfigPath);
  const res = await apiCall('GET', '/databases', { apiUrl: cfg.apiUrl, auth });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function get(cfg, name) {
  const auth = getEncodedKubeconfig(cfg.kubeconfigPath);
  const res = await apiCall('GET', `/databases/${name}`, { apiUrl: cfg.apiUrl, auth });
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
  if (!body.type) errors.push('type is required');
  if (body.quota) {
    const q = body.quota;
    if (q.cpu !== undefined && (!Number.isInteger(q.cpu) || q.cpu < 1 || q.cpu > 8)) errors.push('cpu must be an integer 1-8');
    if (q.memory !== undefined && (typeof q.memory !== 'number' || q.memory < 0.1 || q.memory > 32)) errors.push('memory must be 0.1-32 GB');
    if (q.storage !== undefined && (typeof q.storage !== 'number' || q.storage < 1 || q.storage > 300)) errors.push('storage must be 1-300 GB');
    if (q.replicas !== undefined && (!Number.isInteger(q.replicas) || q.replicas < 1 || q.replicas > 20)) errors.push('replicas must be an integer 1-20');
  }
  if (body.terminationPolicy && !['delete', 'wipeout'].includes(body.terminationPolicy)) errors.push('terminationPolicy must be "delete" or "wipeout"');
  if (errors.length) throw new Error('Validation failed: ' + errors.join('; '));
}

function validateUpdateBody(body) {
  const errors = [];
  if (body.quota) {
    const q = body.quota;
    if (q.cpu !== undefined && ![1, 2, 3, 4, 5, 6, 7, 8].includes(q.cpu)) errors.push('cpu must be one of: 1, 2, 3, 4, 5, 6, 7, 8');
    if (q.memory !== undefined && ![1, 2, 4, 6, 8, 12, 16, 32].includes(q.memory)) errors.push('memory must be one of: 1, 2, 4, 6, 8, 12, 16, 32 GB');
    if (q.storage !== undefined && (typeof q.storage !== 'number' || q.storage < 1 || q.storage > 300)) errors.push('storage must be 1-300 GB (expand only)');
    if (q.replicas !== undefined && (!Number.isInteger(q.replicas) || q.replicas < 1 || q.replicas > 20)) errors.push('replicas must be an integer 1-20');
  }
  if (errors.length) throw new Error('Validation failed: ' + errors.join('; '));
}

async function create(cfg, jsonBody) {
  const body = typeof jsonBody === 'string' ? JSON.parse(jsonBody) : jsonBody;
  validateCreateBody(body);
  const auth = getEncodedKubeconfig(cfg.kubeconfigPath);
  const res = await apiCall('POST', '/databases', { apiUrl: cfg.apiUrl, auth, body });
  if (res.status !== 201) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function update(cfg, name, jsonBody) {
  const body = typeof jsonBody === 'string' ? JSON.parse(jsonBody) : jsonBody;
  validateUpdateBody(body);
  const auth = getEncodedKubeconfig(cfg.kubeconfigPath);
  const res = await apiCall('PATCH', `/databases/${name}`, { apiUrl: cfg.apiUrl, auth, body });
  if (res.status !== 204) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  // Re-fetch to return updated state
  try {
    const updated = await get(cfg, name);
    return { success: true, message: 'Database update initiated', database: updated };
  } catch {
    return { success: true, message: 'Database update initiated' };
  }
}

async function del(cfg, name) {
  const auth = getEncodedKubeconfig(cfg.kubeconfigPath);
  const res = await apiCall('DELETE', `/databases/${name}`, { apiUrl: cfg.apiUrl, auth });
  if (res.status !== 204) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  return { success: true, message: `Database '${name}' deleted` };
}

async function action(cfg, name, actionName) {
  const auth = getEncodedKubeconfig(cfg.kubeconfigPath);
  const res = await apiCall('POST', `/databases/${name}/${actionName}`, { apiUrl: cfg.apiUrl, auth });
  if (res.status !== 204) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  return { success: true, message: `Action '${actionName}' on '${name}' completed` };
}

// --- backup commands ---

async function listBackups(cfg, name) {
  const auth = getEncodedKubeconfig(cfg.kubeconfigPath);
  const res = await apiCall('GET', `/databases/${name}/backups`, { apiUrl: cfg.apiUrl, auth });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function createBackup(cfg, name, jsonBody) {
  const body = jsonBody ? (typeof jsonBody === 'string' ? JSON.parse(jsonBody) : jsonBody) : {};
  if (body.description && body.description.length > 31) {
    throw new Error('Validation failed: description must be at most 31 characters (Kubernetes label limit)');
  }
  const auth = getEncodedKubeconfig(cfg.kubeconfigPath);
  const res = await apiCall('POST', `/databases/${name}/backups`, { apiUrl: cfg.apiUrl, auth, body });
  if (res.status !== 204) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  return { success: true, message: `Backup created for '${name}'` };
}

async function deleteBackup(cfg, name, backupName) {
  const auth = getEncodedKubeconfig(cfg.kubeconfigPath);
  const res = await apiCall('DELETE', `/databases/${name}/backups/${backupName}`, { apiUrl: cfg.apiUrl, auth });
  if (res.status !== 204) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  return { success: true, message: `Backup '${backupName}' deleted from '${name}'` };
}

async function restoreBackup(cfg, name, backupName, jsonBody) {
  const body = jsonBody ? (typeof jsonBody === 'string' ? JSON.parse(jsonBody) : jsonBody) : {};
  const auth = getEncodedKubeconfig(cfg.kubeconfigPath);
  const res = await apiCall('POST', `/databases/${name}/backups/${backupName}/restore`, { apiUrl: cfg.apiUrl, auth, body });
  if (res.status !== 204) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  return { success: true, message: `Restore from backup '${backupName}' initiated` };
}

// --- log commands ---

async function listLogFiles(cfg, podName, dbType, logType) {
  const validDbTypes = ['mysql', 'mongodb', 'redis', 'postgresql'];
  const validLogTypes = ['runtimeLog', 'slowQuery', 'errorLog'];
  if (!validDbTypes.includes(dbType)) throw new Error(`dbType must be one of: ${validDbTypes.join(', ')}`);
  if (!validLogTypes.includes(logType)) throw new Error(`logType must be one of: ${validLogTypes.join(', ')}`);

  const auth = getEncodedKubeconfig(cfg.kubeconfigPath);
  const query = `?podName=${encodeURIComponent(podName)}&dbType=${encodeURIComponent(dbType)}&logType=${encodeURIComponent(logType)}`;
  const res = await apiCall('GET', `/logs/files${query}`, { apiUrl: cfg.apiUrl, auth });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function getLogs(cfg, podName, dbType, logType, logPath, page, pageSize) {
  const validDbTypes = ['mysql', 'mongodb', 'redis', 'postgresql'];
  const validLogTypes = ['runtimeLog', 'slowQuery', 'errorLog'];
  if (!validDbTypes.includes(dbType)) throw new Error(`dbType must be one of: ${validDbTypes.join(', ')}`);
  if (!validLogTypes.includes(logType)) throw new Error(`logType must be one of: ${validLogTypes.join(', ')}`);

  const auth = getEncodedKubeconfig(cfg.kubeconfigPath);
  let query = `?podName=${encodeURIComponent(podName)}&dbType=${encodeURIComponent(dbType)}&logType=${encodeURIComponent(logType)}&logPath=${encodeURIComponent(logPath)}`;
  if (page) query += `&page=${encodeURIComponent(page)}`;
  if (pageSize) query += `&pageSize=${encodeURIComponent(pageSize)}`;
  const res = await apiCall('GET', `/logs${query}`, { apiUrl: cfg.apiUrl, auth });
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

  let lastStatus = 'creating';
  let consecutiveErrors = 0;
  while (Date.now() - start < timeout) {
    await sleep(interval);
    try {
      const info = await get(cfg, name);
      consecutiveErrors = 0;
      lastStatus = info.status;
      process.stderr.write(`Status: ${lastStatus}\n`);
      if (lastStatus.toLowerCase() === 'running') {
        return info;
      }
      if (lastStatus.toLowerCase() === 'failed') {
        throw new Error(`Database creation failed. Status: ${lastStatus}`);
      }
    } catch (e) {
      consecutiveErrors++;
      if (consecutiveErrors >= 5 || Date.now() - start > timeout) throw e;
    }
  }

  // Timeout - return last known state
  try {
    const info = await get(cfg, name);
    return { ...info, warning: `Timed out after 2 minutes. Last status: ${info.status}` };
  } catch {
    return { name, status: lastStatus, warning: 'Timed out after 2 minutes' };
  }
}

// --- main ---

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  if (!cmd) {
    console.error('ERROR: Command required.');
    console.error('Commands: list-versions|list|get|create|create-wait|update|delete|start|pause|restart|enable-public|disable-public|list-backups|create-backup|delete-backup|restore-backup|log-files|logs');
    process.exit(1);
  }

  try {
    const cfg = loadConfig();
    let result;

    switch (cmd) {
      case 'list-versions': {
        result = await listVersions(cfg);
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
      case 'restart':
      case 'enable-public':
      case 'disable-public': {
        const name = requireName(args);
        result = await action(cfg, name, cmd);
        break;
      }

      case 'list-backups': {
        const name = requireName(args);
        result = await listBackups(cfg, name);
        break;
      }

      case 'create-backup': {
        const name = requireName(args);
        result = await createBackup(cfg, name, args[1]);
        break;
      }

      case 'delete-backup': {
        const name = requireName(args);
        if (!args[1]) throw new Error('Backup name required');
        result = await deleteBackup(cfg, name, args[1]);
        break;
      }

      case 'restore-backup': {
        const name = requireName(args);
        if (!args[1]) throw new Error('Backup name required');
        result = await restoreBackup(cfg, name, args[1], args[2]);
        break;
      }

      case 'log-files': {
        const podName = requireName(args);
        if (!args[1]) throw new Error('dbType required (mysql|mongodb|redis|postgresql)');
        if (!args[2]) throw new Error('logType required (runtimeLog|slowQuery|errorLog)');
        result = await listLogFiles(cfg, podName, args[1], args[2]);
        break;
      }

      case 'logs': {
        const podName = requireName(args);
        if (!args[1]) throw new Error('dbType required (mysql|mongodb|redis|postgresql)');
        if (!args[2]) throw new Error('logType required (runtimeLog|slowQuery|errorLog)');
        if (!args[3]) throw new Error('logPath required');
        result = await getLogs(cfg, podName, args[1], args[2], args[3], args[4], args[5]);
        break;
      }

      default:
        throw new Error(`Unknown command '${cmd}'. Commands: list-versions|list|get|create|create-wait|update|delete|start|pause|restart|enable-public|disable-public|list-backups|create-backup|delete-backup|restore-backup|log-files|logs`);
    }

    if (result !== undefined) output(result);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
}

main();
