# Sealos Template Defaults & Display Rules

## Category Display

- Group templates by `X-Menu-Keys` response header (comma-separated category keys)
- Within each category, sort templates by `deployCount` descending (popular first)
- If no categories in response, show flat list sorted by deployCount

## Template List View

Show for each template in browse mode:
- Name
- Description (truncated to ~80 chars if long)
- Categories (comma-separated)
- Deploy count

## Template Detail View

Show all fields from `GET /templates/{name}`:
- Name, description, categories, gitRepo
- Resource quota: CPU, Memory, Storage, NodePort
- Required args: name, description, type (highlight args with `required: true` AND empty `default`)
- Optional args: name, description, type, default value
- Deploy count

## Instance Name Suggestions

Offer 2-3 clickable suggestions, but user can type anything:
- `my-{template}` — e.g., `my-perplexica`
- `{project}-{template}` — e.g., `myapp-perplexica` (from working directory name)

User-typed names are passed to API exactly as provided. No transformation.

Constraint shown in question: lowercase, alphanumeric + hyphens, 1-63 chars.

## Arg Collection Rules

### Required args (where `required: true` AND `default` is empty)
- Must be collected before deploy
- Password/secret types (`type: "password"` or name contains `KEY`, `SECRET`, `TOKEN`, `PASSWORD`):
  **No pre-filled clickable values** — user must type the value
- Boolean types: options `["true", "false"]`
- String with obvious common values: suggest up to 4 options
- Other types: no default options, user must type

### Optional args (where `required: false` OR `default` is non-empty)
- Show grouped summary with their defaults
- Offer "Use defaults (Recommended)" / "Customize"
- If customize: iterate one by one

## AskUserQuestion Option Guidelines

**Hard limit: max 4 options per `AskUserQuestion` call.** The tool auto-appends implicit
options ("Type something", "Chat about this") which consume slots. More than 4 user-provided
options will be truncated and invisible to the user.

## Display Rules for Secrets

- Mask password/secret arg values in display: show first 3 chars + `*****`
  - Example: `sk-a*****` for `sk-abcdefghijk`
- Pass real (unmasked) values to the API

## Resource Requirements Display

Show quota from template detail response before deploy:

```
Resource requirements:
  CPU:      1 vCPU
  Memory:   2.25 GiB
  Storage:  2 GiB
  NodePort: 0
```
