export type PetState = "quiet" | "listening" | "remembering" | "thinking" | "insight" | "sleeping";

export interface CaptureInput {
  modality: "text" | "audio" | "link" | "image" | "file";
  content: string;
  askInsight?: boolean;
  assetPath?: string;
}

export interface BookShelfItem {
  type: string;
  title: string;
  subtitle: string;
  count: number;
  color: string;
}

export interface BookItem {
  id: string;
  type: string;
  title: string;
  body: string;
  createdAt: string;
  favorite?: boolean;
}
