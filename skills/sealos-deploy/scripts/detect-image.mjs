#!/usr/bin/env node

/**
 * Container Image Detection
 *
 * Detects existing container images for a GitHub project.
 * Checks Docker Hub, GHCR, and README references.
 *
 * Usage:
 *   node detect-image.mjs <github-url> [work-dir]     # Remote repo
 *   node detect-image.mjs <work-dir>                   # Local project (auto-detect GitHub URL from git remote)
 *
 * Output (JSON):
 *   { "found": true, "image": "ghcr.io/zxh326/kite", "tag": "v0.4.0", "source": "ghcr-readme", "platforms": ["linux/amd64"] }
 *   { "found": false }
 */

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

// ── GitHub URL Parser ──────────────────────────────────────

function parseGithubUrl (url) {
  const sshMatch = url.match(/git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/)
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] }

  const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/.*)?$/)
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] }

  return null
}

// ── Docker Hub ─────────────────────────────────────────────

async function checkDockerHub (namespace, repoName) {
  const url = `https://hub.docker.com/v2/namespaces/${namespace}/repositories/${repoName}/tags?page_size=10`
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    const resp = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)

    if (!resp.ok) return null

    const data = await resp.json()
    if (!data.results || data.results.length === 0) return null

    const versionTagRe = /^v?\d+\.\d+/
    let bestTag = null

    for (const entry of data.results) {
      const hasAmd64 = entry.images?.some(img => img.architecture === 'amd64')
      if (!hasAmd64) continue

      const platforms = entry.images
        .map(img => `${img.os}/${img.architecture}`)
        .filter((v, i, a) => a.indexOf(v) === i)

      if (!bestTag || (versionTagRe.test(entry.name) && !versionTagRe.test(bestTag.tag))) {
        bestTag = { tag: entry.name, platforms }
      }
    }

    if (!bestTag) return null

    return { source: 'dockerhub', image: `${namespace}/${repoName}`, tag: bestTag.tag, platforms: bestTag.platforms }
  } catch {
    return null
  }
}

// ── GHCR ───────────────────────────────────────────────────

