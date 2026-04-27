import assert from "node:assert/strict";
import test from "node:test";

import { evaluatePreflightTools } from "./preflightStep";

test("preflight only hard-blocks missing git/curl", () => {
  const result = evaluatePreflightTools({
    git: { available: true, output: "git version 2.x" },
    curl: { available: true, output: "curl 8.x" },
    docker: { available: false, output: null },
    python3: { available: false, output: null },
    gh: { available: false, output: null },
  }, false);

  assert.equal(result.fatalMessage, null);
  assert.equal(result.warnings.length, 3);
  assert.match(result.warnings[0], /deferred until local image build\/push is required/i);
  assert.match(result.warnings[1], /template validation helpers/i);
  assert.match(result.warnings[2], /GHCR auto-detection may be limited/i);
});

test("preflight still blocks missing git or curl outside dry-run", () => {
  const result = evaluatePreflightTools({
    git: { available: false, output: null },
    curl: { available: true, output: "curl 8.x" },
    docker: { available: true, output: "Docker version 27" },
    python3: { available: true, output: "Python 3.12" },
    gh: { available: true, output: "gh version 2.x" },
  }, false);

  assert.match(result.fatalMessage ?? "", /git/i);
  assert.deepEqual(result.warnings, []);
});
