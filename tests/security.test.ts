import { describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY, PERMISSIONS_POLICY } from '../src/app.js';
import { setup } from './helpers.js';

describe('security headers and cookies', () => {
  it('sends a strict Content-Security-Policy and Permissions-Policy on every page', async () => {
    const env = setup();
    const response = await env.request('/');
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toBe(CONTENT_SECURITY_POLICY);
    for (const part of ["default-src 'self'", "script-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"]) {
      expect(csp).toContain(part);
    }
    expect(csp).not.toContain('unsafe-inline');
    expect(response.headers.get('permissions-policy')).toBe(PERMISSIONS_POLICY);
    expect(response.headers.get('cache-control')).toBe('no-cache, private');
  });

  it('sets the interface language cookie HttpOnly and SameSite', async () => {
    const env = setup();
    const cookie = (await env.request('/?lang=de')).headers.get('set-cookie') ?? '';
    expect(cookie).toContain('st_locale=de');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });
});
