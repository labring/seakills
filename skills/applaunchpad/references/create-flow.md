# Create Customize Flow

## 3d-customize: Pick fields to change, then configure only those

`AskUserQuestion`:
- header: "Customize"
- question: "Which fields do you want to change?"
- multiSelect: true
- options: **(max 4 items)** — group into 4:
  - "Image & Command — {current_image}"
  - "Resources (CPU, Memory, Scaling) — {cpu}C / {mem}GB / {replicas}rep"
  - "Networking (Ports) — {port_summary}"
  - "Advanced (Env, ConfigMap, Storage)"

When **"Image & Command"** selected:
- Ask for imageName
- If private registry needed: ask username, password, serverAddress
- If launch command needed: ask command and args

When **"Resources"** selected → ask sequentially:

**CPU** → `AskUserQuestion`:
- header: "CPU"
- question: "CPU cores? (0.1-32)"
- options: `0.2 (current), 0.5, 1, 2` cores. Mark current with "(current)".

**Memory** → `AskUserQuestion`:
- header: "Memory"
- question: "Memory? (0.1-32 GB)"
- options: `0.5 (current), 1, 2, 4` GB. Mark current with "(current)".

**Scaling** → `AskUserQuestion`:
- header: "Scaling"
- question: "Fixed replicas or auto-scaling (HPA)?"
- options:
  1. "Fixed replicas (current)" → ask replica count
  2. "Auto-scaling (HPA)" → ask target metric, value%, min, max

If user explicitly mentions GPU or project context indicates ML/AI workload:
**GPU** → `AskUserQuestion`:
- header: "GPU"
- question: "GPU type?"
- options: `A100, V100, T4, Skip`

When **"Networking"** selected:
- Ask for port number, protocol (show enum: http, grpc, ws, tcp, udp, sctp)
- If protocol is http/grpc/ws: ask isPublic toggle
- Note: isPublic is only effective for http/grpc/ws protocols

When **"Advanced"** selected:
- Ask about env variables (name=value pairs)
- Ask about configMap files (path + content)
- Ask about storage volumes (name, path, size)

After all fields, re-display the updated config summary and `AskUserQuestion`:
- header: "Config"
- question: "Create with this config?"
- options:
  1. "Create now (Recommended)"
  2. "Customize" — re-run the customize flow
