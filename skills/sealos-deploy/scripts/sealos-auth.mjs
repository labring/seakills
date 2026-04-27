#!/usr/bin/env node

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  buildAuthPrompt,
  currentWorkspaceId as currentWorkspaceIdFromAuth,
  normalizeWorkspace,
  normalizeWorkspaces,
  openBrowser,
  readAuth as readAuthFile,
  writeAuth as writeAuthFile,
} from './sealos-auth-utils.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SEALOS_DIR = join(homedir(), '.sealos')
const KC_PATH = join(SEALOS_DIR, 'kubeconfig')
const AUTH_PATH = join(SEALOS_DIR, 'auth.json')

const CONFIG_PATH = join(__dirname, '..', 'config.json')
const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
const CLIENT_ID = config.client_id
const DEFAULT_REGION = config.default_region

function check () {
  if (!existsSync(KC_PATH)) {
    return { authenticated: false }
  }

  try {
    const kc = readFileSync(KC_PATH, 'utf-8')
    if (kc.includes('server:') && (kc.includes('token:') || kc.includes('client-certificate'))) {
      const auth = existsSync(AUTH_PATH) ? JSON.parse(readFileSync(AUTH_PATH, 'utf-8')) : {}
      return {
        authenticated: true,
        kubeconfig_path: KC_PATH,
        region: auth.region || 'unknown',
        workspace: currentWorkspaceId(auth),
        tools: { kubectl: true }
      }
    }
  } catch { }

  return { authenticated: false }
}

async function requestDeviceAuthorization (region) {
  const res = await fetch(`${region}/api/auth/oauth2/device`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    })
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Device authorization request failed (${res.status}): ${body || res.statusText}`)
  }

  return res.json()
}

function readAuth () {
  return readAuthFile(AUTH_PATH)
}

function writeAuth (auth) {
  return writeAuthFile(SEALOS_DIR, AUTH_PATH, auth)
}

function currentWorkspaceId (auth = readAuth()) {
  return currentWorkspaceIdFromAuth(auth)
}

function extractToken (payload, label) {
  const token = payload?.data?.token || payload?.token
  if (!token) {
    throw new Error(`${label} response missing token`)
  }
  return token
}

function extractKubeconfig (payload, label) {
  const kubeconfig = readKubeconfig(payload)
  if (!kubeconfig) {
    throw new Error(`${label} response missing kubeconfig`)
  }
  return kubeconfig
}

function readKubeconfig (payload) {
  return payload?.data?.kubeconfig || payload?.kubeconfig || null
}

function extractWorkspaceList (payload) {
  return normalizeWorkspaces(payload?.data?.namespaces || payload?.data || payload?.namespaces || [])
}

function findCurrentWorkspace (workspaces, auth = {}) {
  const currentId = currentWorkspaceId(auth)
  return workspaces.find((workspace) => workspace.id === currentId || workspace.uid === currentId)
    || workspaces.find((workspace) => workspace.nstype === 'private')
    || workspaces[0]
    || null
}

function findWorkspace (workspaces, target) {
  const targetText = String(target || '').trim()
  if (!targetText) {
    throw new Error('Usage: node sealos-auth.mjs switch <namespace-id-or-uid>')
  }
  const targetLower = targetText.toLowerCase()
  return workspaces.find((workspace) =>
    workspace.id === targetText ||
    workspace.uid === targetText ||
    workspace.id?.toLowerCase().includes(targetLower) ||
    workspace.teamName?.toLowerCase().includes(targetLower)
  )
}

async function pollForToken (region, deviceCode, interval, expiresIn) {
  // Hard cap at 10 minutes regardless of server's expires_in
  const maxWait = Math.min(expiresIn, 600) * 1000
  const deadline = Date.now() + maxWait
  let pollInterval = interval * 1000
  let lastLoggedMinute = -1

  while (Date.now() < deadline) {
    await sleep(pollInterval)

    // Log remaining time every minute
    const remaining = Math.ceil((deadline - Date.now()) / 60000)
    if (remaining !== lastLoggedMinute && remaining > 0) {
      lastLoggedMinute = remaining
      process.stderr.write(`  Waiting for authorization... (${remaining} min remaining)\n`)
    }

    const res = await fetch(`${region}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode
      })
    })

    if (res.ok) {
      // Success — got the token
      return res.json()
    }

    const body = await res.json().catch(() => ({}))

    switch (body.error) {
      case 'authorization_pending':
        // User hasn't authorized yet, keep polling
        break

      case 'slow_down':
        // Increase polling interval by 5 seconds (RFC 8628 §3.5)
        pollInterval += 5000
        break

      case 'access_denied':
        throw new Error('Authorization denied by user')

      case 'expired_token':
        throw new Error('Device code expired. Please run login again.')

      default:
        throw new Error(`Token request failed: ${body.error || res.statusText}`)
    }
  }

  throw new Error('Authorization timed out (10 minutes). Please run login again.')
}

