---
name: sealos-template
description: >-
  Use when someone needs to deploy applications from templates on Sealos: browse
  templates, view template details, deploy from catalog, or deploy custom YAML.
  Triggers on "deploy perplexica", "show available templates", "deploy from template",
  "list Sealos apps", "deploy this YAML", "what apps can I deploy on Sealos",
  "self-host X on Sealos", "deploy open-source app", "run X on Sealos",
  "what templates are available", or "I need a database/AI tool/search engine on Sealos".
  Also use when deploying custom template YAML files, Sealos Template CRDs, or
  any application from the Sealos template catalog.
---

## Interaction Principle — MANDATORY

**NEVER output a question as plain text. ALWAYS use `AskUserQuestion` with an `options` array.**

WHY: Plain-text questions force the user to type free-form answers instead of clicking.
Every user-facing question must go through `AskUserQuestion` with options — no exceptions.

- Keep text output before `AskUserQuestion` to one short sentence max (status update only)
- `AskUserQuestion` always adds an implicit "Other / Type something" option automatically

**Free-text matching:** When the user types free text instead of clicking an option,
match it to the closest option by intent. Examples:
- "show all", "browse all" → treat as "Browse all"
- "deploy it", "yes deploy" → treat as "Deploy now"
- "perplexica", "perplexica template" → treat as selecting that template

Never re-ask the same question because the wording didn't match exactly.

## Fixed Execution Order

**ALWAYS follow these steps in this exact order. No skipping, no reordering.**

```
Step 0: Check Auth         (try existing config from previous session)
Step 1: Authenticate        (only if Step 0 fails)
Step 2: Route               (determine which operation the user wants)
Step 3: Execute operation   (follow the operation-specific steps below)
```

---

## Step 0: Check Auth & Language

The script auto-derives its API URL from `~/.sealos/auth.json` (saved by login),
falling back to the default region in `config.json` for public operations.
Credentials are read from `~/.sealos/kubeconfig` only when deploying.

**Language:** If the user writes in Chinese or mentions a Chinese region (gzg, bja, hzh),
use `--language=zh` for all list/get commands. Otherwise default to English.

1. Run `node scripts/sealos-template.mjs list` (works without auth — uses default region as fallback)
2. If works → skip Step 1. Greet: "Connected to Sealos. N templates available."
   Use this result in Step 3 instead of calling list again.
3. If fails (connection error) → proceed to Step 1

**Note:** Browsing is public (no auth needed). Auth is only validated on deploy operations.
First-time users can browse the full catalog without logging in.

---

## Step 1: Authenticate

### 1a. OAuth2 Login

