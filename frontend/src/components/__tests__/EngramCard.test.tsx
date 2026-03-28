import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import EngramCard from '../EngramCard';

// Mock the api module
vi.mock('../../api', () => ({
  patchEngram: vi.fn().mockResolvedValue({}),
}));

import { patchEngram } from '../../api';

const baseEngram = {
  id: 'eng-1',
  concept: 'Docker networking basics',
  content: 'Containers communicate via bridge networks by default.',
  confidence: 0.85,
  capturedAt: new Date().toISOString(),
  sourceType: 'graph_email',
  tags: ['docker', 'networking'],
};

function renderCard(props: Partial<Parameters<typeof EngramCard>[0]> = {}) {
  return render(
    <MemoryRouter>
      <EngramCard engram={baseEngram} {...props} />
    </MemoryRouter>,
  );
}

describe('EngramCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the engram concept as a link', () => {
    renderCard();
    const link = screen.getByRole('link', { name: 'Docker networking basics' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/engram/eng-1');
  });

  it('shows "Untitled" when concept is missing', () => {
    renderCard({ engram: { ...baseEngram, concept: '' } });
    expect(screen.getByText('Untitled')).toBeInTheDocument();
  });

  it('displays the source label from SOURCE_LABELS map', () => {
    renderCard();
    expect(screen.getByText('Email')).toBeInTheDocument();
  });

  it('falls back to source_app when sourceType is unknown', () => {
    renderCard({ engram: { ...baseEngram, sourceType: undefined, source_app: 'Slack' } });
    expect(screen.getByText('Slack')).toBeInTheDocument();
  });

  it('shows confidence badge with correct class - high', () => {
    renderCard();
    const badge = screen.getByText('85%');
    expect(badge).toHaveClass('confidence-badge', 'high');
  });

  it('shows confidence badge with correct class - medium', () => {
    renderCard({ engram: { ...baseEngram, confidence: 0.5 } });
    expect(screen.getByText('50%')).toHaveClass('medium');
  });

  it('shows confidence badge with correct class - low', () => {
    renderCard({ engram: { ...baseEngram, confidence: 0.2 } });
    expect(screen.getByText('20%')).toHaveClass('low');
  });

  it('treats missing confidence as 0', () => {
    renderCard({ engram: { ...baseEngram, confidence: undefined } });
    expect(screen.getByText('0%')).toHaveClass('low');
  });

  it('renders tag previews (max 4)', () => {
    const tags = ['a', 'b', 'c', 'd', 'e'];
    renderCard({ engram: { ...baseEngram, tags } });
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('d')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.queryByText('e')).not.toBeInTheDocument();
  });

  it('shows Approve and Dismiss buttons when showActions is true', () => {
    renderCard();
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });

  it('hides action buttons when showActions is false', () => {
    renderCard({ showActions: false });
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
  });

  it('calls patchEngram with "approved" when Approve is clicked', async () => {
    const onAction = vi.fn();
    renderCard({ onAction });

    fireEvent.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => {
      expect(patchEngram).toHaveBeenCalledWith('eng-1', 'approved');
    });
    await waitFor(() => {
      expect(onAction).toHaveBeenCalled();
    });
  });

  it('calls patchEngram with "dismissed" when Dismiss is clicked', async () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    await waitFor(() => {
      expect(patchEngram).toHaveBeenCalledWith('eng-1', 'dismissed');
    });
  });

  it('expands to show details when clicked', () => {
    renderCard();
    const card = screen.getByRole('article');
    fireEvent.click(card);
    expect(card).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Summary')).toBeInTheDocument();
  });

  it('collapses when clicked again', () => {
    renderCard();
    const card = screen.getByRole('article');
    fireEvent.click(card);
    fireEvent.click(card);
    expect(card).toHaveAttribute('aria-expanded', 'false');
  });

  it('applies focused class when focused prop is true', () => {
    renderCard({ focused: true });
    expect(screen.getByRole('article')).toHaveClass('focused');
  });

  it('parses JSON content and shows tags from parsed data', () => {
    const jsonContent = JSON.stringify({
      content: 'Parsed summary',
      tags: ['parsed-tag'],
      sensitivity_classification: 'internal',
      sensitivity_reasoning: 'Contains org data',
    });
    renderCard({ engram: { ...baseEngram, content: jsonContent, tags: [] } });
    const card = screen.getByRole('article');
    fireEvent.click(card);

    expect(screen.getByText('Parsed summary')).toBeInTheDocument();
    expect(screen.getByText('parsed-tag')).toBeInTheDocument();
    expect(screen.getByText('internal')).toBeInTheDocument();
    expect(screen.getByText('Contains org data')).toBeInTheDocument();
  });

  it('handles patchEngram failure gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(patchEngram).mockRejectedValueOnce(new Error('Network error'));

    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Action failed:', expect.any(Error));
    });
  });
});
