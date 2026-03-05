#!/usr/bin/env node

/**
 * Sealos Cloud Authentication — OAuth2 Device Grant Flow (RFC 8628)
 *
 * Usage:
 *   node sealos-auth.mjs check                     # Check if already authenticated
 *   node sealos-auth.mjs login [region]             # Start device grant login flow
 *   node sealos-auth.mjs info                       # Show current auth info
 *
 * Environment variables:
 *   SEALOS_REGION   — Sealos Cloud region URL (default: https://192.168.12.53.nip.io)
 *
 * Flow:
 *   1. POST /api/auth/oauth2/device  → { device_code, user_code, verification_uri_complete }
 *   2. User opens verification_uri_complete in browser to authorize
 *   3. Script polls /api/auth/oauth2/token until approved
 *   4. Receives access_token → exchanges for kubeconfig → saves to ~/.sealos/
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const SEALOS_DIR = join(homedir(), '.sealos')
const KC_PATH = join(SEALOS_DIR, 'kubeconfig')
const AUTH_PATH = join(SEALOS_DIR, 'auth.json')

const DEFAULT_REGION = 'https://192.168.12.53.nip.io'

// Pre-registered PUBLIC OAuth client for sealos-deploy skill
// This client_id must be registered on Sealos Cloud as a PUBLIC client
// with allowedGrantTypes: ["urn:ietf:params:oauth:grant-type:device_code"]
const CLIENT_ID = 'af993c98-d19d-4bdc-b338-79b80dc4f8bf'

// ── Check ──────────────────────────────────────────────

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
        namespace: auth.namespace || 'unknown'
      }
    }
  } catch { }

  return { authenticated: false }
}

// ── Device Grant Flow ──────────────────────────────────

/**
 * Step 1: Request device authorization
 * POST /api/auth/oauth2/device
 * Body: { client_id }
 * Response: { device_code, user_code, verification_uri, verification_uri_complete, expires_in, interval }
 */
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

/**
 * Step 2: Poll for token
 * POST /api/auth/oauth2/token
 * Body: { client_id, grant_type, device_code }
 *
 * Possible responses:
 * - 200: { access_token, token_type, ... }  → success
 * - 400: { error: "authorization_pending" } → keep polling
 * - 400: { error: "slow_down" }             → increase interval by 5s
 * - 400: { error: "access_denied" }         → user denied
 * - 400: { error: "expired_token" }         → device code expired
 */
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

/**
 * Step 3: Exchange access token for kubeconfig
 */
async function exchangeForKubeconfig (region, accessToken) {
  const res = await fetch(`${region}/api/auth/kubeconfig`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Kubeconfig exchange failed (${res.status}): ${body || res.statusText}`)
  }

  return res.json()
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ── Login (Device Grant Flow) ──────────────────────────

async function login (region = DEFAULT_REGION) {
  region = region.replace(/\/+$/, '')

  // Step 1: Request device authorization
  const deviceAuth = await requestDeviceAuthorization(region)

  const {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: verificationUriComplete,
    expires_in: expiresIn,
    interval = 5
  } = deviceAuth

  // Output device authorization info for the AI tool / user to display
  const authPrompt = {
    action: 'user_authorization_required',
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: verificationUriComplete,
    expires_in: expiresIn,
    message: `Please open the following URL in your browser to authorize:\n\n  ${verificationUriComplete || verificationUri}\n\nAuthorization code: ${userCode}\nExpires in: ${Math.floor(expiresIn / 60)} minutes`
  }

  // Print the authorization prompt to stderr so it's visible to the user
  // while stdout is reserved for JSON output
  process.stderr.write('\n' + authPrompt.message + '\n\nWaiting for authorization...\n')

  // Step 2: Poll for token
  const tokenResponse = await pollForToken(region, deviceCode, interval, expiresIn)
  const accessToken = tokenResponse.access_token

  if (!accessToken) {
    throw new Error('Token response missing access_token')
  }

  process.stderr.write('Authorization received. Exchanging for kubeconfig...\n')

  // Step 3: Exchange access token for kubeconfig
  const kcData = await exchangeForKubeconfig(region, accessToken)
  const kubeconfig = kcData.kubeconfig
  const namespace = kcData.namespace || ''

  if (!kubeconfig) {
    throw new Error('API response missing kubeconfig field')
  }

  // Save kubeconfig
  mkdirSync(SEALOS_DIR, { recursive: true })
  writeFileSync(KC_PATH, kubeconfig, { mode: 0o600 })

  // Save auth metadata
  writeFileSync(AUTH_PATH, JSON.stringify({
    region,
    namespace,
    authenticated_at: new Date().toISOString(),
    auth_method: 'oauth2_device_grant'
  }, null, 2), { mode: 0o600 })

  process.stderr.write('Authentication successful!\n')

  return { kubeconfig_path: KC_PATH, namespace, region }
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
    namespace: auth.namespace || 'unknown',
    auth_method: auth.auth_method || 'unknown',
    authenticated_at: auth.authenticated_at || 'unknown'
  }
}

// ── CLI ────────────────────────────────────────────────

const [, , cmd, ...args] = process.argv

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

    case 'info': {
      console.log(JSON.stringify(info(), null, 2))
      break
    }

    default: {
      console.log(`Sealos Cloud Auth — OAuth2 Device Grant Flow

Usage:
  node sealos-auth.mjs check              Check authentication status
  node sealos-auth.mjs login [region]     Start OAuth2 device login flow
  node sealos-auth.mjs info               Show current auth details

Environment:
  SEALOS_REGION   Region URL (default: ${DEFAULT_REGION})

Flow:
  1. Run "login" → opens browser for authorization
  2. Approve in browser → script receives token automatically
  3. Token exchanged for kubeconfig → saved to ~/.sealos/`)
    }
  }
} catch (err) {
  console.error(JSON.stringify({ error: err.message }))
  process.exit(1)
}
