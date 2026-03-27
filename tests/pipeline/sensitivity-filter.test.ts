import { describe, it, expect } from 'vitest';
import { sensitivityPreFilter } from '../../src/pipeline/sensitivity-filter.js';
import type { RawCapture } from '../../src/types.js';

function makeCapture(overrides: Partial<RawCapture> = {}): RawCapture {
  return {
    id: 'cap-1',
    userId: 'user-1',
    userEmail: 'user@co.com',
    sourceType: 'graph_email',
    sourceApp: 'outlook',
    capturedAt: '2026-03-26T10:00:00Z',
    rawContent: JSON.stringify({
      subject: 'Subsea connector specs',
      bodyPreview: 'Here are the updated connector specifications.',
    }),
    metadata: {},
    ...overrides,
  };
}

describe('sensitivityPreFilter', () => {
  it('passes safe technical content', () => {
    const result = sensitivityPreFilter(makeCapture());
    expect(result.action).toBe('pass');
  });

  it('blocks excluded source domains', () => {
    const result = sensitivityPreFilter(
      makeCapture({ sourceApp: 'workday.com' }),
    );
    expect(result.action).toBe('block');
    expect(result.layer).toBe(1);
    expect(result.reason).toContain('excluded source');
  });

  it('blocks salary-related subjects', () => {
    const result = sensitivityPreFilter(
      makeCapture({
        rawContent: JSON.stringify({
          subject: 'Salary review for Q3',
          bodyPreview: 'Please see attached.',
        }),
      }),
    );
    expect(result.action).toBe('block');
    expect(result.layer).toBe(2);
  });

  it('blocks personal content in body', () => {
    const result = sensitivityPreFilter(
      makeCapture({
        rawContent: JSON.stringify({
          subject: 'Update',
          bodyPreview: 'The divorce proceedings are scheduled for next week.',
        }),
      }),
    );
    expect(result.action).toBe('block');
    expect(result.layer).toBe(3);
  });

  it('blocks desktop window captures with sensitive titles', () => {
    const result = sensitivityPreFilter(
      makeCapture({
        sourceType: 'desktop_window',
        sourceApp: 'knowledge-harvester-desktop',
        rawContent: JSON.stringify({
          title: 'Performance Review - John Smith.docx - Word',
          owner: 'Microsoft Word',
        }),
      }),
    );
    expect(result.action).toBe('block');
    expect(result.layer).toBe(2);
  });

  it('passes desktop window captures with safe titles', () => {
    const result = sensitivityPreFilter(
      makeCapture({
        sourceType: 'desktop_window',
        sourceApp: 'knowledge-harvester-desktop',
        rawContent: JSON.stringify({
          title: 'Subsea Connector FEA Report.pdf - Adobe Acrobat',
          owner: 'Adobe Acrobat',
        }),
      }),
    );
    expect(result.action).toBe('pass');
  });

  it('blocks sensitive sourceApp names', () => {
    const result = sensitivityPreFilter(
      makeCapture({ sourceApp: 'adp.com' }),
    );
    expect(result.action).toBe('block');
    expect(result.layer).toBe(1);
  });
});
