import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import StatusBadge from '../StatusBadge';

describe('StatusBadge', () => {
  it('renders the label text', () => {
    render(<StatusBadge status="connected" label="Database" />);
    expect(screen.getByText('Database')).toBeInTheDocument();
  });

  it('renders the status value', () => {
    render(<StatusBadge status="connected" label="Database" />);
    expect(screen.getByText('connected')).toBeInTheDocument();
  });

  it.each(['connected', 'healthy', 'ok'])('shows green dot and ok class for "%s" status', (status) => {
    const { container } = render(<StatusBadge status={status} label="Service" />);
    const dot = container.querySelector('.status-dot');
    expect(dot).toHaveClass('green');
    expect(screen.getByText(status)).toHaveClass('ok');
  });

  it.each(['disconnected', 'error', 'degraded', 'unknown'])('shows red dot and error class for "%s" status', (status) => {
    const { container } = render(<StatusBadge status={status} label="Service" />);
    const dot = container.querySelector('.status-dot');
    expect(dot).toHaveClass('red');
    expect(screen.getByText(status)).toHaveClass('error');
  });

  it('renders the complete badge structure', () => {
    const { container } = render(<StatusBadge status="ok" label="API" />);
    expect(container.querySelector('.status-badge')).toBeInTheDocument();
    expect(container.querySelector('.status-dot')).toBeInTheDocument();
    expect(container.querySelector('.status-label')).toBeInTheDocument();
    expect(container.querySelector('.status-value')).toBeInTheDocument();
  });
});
