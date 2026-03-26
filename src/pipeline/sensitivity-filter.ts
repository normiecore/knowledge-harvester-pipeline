import type { RawCapture } from '../types.js';
import {
  isSourceExcluded,
  matchesTitlePattern,
  matchesContentPattern,
} from '../config/sensitivity-rules.js';

export interface FilterResult {
  action: 'pass' | 'block';
  reason?: string;
  layer?: number;
}

export function sensitivityPreFilter(capture: RawCapture): FilterResult {
  // Layer 1: Source exclusion
  if (isSourceExcluded(capture.sourceApp)) {
    return {
      action: 'block',
      reason: `excluded source: ${capture.sourceApp}`,
      layer: 1,
    };
  }

  // Parse rawContent to extract subject/body for pattern matching
  let subject = '';
  let body = '';
  try {
    const parsed = JSON.parse(capture.rawContent);
    subject = parsed.subject ?? '';
    body = parsed.bodyPreview ?? parsed.body ?? '';
  } catch {
    // If rawContent is not JSON, treat entire thing as body
    body = capture.rawContent;
  }

  // Layer 2: Title/subject pattern matching
  if (matchesTitlePattern(subject)) {
    return {
      action: 'block',
      reason: `title pattern match`,
      layer: 2,
    };
  }

  // Layer 3: Content body pattern matching
  if (matchesContentPattern(body)) {
    return {
      action: 'block',
      reason: `content matched block pattern`,
      layer: 3,
    };
  }

  return { action: 'pass' };
}
