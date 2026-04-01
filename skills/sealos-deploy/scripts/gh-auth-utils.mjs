#!/usr/bin/env node

import { execSync } from 'child_process'

export function run (cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe', ...opts }).trim()
}

export function hasGhCli () {
  try {
    run('gh --version')
    return true
  } catch {
    return false
  }
}

export function getGhAuthStatusOutput () {
  try {
    return {
      authenticated: true,
      output: run('gh auth status 2>&1'),
    }
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}`.trim()
    return {
      authenticated: false,
      output,
    }
  }
}

export function parseGhScopes (statusOutput) {
  const text = String(statusOutput || '')
  const scopes = Array.from(text.matchAll(/'([^']+)'/g), (match) => match[1])
  return Array.from(new Set(scopes))
}

export function getMissingScopes (presentScopes, requiredScopes) {
  const have = new Set(presentScopes)
  return requiredScopes.filter(scope => !have.has(scope))
}

export function ensureGhScopes (requiredScopes, purpose) {
  if (!hasGhCli()) {
    return {
      ok: false,
      error: 'gh CLI is not installed. Install it with: brew install gh && gh auth login',
    }
  }

  const status = getGhAuthStatusOutput()
  if (!status.authenticated) {
    return {
      ok: false,
      error: 'gh CLI not authenticated. Run: gh auth login',
    }
  }

  const missingScopes = getMissingScopes(parseGhScopes(status.output), requiredScopes)
  if (missingScopes.length === 0) {
    return { ok: true, scopes: parseGhScopes(status.output) }
  }

  const scopeList = requiredScopes.join(',')
  const missingList = missingScopes.join(', ')
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return {
      ok: false,
      error: `gh CLI is authenticated but missing required GitHub scopes for ${purpose}: ${missingList}. Run: gh auth refresh -h github.com -s ${scopeList}`,
    }
  }

  console.error(`gh CLI is missing required GitHub scopes for ${purpose}: ${missingList}. Refreshing once so the same token can cover the full GHCR flow...`)

  try {
    execSync(`gh auth refresh -h github.com -s ${scopeList}`, { stdio: 'inherit' })
  } catch {
    return {
      ok: false,
      error: `gh auth refresh was not completed. Required scopes for ${purpose}: ${missingList}`,
    }
  }

  const refreshedStatus = getGhAuthStatusOutput()
  if (!refreshedStatus.authenticated) {
    return {
      ok: false,
      error: 'gh CLI is no longer authenticated after scope refresh. Run: gh auth login',
    }
  }

  const remainingMissing = getMissingScopes(parseGhScopes(refreshedStatus.output), requiredScopes)
  if (remainingMissing.length > 0) {
    return {
      ok: false,
      error: `gh CLI is still missing required GitHub scopes for ${purpose}: ${remainingMissing.join(', ')}`,
    }
  }

  return { ok: true, scopes: parseGhScopes(refreshedStatus.output), refreshed: true }
}
