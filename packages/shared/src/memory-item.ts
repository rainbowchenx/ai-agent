import { z } from "zod";

export const memoryKindSchema = z.enum([
  "fact",
  "procedure",
  "preference",
  "boundary",
]);

export const memoryStatusSchema = z.enum([
  "candidate",
  "frozen",
  "rejected",
]);

export const memoryItemSchema = z.object({
  kind: memoryKindSchema,
  when: z.string().min(1),
  do: z.string().min(1),
  outcome: z.string().min(1),
  confidence: z.number().min(0).max(1),
  status: memoryStatusSchema,
  sourceRunId: z.string().min(1),
  sourceSessionId: z.string().min(1),
  sourceTraceId: z.string().min(1).optional(),
});

export type MemoryItem = z.infer<typeof memoryItemSchema>;

export const distillDraftItemSchema = z.object({
  kind: memoryKindSchema,
  when: z.string(),
  do: z.string(),
  outcome: z.string(),
  confidence: z.number(),
});

export const distillModelOutputSchema = z.object({
  items: z.array(distillDraftItemSchema),
});

export type DistillDraftItem = z.infer<typeof distillDraftItemSchema>;

export type DistillLastStatus =
  | "idle"
  | "running"
  | "ok"
  | "error"
  | "skipped";

export type DistillStatusView = {
  enabled: boolean;
  lastAt?: string;
  lastRunId?: string;
  lastStatus: DistillLastStatus;
  lastMessage?: string;
  lastWritten?: number;
};
