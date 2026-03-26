import { describe, it, expect } from 'vitest';
import {
  EXCLUDED_SOURCES,
  TITLE_BLOCK_PATTERNS,
  CONTENT_BLOCK_PATTERNS,
  isSourceExcluded,
  matchesTitlePattern,
  matchesContentPattern,
} from '../../src/config/sensitivity-rules.js';

describe('sensitivity rules', () => {
  describe('EXCLUDED_SOURCES', () => {
    it('contains known HR/finance sources', () => {
      expect(EXCLUDED_SOURCES).toContain('hr.company.com');
      expect(EXCLUDED_SOURCES).toContain('payroll');
      expect(EXCLUDED_SOURCES).toContain('workday.com');
      expect(EXCLUDED_SOURCES).toContain('adp.com');
    });
  });

  describe('isSourceExcluded', () => {
    it('returns true for excluded sources (case-insensitive)', () => {
      expect(isSourceExcluded('hr.company.com')).toBe(true);
      expect(isSourceExcluded('HR.COMPANY.COM')).toBe(true);
      expect(isSourceExcluded('https://payroll.internal/report')).toBe(true);
    });

    it('returns false for non-excluded sources', () => {
      expect(isSourceExcluded('sharepoint.company.com')).toBe(false);
      expect(isSourceExcluded('teams-channel-engineering')).toBe(false);
    });
  });

  describe('matchesTitlePattern', () => {
    it('matches salary-related titles', () => {
      expect(matchesTitlePattern('Q1 Salary Review')).toBe(true);
      expect(matchesTitlePattern('salary adjustment 2026')).toBe(true);
    });

    it('matches performance review titles', () => {
      expect(matchesTitlePattern('Annual Performance Review - James')).toBe(true);
    });

    it('matches disciplinary titles', () => {
      expect(matchesTitlePattern('Disciplinary Action Report')).toBe(true);
    });

    it('matches termination titles', () => {
      expect(matchesTitlePattern('Termination Notice - Employee')).toBe(true);
    });

    it('does not match normal work titles', () => {
      expect(matchesTitlePattern('Pipe Stress Analysis Meeting')).toBe(false);
      expect(matchesTitlePattern('Sprint Review Notes')).toBe(false);
    });
  });

  describe('matchesContentPattern', () => {
    it('matches personal medical content', () => {
      expect(matchesContentPattern('The medical results came back positive')).toBe(true);
      expect(matchesContentPattern('pregnancy test scheduled for next week')).toBe(true);
    });

    it('matches divorce-related content', () => {
      expect(matchesContentPattern('Going through a divorce right now')).toBe(true);
    });

    it('does not match normal engineering content', () => {
      expect(matchesContentPattern('The pipe stress test results are within tolerance')).toBe(false);
      expect(matchesContentPattern('Review the weld inspection report')).toBe(false);
    });
  });
});
