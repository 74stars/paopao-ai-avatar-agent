import { z } from "zod";

export const WindowMoveRequestV1Schema = z.object({
  version: z.literal(1),
  deltaX: z.number().int().min(-200).max(200),
  deltaY: z.number().int().min(-200).max(200)
}).strict();

export type WindowMoveRequestV1 = z.infer<typeof WindowMoveRequestV1Schema>;
