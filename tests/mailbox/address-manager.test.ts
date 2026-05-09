import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from '../../src/lib/storage/database';
import { AddressManager } from '../../src/lib/mailbox/address-manager';

describe('AddressManager', () => {
  let db: Database;
  let manager: AddressManager;

  beforeEach(() => {
    db = new Database({ memory: true });
    manager = new AddressManager(db);
  });

  it('should register a new address', () => {
    const addr = manager.register('agent-1', 'Alice');
    
    expect(addr).toBeDefined();
    expect(addr.agentId).toBe('agent-1');
    expect(addr.address).toBe('alice@local');
    expect(addr.type).toBe('internal');
  });

  it('should generate valid email format', () => {
    const addr = manager.register('agent-2', 'Bob The Builder');
    
    expect(addr.address).toBe('bob-the-builder@local');
  });

  it('should get address by agent ID', () => {
    const created = manager.register('agent-3', 'Charlie');
    const found = manager.getByAgentId('agent-3');
    
    expect(found?.address).toBe(created.address);
  });

  it('should get address by email', () => {
    manager.register('agent-4', 'David');
    const found = manager.getByEmail('david@local');
    
    expect(found?.agentId).toBe('agent-4');
  });

  it('should list all addresses', () => {
    manager.register('agent-5', 'Eve');
    manager.register('agent-6', 'Frank');
    
    const all = manager.list();
    expect(all.length).toBe(2);
  });

  it('should throw on duplicate agent', () => {
    manager.register('agent-7', 'Grace');
    
    expect(() => manager.register('agent-7', 'Henry')).toThrow('already has address');
  });

  it('should delete address', () => {
    manager.register('agent-8', 'Ivan');
    const deleted = manager.delete('agent-8');
    
    expect(deleted).toBe(true);
    expect(manager.getByAgentId('agent-8')).toBeNull();
  });
});
