# Sealos Devbox Defaults & Presets

## Resource Presets (internal)

Used to set initial default values based on user intent. These are NOT shown
to the user as "tiers" — the user sees individual CPU/Memory fields.

| Scenario | CPU | Memory | Trigger phrases |
|----------|-----|--------|-----------------|
| Default | 1 | 2 GB | no size hint, "dev", "testing", "try" |
| Medium | 2 | 4 GB | "medium", "moderate" |
| Production | 4 | 8 GB | "prod", "production", "deploy", "release" |
| Minimal | 0.5 | 1 GB | "minimal", "tiny", "small", "lightweight" |
| Custom | — | — | specific numbers like "4 cores, 8g memory" |

## Runtime Recommendation Rules

Match project tech stack to a recommended runtime.

| Project file signals | Recommended runtime | Why |
|---------------------|--------------------|----|
| `package.json` + `next.config.*` | `next.js` | Next.js framework detected |
| `package.json` + `nuxt.config.*` | `nuxt3` | Nuxt 3 framework detected |
| `package.json` + `angular.json` | `angular` | Angular framework detected |
| `package.json` + `svelte.config.*` | `svelte` | Svelte framework detected |
| `package.json` + `astro.config.*` | `astro` | Astro framework detected |
| `package.json` + `.umirc.*` or `config/config.*` | `umi` | Umi framework detected |
| `package.json` + `vue.config.*` or `vite.config.*` + vue dep | `vue` | Vue framework detected |
| `package.json` + react dep (no Next/Nuxt/Astro) | `react` | React app detected |
| `package.json` + express dep | `express.js` | Express.js app detected |
| `package.json` (generic) | `node.js` | Node.js project |
| `go.mod` + gin import | `gin` | Gin framework detected |
| `go.mod` + echo import | `echo` | Echo framework detected |
| `go.mod` + chi import | `chi` | Chi framework detected |
| `go.mod` + iris import | `iris` | Iris framework detected |
| `go.mod` (generic) | `go` | Go project |
| `requirements.txt` or `pyproject.toml` + django | `django` | Django framework detected |
| `requirements.txt` or `pyproject.toml` + flask | `flask` | Flask framework detected |
| `requirements.txt` or `pyproject.toml` (generic) | `python` | Python project |
| `Cargo.toml` + rocket dep | `rocket` | Rocket framework detected |
| `Cargo.toml` (generic) | `rust` | Rust project |
| `pom.xml` or `build.gradle` + quarkus | `quarkus` | Quarkus framework detected |
| `pom.xml` or `build.gradle` + vertx | `vert.x` | Vert.x framework detected |
| `pom.xml` or `build.gradle` (generic) | `java` | Java project |
| `*.csproj` or `*.sln` | `net` | .NET project |
| `composer.json` | `php` | PHP project |
| `docusaurus.config.*` | `docusaurus` | Docusaurus project |
| `docs/` + `mkdocs.yml` or VitePress config | `vitepress` | Documentation project |
| `_config.yml` (Hexo) | `hexo` | Hexo project |
| `nginx.conf` or static HTML | `nginx` | Static site |
| No project files / general purpose | `ubuntu` | General-purpose dev environment |

When multiple runtimes fit, prefer the first match (more specific wins).

## Config Summary Template

Display this read-only summary before asking the user to confirm or customize.

```
Devbox config:

  Name:     [name]
  Runtime:  [runtime] ([reason])
  CPU:      [n] Core(s)
  Memory:   [n] GB
  Ports:    [port1] (http, public), [port2] (grpc, private)
```

## Field Generation Rules

- **Runtime list**: always derive from `sealos-devbox.mjs templates` output, not hardcoded
- **Runtime suffix for name**: py, node, go, rs, java, next, vue, react, ng, svelte, nuxt, astro, umi, express, django, flask, gin, echo, chi, iris, rocket, vertx, quarkus, net, php, nginx, hexo, docusaurus, vitepress, ubuntu, debian, c, cpp, claude-code, sealaf
- **Name**: `[project-directory-name]-[runtime-suffix]`, lowercased, truncated to 63 chars

## AskUserQuestion Option Guidelines

**Hard limit: max 4 options per `AskUserQuestion` call.** The tool auto-appends implicit
options ("Type something", "Chat about this") which consume slots. More than 4 user-provided
options will be truncated and invisible to the user.

When building options for `AskUserQuestion`:
- **Name options**: generate 2-3 name suggestions from project dir + runtime. If a name
  already exists (from list), avoid it and note the conflict.
- **Runtime options**: Always output ALL runtimes as a numbered text list first, then
  AskUserQuestion with max 4 clickable options (top 4 runtimes for the context).
  Mark recommended with "(Recommended)". User can type any other runtime name/number.
- **CPU options**: max 4 items: 0.5, 1, 2, 4 cores.
- **Memory options**: max 4 items: 1, 2, 4, 8 GB.
- For all resource options, mark current value with "(current)".
  User can type other valid values via "Type something".
- **Devbox picker** (for get/update/delete/action): list devbox names from
  `sealos-devbox.mjs list` as options, up to 4. If more than 4, show most recent ones.

## Default Ports by Runtime

These come from the templates API `config.appPorts` field. Common defaults:

| Runtime | Default Port | Protocol |
|---------|-------------|----------|
| Most frameworks | 8080 | http |
| next.js | 3000 | http |
| react | 3000 | http |
| vue | 3000 | http |
| angular | 4200 | http |
| svelte | 5173 | http |
| astro | 4321 | http |
| nuxt3 | 3000 | http |
| nginx | 80 | http |
| express.js | 3000 | http |
| django | 8000 | http |
| flask | 5000 | http |

**Note:** Always prefer the port from the templates API over this table. This table is a
fallback reference only.

## SSH Key Management

- **Key path**: `~/.config/sealos-devbox/keys/{name}.pem`
- **Permissions**: `0600` (read/write owner only)
- **Auto-save**: The script automatically saves the private key on `create` and `create-wait`

### SSH Config Format

When offering to write SSH config, use this format:

```
Host sealos-{name}
    HostName {ssh.host}
    Port {ssh.port}
    User {ssh.user}
    IdentityFile ~/.config/sealos-devbox/keys/{name}.pem
    StrictHostKeyChecking no
```

### VS Code Remote SSH

After writing SSH config, the user can connect via:
- VS Code: `Remote-SSH: Connect to Host...` → select `sealos-{name}`
- Terminal: `ssh sealos-{name}`
