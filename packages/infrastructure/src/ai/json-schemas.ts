export const MEMORY_ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "classification", "summary", "entities", "goals", "nextActions", "needsUserReview"],
  properties: {
    schemaVersion: { type: "string", const: "memory-analysis.v1" },
    classification: {
      type: "object",
      additionalProperties: false,
      required: ["inputType", "confidence", "evidence"],
      properties: {
        inputType: { type: "string", enum: ["diary", "thought", "person", "reading", "goal", "other"] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        evidence: { type: "string", minLength: 1, maxLength: 500 }
      }
    },
    summary: {
      type: "object",
      additionalProperties: false,
      required: ["text", "confidence", "evidence"],
      properties: {
        text: { type: "string", minLength: 1, maxLength: 500 },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        evidence: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 1, maxLength: 500 } }
      }
    },
    entities: {
      type: "object",
      additionalProperties: false,
      required: ["items"],
      properties: {
        items: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["type", "name", "confidence", "evidence"],
            properties: {
              type: { type: "string", enum: ["person", "book", "place", "topic", "organization"] },
              name: { type: "string", minLength: 1, maxLength: 120 },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              evidence: { type: "string", minLength: 1, maxLength: 500 }
            }
          }
        }
      }
    },
    goals: {
      type: "object",
      additionalProperties: false,
      required: ["items"],
      properties: {
        items: {
          type: "array",
          maxItems: 10,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "confidence", "evidence"],
            properties: {
              title: { type: "string", minLength: 1, maxLength: 240 },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              evidence: { type: "string", minLength: 1, maxLength: 500 }
            }
          }
        }
      }
    },
    nextActions: {
      type: "object",
      additionalProperties: false,
      required: ["items"],
      properties: {
        items: {
          type: "array",
          maxItems: 10,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "dueHint", "confidence", "evidence"],
            properties: {
              title: { type: "string", minLength: 1, maxLength: 240 },
              dueHint: { type: ["string", "null"], maxLength: 120 },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              evidence: { type: "string", minLength: 1, maxLength: 500 }
            }
          }
        }
      }
    },
    needsUserReview: { type: "boolean" }
  }
} as const;

export const INSIGHT_REPLY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "text", "grounding", "citations", "nextAction"],
  properties: {
    schemaVersion: { type: "string", const: "insight-reply.v1" },
    text: { type: "string", minLength: 1, maxLength: 1200 },
    grounding: { type: "string", enum: ["grounded", "no_relevant_memory"] },
    citations: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["memoryId", "entryId", "evidenceQuote"],
        properties: {
          memoryId: { type: "string", format: "uuid" },
          entryId: { type: "string", format: "uuid" },
          evidenceQuote: { type: "string", minLength: 1, maxLength: 500 }
        }
      }
    },
    nextAction: {
      type: "object",
      additionalProperties: false,
      required: ["title"],
      properties: { title: { type: "string", minLength: 1, maxLength: 240 } }
    }
  }
} as const;
