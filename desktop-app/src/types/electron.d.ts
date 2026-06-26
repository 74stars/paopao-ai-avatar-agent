import type { CaptureInput, PetState } from "./domain";

declare global {
  interface Window {
    paopao?: {
      saveCapture?: (input: CaptureInput) => Promise<{ archivedTo?: string; reply?: string }>;
      toggleCapture?: () => Promise<void>;
      hideCapture?: () => Promise<void>;
      openLibrary?: () => Promise<void>;
      onPetState?: (handler: (state: PetState) => void) => void;
    };
  }
}

export {};
