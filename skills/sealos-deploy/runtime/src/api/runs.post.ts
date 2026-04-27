import { defineEventHandler, getQuery } from "nitro/h3";

import type { WorkflowRunRequest } from "../types";
import {
  normalizeWorkflowInput,
  normalizeWorkflowRunOptions,
  startSealosDeployRun,
} from "../server";

export default defineEventHandler(async (event) => {
  const body = await event.req.json() as WorkflowRunRequest;
  const query = getQuery(event);
  const wait = body.wait === true || query.wait === "1" || query.wait === "true";
  const input = normalizeWorkflowInput(body);
  const runOptions = normalizeWorkflowRunOptions(body);

  return startSealosDeployRun(input, { wait, runOptions });
});
