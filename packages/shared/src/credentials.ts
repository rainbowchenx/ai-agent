import { z } from "zod";

export const credentialInfoSchema = z.object({
  ref: z.string().min(1),
  configured: z.boolean(),
  source: z.enum(["env", "credentials"]).optional(),
  writable: z.boolean(),
});

export type CredentialInfo = z.infer<typeof credentialInfoSchema>;

export const putCredentialRequestSchema = z.object({
  value: z.string(),
});

export type PutCredentialRequest = z.infer<typeof putCredentialRequestSchema>;

export type ListCredentialsResponse = {
  items: CredentialInfo[];
};

export type SystemPathsResponse = {
  configPath: string;
  credentialsPath: string;
  version: string;
};
