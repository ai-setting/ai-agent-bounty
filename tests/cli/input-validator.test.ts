import { describe, test, expect } from 'bun:test';

describe('publish input validator', () => {
  test('accepts only required fields and leaves optional fields undefined', async () => {
    const { validatePublishInput } = await import('../../src/cli/lib/input-validator.js');

    const result = validatePublishInput({ title: ' v0.7 test ', type: ' writing ', reward: 5 });

    expect(result.ok).toBe(true);
    expect(result.value.title).toBe('v0.7 test');
    expect(result.value.type).toBe('writing');
    expect(result.value.reward).toBe(5);
    expect(result.value.description).toBeUndefined();
    expect(result.value.tags).toBeUndefined();
    expect(result.value.deadline).toBeUndefined();
  });

  test('parses comma-separated tags and filters blanks', async () => {
    const { validatePublishInput } = await import('../../src/cli/lib/input-validator.js');

    const result = validatePublishInput({ title: 't', type: 'coding', reward: 10, tags: ' cli, v0.7, , address ' });

    expect(result.ok).toBe(true);
    expect(result.value.tags).toEqual(['cli', 'v0.7', 'address']);
  });

  test('rejects non-numeric reward with friendly message', async () => {
    const { validatePublishInput } = await import('../../src/cli/lib/input-validator.js');

    const result = validatePublishInput({ title: 't', type: 'coding', reward: 'abc' });

    expect(result.ok).toBe(false);
    expect(result.field).toBe('reward');
    expect(result.error).toBe('✗ --reward must be a number (got "abc")');
  });

  test('rejects non-positive reward with friendly message', async () => {
    const { validatePublishInput } = await import('../../src/cli/lib/input-validator.js');

    const result = validatePublishInput({ title: 't', type: 'coding', reward: 0 });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('--reward must be a positive number');
  });

  test('rejects --tags with no value while allowing tags to be omitted', async () => {
    const { validatePublishInput } = await import('../../src/cli/lib/input-validator.js');

    expect(validatePublishInput({ title: 't', type: 'coding', reward: 1 }).ok).toBe(true);
    const result = validatePublishInput({ title: 't', type: 'coding', reward: 1, tags: '' });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('✗ --tags requires a value (got nothing)');
  });

  test('rejects non-numeric deadline with friendly message', async () => {
    const { validatePublishInput } = await import('../../src/cli/lib/input-validator.js');

    const result = validatePublishInput({ title: 't', type: 'coding', reward: 1, deadline: 'tomorrow' });

    expect(result.ok).toBe(false);
    expect(result.field).toBe('deadline');
    expect(result.error).toBe('✗ --deadline must be a numeric timestamp (got "tomorrow")');
  });

  test('rejects blank title and blank type', async () => {
    const { validatePublishInput } = await import('../../src/cli/lib/input-validator.js');

    const noTitle = validatePublishInput({ title: ' ', type: 'coding', reward: 1 });
    const noType = validatePublishInput({ title: 't', type: '', reward: 1 });

    expect(noTitle.ok).toBe(false);
    expect(noTitle.field).toBe('title');
    expect(noType.ok).toBe(false);
    expect(noType.field).toBe('type');
  });
});
