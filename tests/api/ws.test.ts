import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebSocketManager } from '../../src/api/ws.js';

function mockWebSocket(readyState = 1) {
  return {
    readyState,
    send: vi.fn(),
  } as any;
}

describe('WebSocketManager', () => {
  let manager: WebSocketManager;

  beforeEach(() => {
    manager = new WebSocketManager();
  });

  it('registers and counts connections', () => {
    const ws1 = mockWebSocket();
    const ws2 = mockWebSocket();

    manager.addConnection('user-1', ws1);
    manager.addConnection('user-1', ws2);

    expect(manager.getConnectionCount('user-1')).toBe(2);
    expect(manager.getConnectionCount('user-2')).toBe(0);
  });

  it('removes connections', () => {
    const ws = mockWebSocket();
    manager.addConnection('user-1', ws);
    expect(manager.getConnectionCount('user-1')).toBe(1);

    manager.removeConnection('user-1', ws);
    expect(manager.getConnectionCount('user-1')).toBe(0);
  });

  it('sends notifications to all open connections', () => {
    const ws1 = mockWebSocket();
    const ws2 = mockWebSocket();

    manager.addConnection('user-1', ws1);
    manager.addConnection('user-1', ws2);

    manager.notify('user-1', { type: 'new_engram', id: 'eng-1' });

    expect(ws1.send).toHaveBeenCalledWith(JSON.stringify({ type: 'new_engram', id: 'eng-1' }));
    expect(ws2.send).toHaveBeenCalledWith(JSON.stringify({ type: 'new_engram', id: 'eng-1' }));
  });

  it('skips disconnected sockets (readyState !== 1)', () => {
    const openWs = mockWebSocket(1);
    const closedWs = mockWebSocket(3);

    manager.addConnection('user-1', openWs);
    manager.addConnection('user-1', closedWs);

    manager.notify('user-1', { type: 'test' });

    expect(openWs.send).toHaveBeenCalledTimes(1);
    expect(closedWs.send).not.toHaveBeenCalled();
  });

  it('does nothing when notifying a user with no connections', () => {
    // Should not throw
    manager.notify('nonexistent', { type: 'test' });
  });
});
