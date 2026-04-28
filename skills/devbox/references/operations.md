# Operations Reference

## Monitor

**3a.** If no name given → List, then `AskUserQuestion` to pick which devbox.

**3b.** `AskUserQuestion` (header: "Time Range", question: "Monitoring period?"):
- "Last 1 hour"
- "Last 3 hours (default)"
- "Last 24 hours"
- "Custom range"

For "Custom range": ask for start time, end time, and step interval.

**3c.** Run `node scripts/sealos-devbox.mjs monitor {name} [start] [end] [step]`.

**3d.** Display metrics as a table:

```
Time              CPU %    Memory %
14:38             1.08     10.32
14:40             1.18     10.37
14:42             1.25     10.41
```

Highlight high utilization (>80%) with a warning.

---

## Autostart

**3a.** If no name given → List, then `AskUserQuestion` to pick which devbox.

**3b.** Run `node scripts/sealos-devbox.mjs get {name}` to show current state and runtime.

**3c.** Suggest a startup command based on the runtime:

| Runtime | Suggested command |
|---------|-------------------|
| node.js, next.js, express.js, react, vue, etc. | `npm start` or `npm run dev` |
| python, django, flask | `python manage.py runserver` or `flask run` |
| go, gin, echo, chi, iris | `go run .` |
| rust, rocket | `cargo run` |
| java, quarkus, vert.x | `mvn quarkus:dev` or `java -jar app.jar` |

**3d.** `AskUserQuestion` (header: "Autostart", question: "Startup command?"):
- Suggested command from table above
- "No command (just enable autostart)"
- "Custom command"

**3e.** Run `node scripts/sealos-devbox.mjs autostart {name} '{"execCommand":"..."}'`
or `node scripts/sealos-devbox.mjs autostart {name}` for default behavior.
