import type { FastifyInstance } from "fastify";
import {
  putCredentialRequestSchema,
  type CredentialInfo,
  type ListCredentialsResponse,
} from "@agent2026/shared";
import type { CredentialStore } from "../credentials/store.js";
import type { AppConfig } from "@agent2026/shared";

export type CredentialRouteDeps = {
  store: CredentialStore;
  getConfig: () => AppConfig;
};

function refsFromConfig(config: AppConfig): string[] {
  const refs = new Set<string>();
  for (const entry of Object.values(config.providers.entries)) {
    if (entry.apiKeyEnv) {
      refs.add(entry.apiKeyEnv);
    }
  }
  return [...refs];
}

export function registerCredentialRoutes(
  app: FastifyInstance,
  deps: CredentialRouteDeps,
): void {
  app.get("/credentials", async (): Promise<ListCredentialsResponse> => {
    const refs = refsFromConfig(deps.getConfig());
    return { items: deps.store.listRefs(refs) };
  });

  app.get<{ Params: { ref: string } }>(
    "/credentials/:ref",
    async (request): Promise<CredentialInfo> => {
      return deps.store.describe(decodeURIComponent(request.params.ref));
    },
  );

  app.put<{ Params: { ref: string } }>(
    "/credentials/:ref",
    async (request, reply) => {
      const ref = decodeURIComponent(request.params.ref);
      const parsed = putCredentialRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_credential",
          message: parsed.error.message,
        });
      }
      const current = deps.store.describe(ref);
      if (!current.writable) {
        return reply.code(409).send({
          error: "credential_not_writable",
          message: `Credential "${ref}" is supplied by the process environment`,
        });
      }
      deps.store.set(ref, parsed.data.value);
      return deps.store.describe(ref);
    },
  );
}