async function checkGhcr (owner, repo) {
  try {
    // Get anonymous token
    const tokenController = new AbortController()
    const tokenTimer = setTimeout(() => tokenController.abort(), 10000)
    const tokenResp = await fetch(
      `https://ghcr.io/token?scope=repository:${owner}/${repo}:pull`,
      { signal: tokenController.signal },
    )
    clearTimeout(tokenTimer)

    if (!tokenResp.ok) return null
    const { token } = await tokenResp.json()

    // List tags
    const tagsController = new AbortController()
    const tagsTimer = setTimeout(() => tagsController.abort(), 10000)
    const tagsResp = await fetch(
      `https://ghcr.io/v2/${owner}/${repo}/tags/list`,
      { headers: { Authorization: `Bearer ${token}` }, signal: tagsController.signal },
    )
    clearTimeout(tagsTimer)

    if (!tagsResp.ok) return null
    const { tags } = await tagsResp.json()
    if (!tags || tags.length === 0) return null

    // Prefer version tags
    const versionTagRe = /^v?\d+\.\d+/
    const sorted = [...tags].sort((a, b) => {
      const aVer = versionTagRe.test(a) ? 1 : 0
      const bVer = versionTagRe.test(b) ? 1 : 0
      return bVer - aVer
    })

    // Check manifest for amd64
    for (const tag of sorted.slice(0, 5)) {
      try {
        const mfController = new AbortController()
        const mfTimer = setTimeout(() => mfController.abort(), 10000)
        const mfResp = await fetch(
          `https://ghcr.io/v2/${owner}/${repo}/manifests/${tag}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json',
            },
            signal: mfController.signal,
          },
        )
        clearTimeout(mfTimer)

        if (!mfResp.ok) continue

        const manifest = await mfResp.json()
        let platforms = []

        if (manifest.manifests) {
          platforms = manifest.manifests
            .filter(m => m.platform)
            .map(m => `${m.platform.os}/${m.platform.architecture}`)
          if (!platforms.some(p => p.includes('amd64'))) continue
        } else {
          platforms = ['linux/amd64']
        }

        return { source: 'ghcr', image: `ghcr.io/${owner}/${repo}`, tag, platforms }
      } catch {
        continue
      }
    }

    return null
  } catch {
    return null
  }
}

// ── README Image Extraction ────────────────────────────────

function extractImagesFromReadme (workDir) {
  const images = []
  for (const name of ['README.md', 'readme.md', 'README.MD', 'Readme.md']) {
    const p = path.join(workDir, name)
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf-8')

      // Match ghcr.io/owner/repo:tag
      for (const m of content.matchAll(/ghcr\.io\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)(?::([a-zA-Z0-9_.-]+))?/g)) {
        images.push({ registry: 'ghcr', owner: m[1], repo: m[2], tag: m[3] || null })
      }

      // Match docker run/pull commands
      for (const m of content.matchAll(/docker\s+(?:run|pull)\s+[^\n]*?(?:docker\.io\/)?([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)(?::([a-zA-Z0-9_.-]+))?/g)) {
        if (m[1] === 'io') continue
        images.push({ registry: 'dockerhub', owner: m[1], repo: m[2], tag: m[3] || null })
      }

      break
    }
  }

  // Deduplicate
  const seen = new Set()
  return images.filter(img => {
    const key = `${img.registry}:${img.owner}/${img.repo}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ── Orchestrator ───────────────────────────────────────────

async function detectExistingImage (githubUrl, workDir) {
  const parsed = parseGithubUrl(githubUrl)
  if (!parsed) {
    return { found: false, error: 'Cannot parse GitHub URL' }
  }
  const { owner, repo } = parsed

  // Strategy 1: Check by GitHub owner/repo name
  const dockerhub = await checkDockerHub(owner, repo)
  if (dockerhub) return { found: true, ...dockerhub }

  // Fallback 1a: check <repo-name>/<repo-name> on Docker Hub (common pattern)
  // e.g., GitHub: evershopcommerce/evershop → Docker Hub: evershop/evershop
  if (repo !== owner) {
    const dockerhubFallback = await checkDockerHub(repo, repo)
    if (dockerhubFallback) return { found: true, ...dockerhubFallback }
  }

  const ghcr = await checkGhcr(owner, repo)
  if (ghcr) return { found: true, ...ghcr }

  // Strategy 2: Extract image references from README
  if (workDir) {
    const readmeImages = extractImagesFromReadme(workDir)

    for (const img of readmeImages) {
      if (img.owner === owner && img.repo === repo) continue

      if (img.registry === 'ghcr') {
        const result = await checkGhcr(img.owner, img.repo)
        if (result) return { found: true, ...result, source: `${result.source}-readme` }
      } else {
        const result = await checkDockerHub(img.owner, img.repo)
        if (result) return { found: true, ...result, source: `${result.source}-readme` }
      }
    }
  }

  return { found: false }
}

// ── Git Remote Helper ─────────────────────────────────────

function getGithubUrlFromGitRemote (dir) {
  try {
    const remote = execSync('git remote get-url origin', { cwd: dir, encoding: 'utf-8' }).trim()
    if (remote.includes('github.com')) return remote
  } catch {}
  return null
}

// ── CLI ────────────────────────────────────────────────────

const [, , arg1, arg2] = process.argv

if (!arg1) {
  console.error('Usage: node detect-image.mjs <github-url> [work-dir]')
  console.error('       node detect-image.mjs <work-dir>')
  process.exit(1)
}

// Determine if arg1 is a URL or a local path
let githubUrl, workDir
if (/^https?:\/\//.test(arg1) || arg1.startsWith('git@')) {
  githubUrl = arg1
  workDir = arg2 || '.'
} else {
  // arg1 is a local path, try to get GitHub URL from git remote
  workDir = arg1
  githubUrl = getGithubUrlFromGitRemote(workDir)
}

if (githubUrl) {
  const result = await detectExistingImage(githubUrl, workDir)
  console.log(JSON.stringify(result, null, 2))
} else {
  // No GitHub URL available — only do README scan
  const readmeImages = extractImagesFromReadme(workDir)
  for (const img of readmeImages) {
    let result
    if (img.registry === 'ghcr') {
      result = await checkGhcr(img.owner, img.repo)
    } else {
      result = await checkDockerHub(img.owner, img.repo)
    }
    if (result) {
      console.log(JSON.stringify({ found: true, ...result, source: `${result.source}-readme` }, null, 2))
      process.exit(0)
    }
  }
  console.log(JSON.stringify({ found: false }))
}
