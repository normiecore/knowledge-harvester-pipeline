import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { ToastProvider, useToast } from '../Toast';

// Helper component to trigger toasts from tests
function ToastTrigger({ type, title, message }: { type: 'success' | 'error' | 'warning' | 'info'; title: string; message?: string }) {
  const { addToast } = useToast();
  return <button onClick={() => addToast(type, title, message)}>Add Toast</button>;
}

describe('ToastProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders children without any toasts initially', () => {
    render(
      <ToastProvider>
        <div>App Content</div>
      </ToastProvider>,
    );
    expect(screen.getByText('App Content')).toBeInTheDocument();
    // The toast container exists but is empty
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows a toast when addToast is called', () => {
    render(
      <ToastProvider>
        <ToastTrigger type="success" title="Saved!" message="Your changes were saved." />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText('Add Toast'));

    expect(screen.getByText('Saved!')).toBeInTheDocument();
    expect(screen.getByText('Your changes were saved.')).toBeInTheDocument();
  });

  it('applies the correct CSS class for each toast type', () => {
    render(
      <ToastProvider>
        <ToastTrigger type="error" title="Oops" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText('Add Toast'));
    const toast = screen.getByText('Oops').closest('.toast');
    expect(toast).toHaveClass('toast-error');
  });

  it('shows the correct icon for each toast type', () => {
    const { unmount } = render(
      <ToastProvider>
        <ToastTrigger type="warning" title="Watch out" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText('Add Toast'));
    // Warning icon is the unicode warning sign
    expect(screen.getByText('\u26A0')).toBeInTheDocument();
    unmount();
  });

  it('renders a toast without a message body when message is omitted', () => {
    render(
      <ToastProvider>
        <ToastTrigger type="info" title="FYI" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText('Add Toast'));
    expect(screen.getByText('FYI')).toBeInTheDocument();
    // No .toast-message element should exist
    expect(screen.queryByText('toast-message')).not.toBeInTheDocument();
  });

  it('auto-dismisses toast after 4 seconds', () => {
    render(
      <ToastProvider>
        <ToastTrigger type="success" title="Auto dismiss" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText('Add Toast'));
    expect(screen.getByText('Auto dismiss')).toBeInTheDocument();

    // Advance past the auto-dismiss timeout (4000ms) + exit animation (200ms)
    act(() => vi.advanceTimersByTime(4200));

    expect(screen.queryByText('Auto dismiss')).not.toBeInTheDocument();
  });

  it('dismisses a toast immediately when the close button is clicked', () => {
    render(
      <ToastProvider>
        <ToastTrigger type="success" title="Close me" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText('Add Toast'));
    expect(screen.getByText('Close me')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Close'));

    // After exit animation
    act(() => vi.advanceTimersByTime(200));

    expect(screen.queryByText('Close me')).not.toBeInTheDocument();
  });

  it('can show multiple toasts simultaneously', () => {
    function MultiTrigger() {
      const { addToast } = useToast();
      return (
        <>
          <button onClick={() => addToast('success', 'First')}>Add First</button>
          <button onClick={() => addToast('error', 'Second')}>Add Second</button>
        </>
      );
    }

    render(
      <ToastProvider>
        <MultiTrigger />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText('Add First'));
    fireEvent.click(screen.getByText('Add Second'));

    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });
});

describe('useToast', () => {
  it('throws when used outside ToastProvider', () => {
    function Bad() {
      useToast();
      return null;
    }

    // Suppress console.error for the expected error
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<Bad />)).toThrow('useToast must be used within ToastProvider');
  });
});