Read `config.json` (in this skill's directory) for available regions.
Ask user which region via `AskUserQuestion` with regions as options.

Run `node scripts/sealos-auth.mjs login`.

This command:
1. Opens the user's browser to the Sealos authorization page
2. Displays a user code and verification URL in stderr
3. Polls until the user approves (max 10 minutes)
4. Exchanges the token for a kubeconfig
5. Saves to `~/.sealos/kubeconfig` and `~/.sealos/auth.json`

Display while waiting:
> Opening browser for Sealos login... Approve the request in your browser.

**If TLS error**: Retry with `node scripts/sealos-auth.mjs login --insecure`

**If other error**:
`AskUserQuestion`:
- header: "Login Failed"
- question: "Browser login failed. Try again?"
- options: ["Try again", "Cancel"]

### 1b. Verify connection

After login, run `node scripts/sealos-template.mjs list` to verify auth works.

- If auth error (401) → re-run login
- If success → "Connected to Sealos. N templates available."

Use the template list in Step 3 instead of making a separate list call.

---

## Step 2: Route

Determine the operation from user intent:

| Intent | Operation |
|--------|-----------|
| "list/show/browse templates" | Browse |
| "what apps can I deploy" | Browse |
| "deploy X" / "I need X" | Deploy |
| "deploy this YAML" / "deploy custom template" / "deploy this Sealos Template CRD" | Deploy Raw |
| "show template details" / "what does X need" | Details |


If ambiguous, ask one clarifying question.

---

## Step 3: Operations

### Browse

1. Run `node scripts/sealos-template.mjs list` command, get template array + `menuKeys` categories
2. If categories exist (`menuKeys` is non-empty), group templates by category, sort by `deployCount` within each
3. Display categorized list: name, description, deployCount
4. `AskUserQuestion`: top 4 categories as options (header: "Category", question: "Browse by category?")
5. After user picks category → show templates in that category
6. `AskUserQuestion`: top 4 templates as options (header: "Template", question: "Which template?")
7. After selection → proceed to Details

---

### Details

1. Run `node scripts/sealos-template.mjs get <name>` command
2. Display all fields:
   - Name, description, categories, gitRepo
   - Resource quota: CPU, Memory, Storage, NodePort
   - Required args: name, description, type (highlight required with no default)
   - Optional args: name, description, type, default value
   - Deploy count
3. `AskUserQuestion`: "Deploy this template" / "Browse more" / "Done"

---

### Deploy (`POST /templates/instances`)

1. If template name not known → run Browse first
2. Run `node scripts/sealos-template.mjs get <name>` to fetch template details with quota and args
3. Show resource requirements (quota from API response):
   ```
   Resource requirements:
     CPU:      1 vCPU
     Memory:   2.25 GiB
     Storage:  2 GiB
     NodePort: 0
   ```

4. **Ensure auth:** If not yet authenticated (no kubeconfig), run Step 1 now.
   Browse is public but deploy requires auth.

5. Collect required args (where `required: true` AND `default` is empty string):
   - For each: `AskUserQuestion` with arg description and type
   - Password/secret types (type is `"password"` or name contains KEY, SECRET, TOKEN, PASSWORD):
     no pre-filled options, user must type
   - Boolean types: options `["true", "false"]`
   - String with obvious values: suggest up to 4 options
6. Show optional args with their defaults, `AskUserQuestion`: "Use defaults (Recommended)" / "Customize"
   - If customize: iterate through optional args one by one
7. Ask instance name: `AskUserQuestion` with 2-3 suggestions (`my-{template}`, `{project}-{template}`)
   - **User can type any name — passed to API exactly as typed**
   - Constraint shown in question: lowercase, alphanumeric + hyphens, 1-63 chars
8. Display confirmation summary:
   - Template name, instance name, all args (mask password/secret values: first 3 chars + `*****`)
   - Resource requirements
9. `AskUserQuestion`: "Deploy now" / "Edit args" / "Cancel"
10. Run `node scripts/sealos-template.mjs create '<json>'` with exact `{name, template, args}` — **no modification of any values**
11. Display API response: instance name, uid, createdAt, resources list with quotas

---

### Deploy Raw (`POST /templates/raw`)

1. `AskUserQuestion`: "From a file in my project" / "I'll provide it"
2. If file → ask path, read file content as YAML string
3. `AskUserQuestion`: "Dry-run first (Recommended)" / "Deploy directly" (maps to `dryRun: true/false`)
4. If template YAML has required args without defaults → collect via `AskUserQuestion`
5. Build the JSON body: `{yaml, args, dryRun}` — **no modification**
6. Run `node scripts/sealos-template.mjs create-raw '<json>'`
   - For large JSON bodies, write to a temp file and pass the file path instead
7. If dry-run → show preview (200 response: auto-generated name, resources), then confirm actual deploy
8. If deploy → show result (201 response)

---

## Scripts

Two entry points in `scripts/` (relative to this skill's directory):
- `sealos-auth.mjs` — OAuth2 Device Grant login (shared across all skills)
- `sealos-template.mjs` — Template browsing and deployment operations

**The scripts are bundled with this skill — do NOT check if they exist. Just run them.**

**Path resolution:** Scripts are in this skill's `scripts/` directory. The full path is
listed in the system environment's "Additional working directories" — use it directly.

**Config resolution:** The script reads `~/.sealos/auth.json` (region) and `~/.sealos/kubeconfig`
(credentials) — both created by `sealos-auth.mjs login`.

**Auth commands** (`$DIR` = this skill's `scripts/` directory):
```bash
node $DIR/sealos-auth.mjs check              # Check if authenticated
node $DIR/sealos-auth.mjs login               # Start OAuth2 login
node $DIR/sealos-auth.mjs login --insecure    # Skip TLS verification
node $DIR/sealos-auth.mjs info                # Show auth details
```

**Template commands:**
```bash
node $DIR/sealos-template.mjs list                          # list all templates (public, no auth)
node $DIR/sealos-template.mjs list --language=zh            # list in Chinese
node $DIR/sealos-template.mjs get perplexica                # get template details (public, no auth)
node $DIR/sealos-template.mjs get perplexica --language=zh  # get details in Chinese
node $DIR/sealos-template.mjs create '{"name":"my-app","template":"perplexica","args":{"OPENAI_API_KEY":"sk-xxx"}}'
node $DIR/sealos-template.mjs create-raw '{"yaml":"apiVersion: app.sealos.io/v1\nkind: Template\n...","dryRun":true}'
node $DIR/sealos-template.mjs create-raw /path/to/body.json  # read JSON body from file
```

## Reference Files

- `references/api-reference.md` — API endpoints, instance name constraints, error formats. Read first.
- `references/defaults.md` — Display rules, arg collection rules, masking. Read for deploy operations.
- `references/openapi.json` — Complete OpenAPI spec. Read only for edge cases.

## Error Handling

**Treat each error independently.** Do NOT chain unrelated errors.

| HTTP Status | Error Code | Action |
|-------------|------------|--------|
| 400 | INVALID_PARAMETER | Show which field is invalid from details array, re-ask |
| 400 | INVALID_VALUE | Show validation message (e.g., name format rules), re-ask |
| 401 | AUTHENTICATION_REQUIRED | Run `node scripts/sealos-auth.mjs login` to re-authenticate |
| 403 | PERMISSION_DENIED | Show details, suggest checking permissions |
| 404 | NOT_FOUND | Template doesn't exist in catalog, show list for user to pick |
| 409 | ALREADY_EXISTS | Instance name taken, ask for alternative name |
| 422 | INVALID_RESOURCE_SPEC | Show K8s rejection reason from details |
| 500 | KUBERNETES_ERROR / INTERNAL_ERROR | Show error message and details |
| 503 | SERVICE_UNAVAILABLE | Cluster unreachable, retry later |

## Rules

- NEVER ask a question as plain text — ALWAYS use `AskUserQuestion` with options
- NEVER ask user to manually download kubeconfig — always use `scripts/sealos-auth.mjs login`
- NEVER run `test -f` or `ls` on the skill scripts — they are always present, just run them
- NEVER write kubeconfig to `~/.kube/config` — may overwrite user's existing config
- NEVER echo kubeconfig content to output
- NEVER construct HTTP requests inline — always use `scripts/sealos-template.mjs`
- NEVER modify user-provided values (name, args) before passing to API
- Mask password/secret arg values in display only (pass real values to API)
- Instance name passed to API exactly as user provides it
