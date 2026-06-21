import { Hono } from "hono";

import type { TwimesCoordinator } from "./durable-objects/twimes-coordinator";
import type { Env } from "./env";

export { TwimesCoordinator } from "./durable-objects/twimes-coordinator";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("ok"));

app.get("/auth/start", async (c) => await forwardToCoordinator(c.env, c.req.raw));
app.get("/auth/callback", async (c) => await forwardToCoordinator(c.env, c.req.raw));

export default {
  fetch: app.fetch,

  scheduled: async (_controller, env) => {
    const response = await getCoordinator(env).fetch(
      new Request("https://twimes.internal/scheduled", {
        method: "POST",
      }),
    );

    if (!response.ok) {
      throw new Error(`Scheduled polling failed: ${response.status} ${await response.text()}`);
    }
  },
} satisfies ExportedHandler<Env>;

const getCoordinator = (env: Env): DurableObjectStub<TwimesCoordinator> => {
  const id = env.TWIMES_COORDINATOR.idFromName("default");
  return env.TWIMES_COORDINATOR.get(id);
};

const forwardToCoordinator = async (env: Env, request: Request): Promise<Response> => {
  return await getCoordinator(env).fetch(request);
};
