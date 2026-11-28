import { describe, expect, it } from 'vitest';
import { Secrets } from '../src/store/store.js';

describe('Secrets', () => {
  const secrets = new Secrets('test secret');

  it('reads back what it encrypted, and nothing under another key', () => {
    const stored = secrets.encrypt('api-key-value');
    expect(stored).not.toContain('api-key-value');
    expect(secrets.decrypt(stored)).toBe('api-key-value');
    expect(new Secrets('other secret').decrypt(stored)).toBe('');
  });

  it('refuses shortened or changed authentication tags', () => {
    const [version, iv, tag, data] = secrets.encrypt('api-key-value').split(':');
    const short = Buffer.from(tag, 'base64').subarray(0, 4).toString('base64');
    expect(secrets.decrypt([version, iv, short, data].join(':'))).toBe('');
    const changed = Buffer.from(tag, 'base64');
    changed[0] ^= 1;
    expect(secrets.decrypt([version, iv, changed.toString('base64'), data].join(':'))).toBe('');
  });
});
