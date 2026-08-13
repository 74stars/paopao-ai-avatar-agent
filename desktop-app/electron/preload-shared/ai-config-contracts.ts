import { AI_MODEL_ID, AI_PROVIDER_ID } from "@paopao/contracts";
import { z } from "zod";

const strict = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();

export const AiConfigStatusRequestV1Schema = strict({ version: z.literal(1) });
export const AiConfigDeleteRequestV1Schema = strict({ version: z.literal(1) });
export const AiConfigSaveRequestV1Schema = strict({
  version: z.literal(1),
  provider: z.literal(AI_PROVIDER_ID),
  model: z.literal(AI_MODEL_ID),
  apiKey: z.string().min(1).max(512)
});
export const AiConfigStatusV1Schema = strict({
  version: z.literal(1),
  isConfigured: z.boolean(),
  provider: z.string().nullable(),
  model: z.string().nullable()
});
export const AiConfigReceiptV1Schema = AiConfigStatusV1Schema;

export type AiConfigStatusRequestV1 = z.infer<typeof AiConfigStatusRequestV1Schema>;
export type AiConfigDeleteRequestV1 = z.infer<typeof AiConfigDeleteRequestV1Schema>;
export type AiConfigSaveRequestV1 = z.infer<typeof AiConfigSaveRequestV1Schema>;
export type AiConfigStatusV1 = z.infer<typeof AiConfigStatusV1Schema>;
