import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { logger } from './logger.js';

/**
 * Sensitivity rules for blocking or flagging content that should not be
 * harvested into the knowledge base. These cover HR, finance, medical,
 * and other personal-data sources.
 *
 * Rules are loaded from sensitivity-rules.json if it exists, otherwise
 * hardcoded defaults are used. The JSON file allows per-deployment
 * customization without code changes.
 */

interface SensitivityRulesConfig {
  excludedSources: string[];
  titleBlockPatterns: string[];
  contentBlockPatterns: string[];
}

function loadRulesFromFile(): SensitivityRulesConfig | null {
  const filePath = resolve(process.cwd(), 'sensitivity-rules.json');
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as SensitivityRulesConfig;
    logger.info('Loaded sensitivity rules from sensitivity-rules.json');
    return parsed;
  } catch (err) {
    logger.warn({ err }, 'Failed to load sensitivity-rules.json, using defaults');
    return null;
  }
}

const customRules = loadRulesFromFile();

export const EXCLUDED_SOURCES: readonly string[] = customRules?.excludedSources ?? [
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

export const TITLE_BLOCK_PATTERNS: readonly RegExp[] = customRules
  ? customRules.titleBlockPatterns.map((p) => new RegExp(p, 'i'))
  : [
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

export const CONTENT_BLOCK_PATTERNS: readonly RegExp[] = customRules
  ? customRules.contentBlockPatterns.map((p) => new RegExp(p, 'i'))
  : [
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