async function getRegionToken (region, accessToken) {
  const res = await fetch(`${region}/api/auth/regionToken`, {
    method: 'POST',
    headers: {
      Authorization: accessToken,
      'Content-Type': 'application/json'
    }
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Region token exchange failed (${res.status}): ${body || res.statusText}`)
  }

  return res.json()
}

async function fetchWorkspaces (region, regionalToken) {
  const res = await fetch(`${region}/api/auth/namespace/list`, {
    headers: { Authorization: regionalToken }
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`List workspaces failed (${res.status}): ${body || res.statusText}`)
  }

  return res.json()
}

async function switchRemoteWorkspace (region, regionalToken, nsUid) {
  const res = await fetch(`${region}/api/auth/namespace/switch`, {
    method: 'POST',
    headers: {
      Authorization: regionalToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ ns_uid: nsUid })
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Switch workspace failed (${res.status}): ${body || res.statusText}`)
  }

  return res.json()
}

async function getKubeconfig (region, regionalToken) {
  const res = await fetch(`${region}/api/auth/getKubeconfig`, {
    headers: { Authorization: regionalToken }
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Get kubeconfig failed (${res.status}): ${body || res.statusText}`)
  }

  return res.json()
}

async function listRemoteWorkspaces (auth) {
  if (!auth.region) {
    throw new Error('No region found. Please run: node sealos-auth.mjs login')
  }
  if (!auth.regional_token) {
    throw new Error('No regional_token found. Please run: node sealos-auth.mjs login')
  }
  const payload = await fetchWorkspaces(auth.region, auth.regional_token)
  const workspaces = extractWorkspaceList(payload)
  const currentWorkspace = findCurrentWorkspace(workspaces, auth)
  return {
    current: currentWorkspace?.id || null,
    workspaces,
    currentWorkspace,
  }
}

function persistSession ({ auth, region, accessToken, regionalToken, kubeconfig, workspaces, currentWorkspace }) {
  mkdirSync(SEALOS_DIR, { recursive: true })
  writeFileSync(KC_PATH, kubeconfig, { mode: 0o600 })
  writeAuth({
    ...auth,
    region,
    access_token: accessToken ?? auth.access_token,
    regional_token: regionalToken,
    authenticated_at: new Date().toISOString(),
    auth_method: 'oauth2_device_grant',
    ...(currentWorkspace ? { current_workspace: currentWorkspace } : {}),
    ...(workspaces?.length ? { workspaces } : {}),
  })
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ── Login (Device Grant Flow) ──────────────────────────

async function login (region = DEFAULT_REGION) {
  region = region.replace(/\/+$/, '')

  // Step 1: Request device authorization
  const deviceAuth = await requestDeviceAuthorization(region)
  const authPrompt = buildAuthPrompt(deviceAuth, region)

  const {
    device_code: deviceCode,
    expires_in: expiresIn,
    interval = 5
  } = deviceAuth

  // Print the authorization prompt to stderr so it's visible to the user
  // while stdout is reserved for JSON output
  process.stderr.write('\n' + authPrompt.message + '\n\nWaiting for authorization...\n')

  // Auto-open browser
  try {
    if (openBrowser(authPrompt.verification_uri_complete)) {
      process.stderr.write('Browser opened automatically.\n')
    }
  } catch {
    process.stderr.write('Could not open browser automatically. Please open the URL manually.\n')
  }

  // Step 2: Poll for token
  const tokenResponse = await pollForToken(region, deviceCode, interval, expiresIn)
  const accessToken = tokenResponse.access_token

  if (!accessToken) {
    throw new Error('Token response missing access_token')
  }

  process.stderr.write('Authorization received. Exchanging for regional token...\n')

  const existingAuth = readAuth()
  const regionData = await getRegionToken(region, accessToken)
  const regionalToken = extractToken(regionData, 'Region token')
  const kubeconfig = readKubeconfig(regionData)
    || extractKubeconfig(await getKubeconfig(region, regionalToken), 'Kubeconfig')

  let workspaces = []
  let currentWorkspace = null
  try {
    const workspacePayload = await fetchWorkspaces(region, regionalToken)
    workspaces = extractWorkspaceList(workspacePayload)
    currentWorkspace = findCurrentWorkspace(workspaces, existingAuth)
  } catch {
    // Workspace discovery is helpful for gates but should not invalidate a successful login.
  }

  persistSession({
    auth: existingAuth,
    region,
    accessToken,
    regionalToken,
    kubeconfig,
    workspaces,
    currentWorkspace,
  })

  process.stderr.write('Authentication successful!\n')

  return { kubeconfig_path: KC_PATH, region, workspace: currentWorkspace?.id || currentWorkspaceId() }
}

async function beginLogin (region = DEFAULT_REGION) {
  region = region.replace(/\/+$/, '')
  const authPrompt = buildAuthPrompt(await requestDeviceAuthorization(region), region)
  try {
    if (openBrowser(authPrompt.verification_uri_complete)) {
      process.stderr.write('Browser opened automatically.\n')
    }
  } catch {
    process.stderr.write('Could not open browser automatically. Please open the URL manually.\n')
  }
  return authPrompt
}

function parseFlagValue (args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

async function completeLogin (args) {
  const region = (parseFlagValue(args, '--region') || process.env.SEALOS_REGION || DEFAULT_REGION).replace(/\/+$/, '')
  const deviceCode = parseFlagValue(args, '--device-code')
  const intervalArg = Number.parseFloat(parseFlagValue(args, '--poll-interval') || '5')
  const pollInterval = Number.isFinite(intervalArg) && intervalArg >= 0 ? intervalArg : 5
  if (!deviceCode) {
    throw new Error('Missing --device-code')
  }
  const tokenResponse = await pollForToken(region, deviceCode, pollInterval, 600)
  const accessToken = tokenResponse.access_token
  if (!accessToken) {
    throw new Error('Token response missing access_token')
  }
  const existingAuth = readAuth()
  const regionData = await getRegionToken(region, accessToken)
  const regionalToken = extractToken(regionData, 'Region token')
  const kubeconfig = readKubeconfig(regionData)
    || extractKubeconfig(await getKubeconfig(region, regionalToken), 'Kubeconfig')
  let workspaces = []
  let currentWorkspace = null
  try {
    const workspacePayload = await fetchWorkspaces(region, regionalToken)
    workspaces = extractWorkspaceList(workspacePayload)
    currentWorkspace = findCurrentWorkspace(workspaces, existingAuth)
  } catch {
    // Workspace discovery is helpful for gates but should not invalidate a successful login.
  }
  persistSession({
    auth: existingAuth,
    region,
    accessToken,
    regionalToken,
    kubeconfig,
    workspaces,
    currentWorkspace,
  })
  return { kubeconfig_path: KC_PATH, region, workspace: currentWorkspace?.id || currentWorkspaceId() }
}

async function listWorkspaces () {
  const auth = readAuth()
  const listed = await listRemoteWorkspaces(auth)
  writeAuth({
    ...auth,
    ...(listed.currentWorkspace ? { current_workspace: listed.currentWorkspace } : {}),
    ...(listed.workspaces.length ? { workspaces: listed.workspaces } : {}),
  })
  return {
    current: listed.current,
    workspaces: listed.workspaces,
  }
}

async function switchWorkspace (target) {
  const auth = readAuth()
  const listed = await listRemoteWorkspaces(auth)
  if (listed.workspaces.length === 0) {
    throw new Error('No workspaces found')
  }

  const selected = findWorkspace(listed.workspaces, target)
  if (!selected) {
    const available = listed.workspaces
      .map((workspace) => `  ${workspace.id} (${workspace.teamName})`)
      .join('\n')
    throw new Error(`No workspace matching "${target}". Available:\n${available}`)
  }

  process.stderr.write(`Switching to workspace: ${selected.id} (${selected.teamName})...\n`)

  const switchData = await switchRemoteWorkspace(auth.region, auth.regional_token, selected.uid)
  const regionalToken = extractToken(switchData, 'Switch workspace')
  const kcData = await getKubeconfig(auth.region, regionalToken)
  const kubeconfig = extractKubeconfig(kcData, 'Kubeconfig')

  persistSession({
    auth,
    region: auth.region,
    accessToken: auth.access_token,
    regionalToken,
    kubeconfig,
    workspaces: listed.workspaces,
    currentWorkspace: normalizeWorkspace(selected),
  })

  process.stderr.write(`Switched to workspace: ${selected.id}\n`)

  return {
    workspace: normalizeWorkspace(selected),
    kubeconfig_path: KC_PATH,
  }
}

// ── Info ───────────────────────────────────────────────

function info () {
  const status = check()
  if (!status.authenticated) {
    return { authenticated: false, message: 'Not authenticated. Run: node sealos-auth.mjs login' }
  }

  const auth = existsSync(AUTH_PATH) ? JSON.parse(readFileSync(AUTH_PATH, 'utf-8')) : {}
  return {
    authenticated: true,
    kubeconfig_path: KC_PATH,
    region: auth.region || 'unknown',
    auth_method: auth.auth_method || 'unknown',
    authenticated_at: auth.authenticated_at || 'unknown'
  }
}

// ── CLI ────────────────────────────────────────────────

const [, , cmd, ...rawArgs] = process.argv

// --insecure flag: skip TLS certificate verification (for self-signed certs)
const insecure = rawArgs.includes('--insecure')
const args = rawArgs.filter(a => a !== '--insecure')

if (insecure) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
}

try {
  switch (cmd) {
    case 'check': {
      console.log(JSON.stringify(check()))
      break
    }

    case 'login': {
      const region = args[0] || process.env.SEALOS_REGION || DEFAULT_REGION
      const result = await login(region)
      console.log(JSON.stringify(result))
      break
    }

    case 'begin-login': {
      const region = args[0] || process.env.SEALOS_REGION || DEFAULT_REGION
      console.log(JSON.stringify(await beginLogin(region)))
      break
    }

    case 'complete-login': {
      console.log(JSON.stringify(await completeLogin(args)))
      break
    }

    case 'list': {
      console.log(JSON.stringify(await listWorkspaces(), null, 2))
      break
    }

    case 'switch': {
      console.log(JSON.stringify(await switchWorkspace(args[0]), null, 2))
      break
    }

    case 'info': {
      console.log(JSON.stringify(info(), null, 2))
      break
    }

    case undefined:
    case '--help':
    case '-h': {
      console.log(`Sealos Cloud Auth — OAuth2 Device Grant Flow

Usage:
  node sealos-auth.mjs check              Check authentication status
  node sealos-auth.mjs login [region]     Start OAuth2 device login flow
  node sealos-auth.mjs begin-login [region]
  node sealos-auth.mjs complete-login --region <region> --device-code <code>
  node sealos-auth.mjs list               List Sealos workspaces
  node sealos-auth.mjs switch <id>        Switch Sealos workspace and refresh kubeconfig
  node sealos-auth.mjs login --insecure   Skip TLS verification (self-signed cert)
  node sealos-auth.mjs info               Show current auth details

Environment:
  SEALOS_REGION   Region URL (default: ${DEFAULT_REGION})

Flow:
  1. Run "login" → opens browser for authorization
  2. Approve in browser → script receives token automatically
  3. Token exchanged for kubeconfig → saved to ~/.sealos/kubeconfig`)
      break
    }

    default: {
      console.error(JSON.stringify({ error: `Unknown command: ${cmd}` }))
      process.exit(1)
    }
  }
} catch (err) {
  // If TLS error and not using --insecure, hint the user
  if (!insecure && (err.message.includes('fetch failed') || err.message.includes('self-signed') || err.message.includes('CERT'))) {
    console.error(JSON.stringify({ error: err.message, hint: 'Try adding --insecure for self-signed certificates' }))
  } else {
    console.error(JSON.stringify({ error: err.message }))
  }
  process.exit(1)
}
