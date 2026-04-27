import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { platform } from 'os'

export function readAuth (authPath) {
  return existsSync(authPath) ? JSON.parse(readFileSync(authPath, 'utf-8')) : {}
}

export function writeAuth (sealosDir, authPath, auth) {
  mkdirSync(sealosDir, { recursive: true })
  writeFileSync(authPath, JSON.stringify(auth, null, 2), { mode: 0o600 })
}

export function normalizeWorkspace (workspace) {
  if (!workspace) return null
  if (typeof workspace === 'string') return { id: workspace, uid: workspace, teamName: workspace }
  const id = workspace.id || workspace.name || workspace.uid
  if (!id) return null
  return {
    id,
    uid: workspace.uid || id,
    teamName: workspace.teamName || workspace.name || id,
    ...(workspace.role ? { role: workspace.role } : {}),
    ...(workspace.nstype ? { nstype: workspace.nstype } : {}),
  }
}

export function normalizeWorkspaces (workspaces) {
  return Array.isArray(workspaces)
    ? workspaces.map(normalizeWorkspace).filter(Boolean)
    : []
}

export function currentWorkspaceId (auth) {
  return normalizeWorkspace(auth.current_workspace || auth.workspace)?.id || null
}

export function validateBrowserUrl (url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid verification URL: ${url}`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Invalid verification URL protocol: ${parsed.protocol}`)
  }
  return parsed.toString()
}

export function openBrowser (url) {
  const safeUrl = validateBrowserUrl(url)
  if (platform() === 'darwin') {
    execFileSync('open', [safeUrl], { stdio: 'ignore' })
    return true
  }
  if (platform() === 'linux') {
    execFileSync('xdg-open', [safeUrl], { stdio: 'ignore' })
    return true
  }
  return false
}

export function buildAuthPrompt (deviceAuth, region) {
  const {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: verificationUriComplete,
    expires_in: expiresIn,
    interval = 5,
  } = deviceAuth
  const browserUrl = validateBrowserUrl(verificationUriComplete || verificationUri)
  return {
    action: 'user_authorization_required',
    region,
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: browserUrl,
    expires_in: expiresIn,
    interval,
    message: `Please open the following URL in your browser to authorize:\n\n  ${browserUrl}\n\nAuthorization code: ${userCode}\nExpires in: ${Math.floor(expiresIn / 60)} minutes`,
  }
}
