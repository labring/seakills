#!/usr/bin/env node

/**
 * Docker Build & Push (GHCR + Docker Hub)
 *
 * Builds a Docker image for linux/amd64 and pushes to a container registry.
 * Automatically selects the best registry: GHCR (via gh CLI) > Docker Hub.
 *
 * Usage:
 *   node build-push.mjs <work-dir> <repo-name>              # auto-detect registry
 *   node build-push.mjs <work-dir> <repo-name> --registry ghcr
 *   node build-push.mjs <work-dir> <repo-name> --registry dockerhub --user <docker-hub-user>
 *
 * Output (JSON):
 *   { "success": true, "image": "ghcr.io/owner/repo:20260304-143022", "registry": "ghcr" }
 *   { "success": false, "error": "build failed: ..." }
 */

import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { validateArtifactData } from './artifact-validator.mjs'

// ── Helpers ───────────────────────────────────────────────

function getDateTag () {
  const d = new Date()
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const time = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`
  return `${date}-${time}`
}

function run (cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe', ...opts }).trim()
}

function ensureBuildDir (workDir) {
  const buildDir = path.join(workDir, '.sealos', 'build')
  fs.mkdirSync(buildDir, { recursive: true })
  return buildDir
}

function writeBuildResult (workDir, payload) {
  const validation = validateArtifactData('build-result', payload)
  if (!validation.valid) {
    throw new Error(`Invalid build-result artifact: ${validation.errors.map(err => `${err.path} ${err.message}`).join('; ')}`)
  }

  const buildDir = ensureBuildDir(workDir)
  fs.writeFileSync(
    path.join(buildDir, 'build-result.json'),
    JSON.stringify(payload, null, 2),
  )
}

// ── Registry Detection ───────────────────────────────────

function detectGhcr () {
  try {
    run('gh auth status')
    const user = run('gh api user -q .login')
    if (!user) return null
    return { registry: 'ghcr', user }
  } catch {
    return null
  }
}

function loginGhcr (user) {
  try {
    const token = run('gh auth token')
    execSync(`echo "${token}" | docker login ghcr.io -u ${user} --password-stdin`, { stdio: 'pipe' })
    return true
  } catch (e) {
    return false
  }
}

function detectDockerHub () {
  try {
    const info = run('docker info 2>/dev/null')
    const match = info.match(/Username:\s*(\S+)/)
    if (match) return { registry: 'dockerhub', user: match[1] }
    return null
  } catch {
    return null
  }
}

/**
 * Auto-detect the best available registry.
 * Priority: GHCR (via gh CLI) > Docker Hub (already logged in)
 */
function autoDetectRegistry () {
  // 1. Try GHCR via gh CLI
  const ghcr = detectGhcr()
  if (ghcr) {
    const loggedIn = loginGhcr(ghcr.user)
    if (loggedIn) return ghcr
  }

  // 2. Try Docker Hub (already logged in)
  const dockerhub = detectDockerHub()
  if (dockerhub) return dockerhub

  // 3. Nothing available
  return null
}

// ── Build & Push ─────────────────────────────────────────

function buildAndPush (workDir, repoName, registryInfo) {
  const tag = getDateTag()
  const sanitized = repoName.toLowerCase().replace(/[^a-z0-9_.-]/g, '-')
  const startedAt = new Date().toISOString()

  let remoteImage
  if (registryInfo.registry === 'ghcr') {
    remoteImage = `ghcr.io/${registryInfo.user}/${sanitized}:${tag}`
  } else {
    remoteImage = `${registryInfo.user}/${sanitized}:${tag}`
  }

  const dockerfilePath = path.join(workDir, 'Dockerfile')
  if (!fs.existsSync(dockerfilePath)) {
    writeBuildResult(workDir, {
      outcome: 'failed',
      registry: registryInfo.registry,
      build: { image_name: sanitized, started_at: startedAt },
      push: { remote_image: remoteImage },
      error: 'No Dockerfile found in work directory',
      finished_at: new Date().toISOString(),
    })
    return { success: false, error: 'No Dockerfile found in work directory' }
  }

  try {
    execSync(
      `docker buildx build --platform linux/amd64 -t ${remoteImage} --push .`,
      { cwd: workDir, stdio: 'pipe', timeout: 600000 },
    )

    writeBuildResult(workDir, {
      outcome: 'success',
      registry: registryInfo.registry,
      build: { image_name: sanitized, started_at: startedAt },
      push: { remote_image: remoteImage, pushed_at: new Date().toISOString() },
      finished_at: new Date().toISOString(),
    })

    return { success: true, image: remoteImage, registry: registryInfo.registry }
  } catch (e) {
    const error = e.stderr?.toString() || e.message
    writeBuildResult(workDir, {
      outcome: 'failed',
      registry: registryInfo.registry,
      build: { image_name: sanitized, started_at: startedAt },
      push: { remote_image: remoteImage },
      error,
      finished_at: new Date().toISOString(),
    })
    return { success: false, error }
  }
}

// ── CLI ────────────────────────────────────────────────────

function parseArgs (argv) {
  const args = argv.slice(2)
  const parsed = { workDir: null, repoName: null, registry: null, user: null }

  const positional = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--registry' && args[i + 1]) {
      parsed.registry = args[++i]
    } else if (args[i] === '--user' && args[i + 1]) {
      parsed.user = args[++i]
    } else {
      positional.push(args[i])
    }
  }

  parsed.workDir = positional[0] || null
  parsed.repoName = positional[1] || null
  return parsed
}

const args = parseArgs(process.argv)

if (!args.workDir || !args.repoName) {
  console.error('Usage: node build-push.mjs <work-dir> <repo-name> [--registry ghcr|dockerhub] [--user <user>]')
  process.exit(1)
}

// Determine registry
let registryInfo

if (args.registry === 'ghcr') {
  // Explicit GHCR
  const ghcr = detectGhcr()
  if (!ghcr) {
    console.log(JSON.stringify({ success: false, error: 'gh CLI not authenticated. Run: gh auth login' }))
    process.exit(1)
  }
  if (!loginGhcr(ghcr.user)) {
    console.log(JSON.stringify({ success: false, error: 'Failed to login to ghcr.io via gh CLI' }))
    process.exit(1)
  }
  registryInfo = ghcr
} else if (args.registry === 'dockerhub') {
  // Explicit Docker Hub
  if (!args.user) {
    const dh = detectDockerHub()
    if (!dh) {
      console.log(JSON.stringify({ success: false, error: 'Not logged in to Docker Hub. Run: docker login' }))
      process.exit(1)
    }
    registryInfo = dh
  } else {
    registryInfo = { registry: 'dockerhub', user: args.user }
  }
} else {
  // Auto-detect
  registryInfo = autoDetectRegistry()
  if (!registryInfo) {
    console.log(JSON.stringify({
      success: false,
      error: 'No container registry available. Install gh CLI (brew install gh && gh auth login) or run docker login.',
    }))
    process.exit(1)
  }
}

const result = buildAndPush(path.resolve(args.workDir), args.repoName, registryInfo)
console.log(JSON.stringify(result, null, 2))

if (!result.success) process.exit(1)
