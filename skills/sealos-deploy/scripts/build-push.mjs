#!/usr/bin/env node

/**
 * Docker Build & Push
 *
 * Builds a Docker image for linux/amd64 and pushes to Docker Hub.
 *
 * Usage:
 *   node build-push.mjs <work-dir> <docker-hub-user> <repo-name>
 *
 * Output (JSON):
 *   { "success": true, "image": "zhujingyang/kite:20260304" }
 *   { "success": false, "error": "build failed: ..." }
 */

import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'

function getDateTag () {
  const d = new Date()
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const time = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`
  return `${date}-${time}`
}

function isDockerHubUser (value) {
  return /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value)
}

function buildFailedArtifact ({ workDir, registry, imageName, remoteImage, error, startedAt }) {
  const finishedAt = new Date().toISOString()
  const buildDir = path.join(workDir, '.sealos', 'build')
  fs.mkdirSync(buildDir, { recursive: true })
  fs.writeFileSync(
    path.join(buildDir, 'build-result.json'),
    `${JSON.stringify({
      outcome: 'failed',
      registry,
      build: { image_name: imageName, started_at: startedAt },
      push: { remote_image: remoteImage },
      error,
      finished_at: finishedAt,
    }, null, 2)}\n`,
  )
}

function writeSuccessArtifact ({ workDir, registry, imageName, remoteImage, startedAt }) {
  const finishedAt = new Date().toISOString()
  const buildDir = path.join(workDir, '.sealos', 'build')
  fs.mkdirSync(buildDir, { recursive: true })
  fs.writeFileSync(
    path.join(buildDir, 'build-result.json'),
    `${JSON.stringify({
      outcome: 'success',
      registry,
      build: { image_name: imageName, started_at: startedAt },
      push: { remote_image: remoteImage, pushed_at: finishedAt },
      finished_at: finishedAt,
    }, null, 2)}\n`,
  )
}

function buildAndPush (workDir, dockerHubUser, repoName) {
  const startedAt = new Date().toISOString()
  const registry = 'dockerhub'
  const tag = getDateTag()
  const normalizedDockerHubUser = String(dockerHubUser || '').trim()
  if (!isDockerHubUser(normalizedDockerHubUser)) {
    return { success: false, error: `Invalid Docker Hub user: ${dockerHubUser}` }
  }

  const sanitized = repoName.toLowerCase().replace(/[^a-z0-9_.-]/g, '-')
  const remoteImage = `${normalizedDockerHubUser}/${sanitized}:${tag}`

  const dockerfilePath = path.join(workDir, 'Dockerfile')
  if (!fs.existsSync(dockerfilePath)) {
    return { success: false, error: 'No Dockerfile found in work directory' }
  }

  try {
    execFileSync(
      'docker',
      ['buildx', 'build', '--platform', 'linux/amd64', '-t', remoteImage, '--push', '.'],
      { cwd: workDir, stdio: 'pipe', timeout: 600000 },
    )

    writeSuccessArtifact({
      workDir,
      registry,
      imageName: sanitized,
      remoteImage,
      startedAt,
    })

    return { success: true, image: remoteImage, registry }
  } catch (e) {
    const error = e.stderr?.toString() || e.message
    buildFailedArtifact({
      workDir,
      registry,
      imageName: sanitized,
      remoteImage,
      error,
      startedAt,
    })
    return { success: false, error }
  }
}

// ── CLI ────────────────────────────────────────────────────

const [, , workDir, dockerHubUser, repoName] = process.argv

if (!workDir || !dockerHubUser || !repoName) {
  console.error('Usage: node build-push.mjs <work-dir> <docker-hub-user> <repo-name>')
  process.exit(1)
}

const result = buildAndPush(path.resolve(workDir), dockerHubUser, repoName)
console.log(JSON.stringify(result, null, 2))

if (!result.success) process.exit(1)
