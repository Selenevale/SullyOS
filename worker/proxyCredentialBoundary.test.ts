import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error standalone Worker entry is JS, not a typed module
import proxyWorker from './index.js';

const proxy = proxyWorker as {
  fetch: (request: Request, env: Record<string, string>) => Promise<Response>;
};

const makeRequest = (path: string, init: RequestInit = {}) => new Request(
  'https://proxy.example.invalid' + path,
  {
    ...init,
    headers: { Origin: 'https://private.pages.dev', 'X-Proxy-Token': 'proxy-fixture-token-only-never-use-in-production-0123456789', ...init.headers },
  },
);
const env = { PROXY_ALLOWED_ORIGINS: 'https://private.pages.dev', PROXY_SERVER_TOKEN: 'proxy-fixture-token-only-never-use-in-production-0123456789' };

afterEach(() => vi.unstubAllGlobals());

describe('private proxy credential handling', () => {
  it('does not silently give other callers a Worker-level XHS account cookie', async () => {
    const outbound = vi.fn();
    vi.stubGlobal('fetch', outbound);
    const res = await proxy.fetch(makeRequest('/api/search', {
      method: 'POST',
      headers: { Origin: 'https://private.pages.dev', 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: 'test' }),
    }), { ...env, XHS_COOKIE: 'a1=private-owner-cookie' });
    expect(res.status).toBe(401);
    expect(outbound).not.toHaveBeenCalled();
  });

  it('keeps the normal XHS health check available without a login cookie', async () => {
    const res = await proxy.fetch(makeRequest('/api/health'), env);
    expect(res.status).toBe(200);
  });

  it('disables sensitive XHS diagnostics by default, even if a caller provides cookies', async () => {
    const outbound = vi.fn();
    vi.stubGlobal('fetch', outbound);
    for (const path of ['/xhs/debug', '/xhs/upload-test']) {
      const res = await proxy.fetch(makeRequest(path, {
        headers: { Origin: 'https://private.pages.dev', 'X-Xhs-Cookie': 'a1=test' },
      }), env);
      expect(res.status).toBe(404);
    }
    expect(outbound).not.toHaveBeenCalled();
  });

  it('does not follow GitHub API redirects with the caller token', async () => {
    const outbound = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, {
      status: 302,
      headers: { Location: 'https://downloads.example.com/token-capture' },
    }));
    vi.stubGlobal('fetch', outbound);
    const res = await proxy.fetch(makeRequest('/github?url=' + encodeURIComponent('https://api.github.com/repos/owner/repo'), {
      method: 'POST',
      headers: {
        Origin: 'https://private.pages.dev',
        Authorization: 'Bearer a-private-github-token',
      },
    }), env);
    expect(res.status).toBe(502);
    expect(res.headers.has('Location')).toBe(false);
    expect(outbound).toHaveBeenCalledTimes(1);
    expect(outbound.mock.calls[0][1]).toMatchObject({
      redirect: 'manual',
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer a-private-github-token' }),
    });
  });

  it('rejects credentials embedded in a GitHub target URL', async () => {
    const outbound = vi.fn();
    vi.stubGlobal('fetch', outbound);
    const res = await proxy.fetch(makeRequest('/github?url=' + encodeURIComponent(
      'https://user:password@api.github.com/repos/owner/repo',
    ), { method: 'POST' }), env);
    expect(res.status).toBe(400);
    expect(outbound).not.toHaveBeenCalled();
  });
});
