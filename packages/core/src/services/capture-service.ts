import {
  CaptureCommandV1Schema,
  type CaptureCommandV1,
  type CaptureReceiptV1,
  type DomainEventV1,
} from "@paopao/contracts";
import type { CaptureService, CaptureUnitOfWork } from "../ports/capture.js";
import type { Clock, DomainEventPublisher } from "../ports/runtime.js";

export class InvalidCaptureCommandError extends Error {
  readonly code = "VALIDATION_FAILED";

  constructor() {
    super("Capture command validation failed");
  }
}

export function createCaptureService(dependencies: {
  unitOfWork: CaptureUnitOfWork;
  events: DomainEventPublisher;
  clock: Clock;
}): CaptureService {
  return {
    async capture(input: CaptureCommandV1): Promise<CaptureReceiptV1> {
      const parsed = CaptureCommandV1Schema.safeParse(input);
      if (!parsed.success) throw new InvalidCaptureCommandError();
      if (parsed.data.source === "desktop" && parsed.data.sourceKey !== `desktop:${parsed.data.requestId}`) throw new InvalidCaptureCommandError();
      if (parsed.data.source === "feishu" && parsed.data.sourceKey !== parsed.data.externalRef?.messageKey) throw new InvalidCaptureCommandError();

      const result = dependencies.unitOfWork.capture(parsed.data);
      if (result.created) {
        const event: DomainEventV1 = {
          version: 1,
          type: "entry:stored",
          entryId: result.receipt.entryId,
          status: "stored",
          occurredAt: dependencies.clock.now(),
        };
        try {
          await dependencies.events.publish(event);
        } catch {
          // The committed SQLite receipt remains authoritative; events only prompt readers to refresh.
        }
      }
      return result.receipt;
    },
  };
}
