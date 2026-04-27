import { defineEventHandler, getQuery } from "nitro/h3";

import { health } from "../server";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const dir = typeof query.dir === "string" ? query.dir : null;
  const response = await health(dir);
  return {
    ...response,
    retry: response.status_summary.retry,
  };
});
