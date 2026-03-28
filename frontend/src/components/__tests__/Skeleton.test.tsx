import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { SkeletonText, SkeletonCard, SkeletonTable, SkeletonMetricGrid } from '../Skeleton';

describe('SkeletonText', () => {
  it('renders one skeleton line by default', () => {
    const { container } = render(<SkeletonText />);
    const skeletons = container.querySelectorAll('.skeleton-text');
    expect(skeletons).toHaveLength(1);
  });

  it('renders the specified count of skeleton lines', () => {
    const { container } = render(<SkeletonText count={5} />);
    expect(container.querySelectorAll('.skeleton-text')).toHaveLength(5);
  });

  it('applies full width by default', () => {
    const { container } = render(<SkeletonText />);
    const el = container.querySelector('.skeleton-text') as HTMLElement;
    expect(el.style.width).toBe('100%');
  });

  it('applies short/medium/long width class instead of inline style', () => {
    const { container: c1 } = render(<SkeletonText width="short" />);
    expect(c1.querySelector('.skeleton-text')).toHaveClass('short');
    expect((c1.querySelector('.skeleton-text') as HTMLElement).style.width).toBe('');

    const { container: c2 } = render(<SkeletonText width="medium" />);
    expect(c2.querySelector('.skeleton-text')).toHaveClass('medium');

    const { container: c3 } = render(<SkeletonText width="long" />);
    expect(c3.querySelector('.skeleton-text')).toHaveClass('long');
  });
});

describe('SkeletonCard', () => {
  it('renders 3 cards by default', () => {
    const { container } = render(<SkeletonCard />);
    expect(container.querySelectorAll('.skeleton-card')).toHaveLength(3);
  });

  it('renders the specified count of cards', () => {
    const { container } = render(<SkeletonCard count={1} />);
    expect(container.querySelectorAll('.skeleton-card')).toHaveLength(1);
  });

  it('wraps cards in .engram-list', () => {
    const { container } = render(<SkeletonCard />);
    expect(container.querySelector('.engram-list')).toBeInTheDocument();
  });
});

describe('SkeletonTable', () => {
  it('renders 4 rows and 3 cols by default', () => {
    const { container } = render(<SkeletonTable />);
    expect(container.querySelectorAll('.skeleton-table-row')).toHaveLength(4);
    expect(container.querySelectorAll('.skeleton-table-cell')).toHaveLength(12);
  });

  it('renders custom rows and cols', () => {
    const { container } = render(<SkeletonTable rows={2} cols={5} />);
    expect(container.querySelectorAll('.skeleton-table-row')).toHaveLength(2);
    expect(container.querySelectorAll('.skeleton-table-cell')).toHaveLength(10);
  });
});

describe('SkeletonMetricGrid', () => {
  it('renders 4 metrics by default', () => {
    const { container } = render(<SkeletonMetricGrid />);
    expect(container.querySelectorAll('.skeleton-metric')).toHaveLength(4);
  });

  it('renders a custom count', () => {
    const { container } = render(<SkeletonMetricGrid count={2} />);
    expect(container.querySelectorAll('.skeleton-metric')).toHaveLength(2);
  });

  it('wraps metrics in .skeleton-grid', () => {
    const { container } = render(<SkeletonMetricGrid />);
    expect(container.querySelector('.skeleton-grid')).toBeInTheDocument();
  });
});
