import { resolve } from "node:path";

export interface Config { databasePath: string; serverAccessPassword: string; tokenSecret: string; registrationEnabled: boolean; publicBaseUrl: string; }
export function loadConfig(overrides: Partial<Config> = {}): Config {
  return {
    databasePath: process.env.DATABASE_PATH ?? resolve("data/trivia.sqlite"),
    serverAccessPassword: process.env.SERVER_ACCESS_PASSWORD ?? "development-only-change-me",
    tokenSecret: process.env.TOKEN_SECRET ?? "development-only-token-secret-change-me",
    registrationEnabled: process.env.REGISTRATION_ENABLED !== "false",
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:3000",
    ...overrides,
  };
}
