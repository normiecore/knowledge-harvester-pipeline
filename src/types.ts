import { z } from 'zod';

export const SOURCE_TYPES = [
  'graph_email',
  'graph_teams',
  'graph_calendar',
  'graph_document',
  'graph_task',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const APPROVAL_STATUSES = ['pending', 'approved', 'dismissed'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const SENSITIVITY_CLASSIFICATIONS = ['safe', 'review', 'block'] as const;
export type SensitivityClassification = (typeof SENSITIVITY_CLASSIFICATIONS)[number];

export const RawCaptureSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userEmail: z.string(),
  sourceType: z.enum(SOURCE_TYPES),
  sourceApp: z.string(),
  capturedAt: z.string(),
  rawContent: z.string(),
  metadata: z.record(z.string(), z.unknown()),
});
export type RawCapture = z.infer<typeof RawCaptureSchema>;

export const ExtractionResultSchema = z.object({
  summary: z.string(),
  tags: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  sensitivity: z.object({
    classification: z.enum(SENSITIVITY_CLASSIFICATIONS),
    reasoning: z.string(),
  }),
});
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

export interface HarvesterEngram {
  concept: string;
  content: string;
  source_type: SourceType;
  source_app: string;
  user_id: string;
  user_email: string;
  captured_at: string;
  approved_at: string | null;
  approved_by: string | null;
  approval_status: ApprovalStatus;
  confidence: number;
  sensitivity_classification: SensitivityClassification;
  tags: string[];
  raw_text: string;
}

export interface DepartmentEngram {
  concept: string;
  content: string;
  source_app: string;
  user_id: string;
  user_email: string;
  tags: string[];
}

export interface OrgEngram {
  concept: string;
  tags: string[];
  department: string;
}

/**
 * Thrown when LLM extraction fails after all retries are exhausted.
 * Carries the original capture so the processor can publish it to the dead-letter topic.
 */
export class ExtractionError extends Error {
  public readonly capture: RawCapture;
  public readonly attempts: number;

  constructor(message: string, capture: RawCapture, attempts: number, cause?: Error) {
    super(message);
    this.name = 'ExtractionError';
    this.capture = capture;
    this.attempts = attempts;
    if (cause) this.cause = cause;
  }
}
