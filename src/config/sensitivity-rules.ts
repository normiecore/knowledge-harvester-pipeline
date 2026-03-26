/**
 * Sensitivity rules for blocking or flagging content that should not be
 * harvested into the knowledge base. These cover HR, finance, medical,
 * and other personal-data sources.
 */

export const EXCLUDED_SOURCES: readonly string[] = [
  'hr.company.com',
  'banking',
  'payroll',
  'myhr',
  'workday.com',
  'adp.com',
  'healthportal',
  'medical',
  'benefits.company.com',
];

export const TITLE_BLOCK_PATTERNS: readonly RegExp[] = [
  /salary/i,
  /performance\s+review/i,
  /disciplinary/i,
  /termination/i,
  /grievance/i,
  /compensation\s+adjustment/i,
  /bonus\s+allocation/i,
  /severance/i,
  /redundancy/i,
];

export const CONTENT_BLOCK_PATTERNS: readonly RegExp[] = [
  /\bdivorce\b/i,
  /\bmedical\s+results?\b/i,
  /\bpregnancy\s+test\b/i,
  /\bmental\s+health\s+diagnosis\b/i,
  /\brehabilitation\b/i,
  /\bsubstance\s+abuse\b/i,
  /\bdomestic\s+violence\b/i,
  /\bsexual\s+harassment\b/i,
  /\bcredit\s+score\b/i,
  /\bsocial\s+security\s+number\b/i,
  /\bnational\s+insurance\s+number\b/i,
];

/**
 * Check whether a source URL or identifier should be excluded entirely.
 */
export function isSourceExcluded(source: string): boolean {
  const lower = source.toLowerCase();
  return EXCLUDED_SOURCES.some((excluded) => lower.includes(excluded));
}

/**
 * Check whether a document/email title matches any blocked pattern.
 */
export function matchesTitlePattern(title: string): boolean {
  return TITLE_BLOCK_PATTERNS.some((pattern) => pattern.test(title));
}

/**
 * Check whether content body matches any blocked pattern.
 */
export function matchesContentPattern(content: string): boolean {
  return CONTENT_BLOCK_PATTERNS.some((pattern) => pattern.test(content));
}
