import Fastify from "fastify";

/** Stage-1 HTTP boundary. Authentication and persistence adapters are added behind these routes. */
export function createApp() {
  const app = Fastify({ logger: true });
  app.get("/health", async () => ({ status: "ok", service: "mairs-trivia", timestamp: new Date().toISOString() }));
  return app;
}
