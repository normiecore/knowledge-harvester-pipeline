import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketManager } from '../../src/api/ws.js';

function mockWebSocket(readyState = 1) {
  return {
    readyState,
    send: vi.fn(),
    on: vi.fn(),
    ping: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
    removeAllListeners: vi.fn(),
  } as any;
}

describe('WebSocketManager', () => {
  let manager: WebSocketManager;

  beforeEach(() => {
    manager = new WebSocketManager();
  });

  afterEach(() => {
    manager.close();
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

  it('removes pong listener on disconnect', () => {
    const ws = mockWebSocket();
    manager.addConnection('user-1', ws);
    manager.removeConnection('user-1', ws);

    expect(ws.removeAllListeners).toHaveBeenCalledWith('pong');
    expect(manager.getConnectionCount('user-1')).toBe(0);
  });

  it('removeConnection is safe for unknown userId', () => {
    const ws = mockWebSocket();
    // Should not throw
    manager.removeConnection('no-such-user', ws);
  });

  it('removeConnection is safe for unknown ws within a known user', () => {
    const ws1 = mockWebSocket();
    const ws2 = mockWebSocket();
    manager.addConnection('user-1', ws1);

    // ws2 was never added -- should not throw
    manager.removeConnection('user-1', ws2);
    expect(manager.getConnectionCount('user-1')).toBe(1);
  });

  it('close() terminates all connections and clears state', () => {
    const ws1 = mockWebSocket();
    const ws2 = mockWebSocket();
    manager.addConnection('user-1', ws1);
    manager.addConnection('user-2', ws2);

    manager.close();

    expect(ws1.close).toHaveBeenCalledWith(1001, 'Server shutting down');
    expect(ws2.close).toHaveBeenCalledWith(1001, 'Server shutting down');
    expect(manager.getConnectionCount('user-1')).toBe(0);
    expect(manager.getConnectionCount('user-2')).toBe(0);
  });

  it('evicts oldest connection when per-user limit is reached', () => {
    const sockets = Array.from({ length: 6 }, () => mockWebSocket());
    for (const ws of sockets) {
      manager.addConnection('user-1', ws);
    }

    // The first socket should have been evicted
    expect(sockets[0].close).toHaveBeenCalledWith(4002, 'Connection limit exceeded');
    expect(manager.getConnectionCount('user-1')).toBe(5);
  });
});
