#!/usr/bin/env node
// Sealos Template CLI - single entry point for all template operations.
// Zero external dependencies. Requires Node.js (guaranteed by Claude Code).
//
// Usage:
//   node sealos-template.mjs <command> [args...]
//
// Config resolution:
//   ~/.sealos/auth.json  → region → derive API URL
//   ~/.sealos/kubeconfig → credentials for auth-required operations
//
// Commands:
//   list [--language=en]              List all templates (no auth needed)
//   get <name> [--language=en]        Get template details (no auth needed)
//   create <json>                     Create a template instance (auth required)
//   create-raw <json_or_filepath>     Deploy from raw YAML (auth required)

import { readFileSync, existsSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const KC_PATH = resolve(homedir(), '.sealos/kubeconfig');
const AUTH_PATH = resolve(homedir(), '.sealos/auth.json');
const API_PATH = '/api/v2alpha'; // API version — update here if the version changes

// --- config ---

// Default region fallback for unauthenticated operations (list/get)
const SKILL_CONFIG_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'config.json');

function loadConfig({ requireAuth = false } = {}) {
  let region = null;

  // Try to read region from auth.json (set by login)
  if (existsSync(AUTH_PATH)) {
    try {
      const auth = JSON.parse(readFileSync(AUTH_PATH, 'utf-8'));
      if (auth.region) region = auth.region;
    } catch { /* ignore invalid auth.json for public operations */ }
  }

  // Fall back to default region from skill config.json for public operations
  if (!region) {
    try {
      const skillConfig = JSON.parse(readFileSync(SKILL_CONFIG_PATH, 'utf-8'));
      region = skillConfig.default_region;
    } catch { /* no fallback available */ }
  }

  if (!region) {
    throw new Error('No region configured. Run: node sealos-auth.mjs login');
  }

  const regionUrl = new URL(region);
  const apiUrl = `https://template.${regionUrl.hostname}${API_PATH}`;

  if (requireAuth && !existsSync(KC_PATH)) {
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
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// --- helpers ---

function output(data) {
  console.log(JSON.stringify(data, null, 2));
}

// --- parse CLI flags ---

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx > 0) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        flags[arg.slice(2)] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

// --- validation ---

function validateCreateBody(body) {
  const errors = [];
  if (!body.name) {
    errors.push('name is required');
  } else {
    if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(body.name)) errors.push('name must match ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$');
    if (body.name.length > 63) errors.push('name must be at most 63 characters');
  }
  if (!body.template) errors.push('template is required');
  if (errors.length) throw new Error('Validation failed: ' + errors.join('; '));
}

function validateCreateRawBody(body) {
  const errors = [];
  if (!body.yaml) errors.push('yaml is required');
  if (errors.length) throw new Error('Validation failed: ' + errors.join('; '));
}

// --- individual commands ---

async function listTemplates(cfg, language) {
  const langParam = language ? `?language=${encodeURIComponent(language)}` : '';
  const res = await apiCall('GET', `/templates${langParam}`, { apiUrl: cfg.apiUrl });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  const menuKeys = res.headers['x-menu-keys'] || '';
  return { templates: res.body, menuKeys };
}

async function getTemplate(cfg, name, language) {
  const langParam = language ? `?language=${encodeURIComponent(language)}` : '';
  const res = await apiCall('GET', `/templates/${encodeURIComponent(name)}${langParam}`, { apiUrl: cfg.apiUrl });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function createInstance(cfg, jsonBody) {
  const body = typeof jsonBody === 'string' ? JSON.parse(jsonBody) : jsonBody;
  validateCreateBody(body);
  const auth = getEncodedKubeconfig(cfg.kubeconfigPath);
  const res = await apiCall('POST', '/templates/instances', { apiUrl: cfg.apiUrl, auth, body });
  if (res.status !== 201) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function createRaw(cfg, jsonOrFilepath) {
  let body;
  if (typeof jsonOrFilepath === 'string' && (jsonOrFilepath.startsWith('/') || jsonOrFilepath.startsWith('~'))) {
    const filePath = jsonOrFilepath.replace(/^~/, homedir());
    const absPath = resolve(filePath);
    if (!existsSync(absPath)) throw new Error(`File not found: ${absPath}`);
    const content = readFileSync(absPath, 'utf-8');
    body = JSON.parse(content);
  } else {
    body = typeof jsonOrFilepath === 'string' ? JSON.parse(jsonOrFilepath) : jsonOrFilepath;
  }
  validateCreateRawBody(body);
  const auth = getEncodedKubeconfig(cfg.kubeconfigPath);
  const res = await apiCall('POST', '/templates/raw', { apiUrl: cfg.apiUrl, auth, body });
  if (res.status !== 200 && res.status !== 201) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

// --- main ---

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  if (!cmd) {
    console.error('ERROR: Command required.');
    console.error('Commands: list|get|create|create-raw');
    process.exit(1);
  }

  try {
    let result;

    switch (cmd) {
      case 'list': {
        const { flags } = parseFlags(args);
        const publicCfg = loadConfig();
        result = await listTemplates(publicCfg, flags.language || 'en');
        break;
      }

      case 'get': {
        const { flags, positional } = parseFlags(args);
        if (!positional[0]) throw new Error('Template name required');
        const publicCfg = loadConfig();
        result = await getTemplate(publicCfg, positional[0], flags.language || 'en');
        break;
      }

      case 'create': {
        if (!args[0]) throw new Error('JSON body required');
        const authCfg = loadConfig({ requireAuth: true });
        result = await createInstance(authCfg, args[0]);
        break;
      }

      case 'create-raw': {
        if (!args[0]) throw new Error('JSON body or file path required');
        const authCfg = loadConfig({ requireAuth: true });
        result = await createRaw(authCfg, args[0]);
        break;
      }

      default:
        throw new Error(`Unknown command '${cmd}'. Commands: list|get|create|create-raw`);
    }

    if (result !== undefined) output(result);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
}

main();
