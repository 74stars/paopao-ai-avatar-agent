import type { CaptureCommandV1, CaptureReceiptV1 } from "@paopao/contracts";

export interface CaptureTransactionResult {
  receipt: CaptureReceiptV1;
  created: boolean;
}

export interface CaptureUnitOfWork {
  capture(command: CaptureCommandV1): CaptureTransactionResult;
}

export interface CaptureService {
  capture(command: CaptureCommandV1): Promise<CaptureReceiptV1>;
}
