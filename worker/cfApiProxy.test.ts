/**
 * Private proxy deliberately has NO Cloudflare account-management relay.
 * Authentication, path filtering, and method forwarding of the old relay
 * are not features we should preserve: any caller-supplied admin token must
 * stay out of the proxy and never be transmitted to Cloudflare.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-expect-error standalone worker is intentionally maintained in JS
import worker from './index.js';

const TOKEN = 'Bearer cf-token-must-not-leak';
const request = (path: string, method: string = 'POST', extra: Record<string,string> = {}, body?: string) => {
  const url = 'https://proxy.test/cf-api?path=' + encodeURIComponent(path);
  return new Request(url, {
    method,
    headers: { Authorization: TOKEN, 'X-CF-Method': 'PUT', ...extra },
    ...(body === undefined ? {} : { body }),
  });
};
const call = (req: Request) => worker.fetch(req, {}, { waitUntil: () => {} });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('private proxy: privileged /cf-api relay stays removed', () => {
  it.each([
    ['/accounts?per_page=50', 'GET'],
    ['/accounts/abc/workers/scripts/sullyos-amsg', 'PUT'],
    ['/zones/abc/dns_records', 'POST'],
    ['/accounts/../zones/abc', 'GET'],
    ['/accounts/../../https://evil.example/steal', 'GET'],
    ['accounts', 'GET'],
    ['/accounts', 'TRACE'],
    ['/accounts', 'DELETE'],
  ])('never relays path %s or X-CF-Method %s', async (path, cfMethod) => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const result = await call(request(path, 'POST', { 'X-CF-Method': cfMethod }));
    expect(result.status).toBe(405);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('has no public probe advertising the removed privileged relay', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const result = await call(new Request('https://proxy.test/cf-api', { method: 'GET' }));
    expect(result.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('does not forward multipart Worker-script uploads or their tokens', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const result = await call(request('/accounts/abc/workers/scripts/amsg', 'POST', {
      'Content-Type': 'multipart/form-data; boundary=----SullyBoundary',
    }, 'old-deploy-payload'));
    expect(result.status).toBe(405);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('never logs the Cloudflare admin token or the query string', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await call(request('/accounts?secret_query=sentinel'));
    const lines = spy.mock.calls.flat().join('\n');
    expect(lines).not.toContain(TOKEN);
    expect(lines).not.toContain('cf-token-must-not-leak');
    expect(lines).not.toContain('secret_query');
    expect(upstream).not.toHaveBeenCalled();
  });
});
