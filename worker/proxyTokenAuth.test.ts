import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error private Worker entry remains standalone JavaScript
import worker from './index.js';

const SECRET = 'proxy-fixture-token-only-never-use-in-production-0123456789';
const ORIGIN = 'https://private.pages.dev';
const env = { PROXY_ALLOWED_ORIGINS: ORIGIN, PROXY_SERVER_TOKEN: SECRET };
const call = (path: string, headers: Record<string, string> = {}, config: Record<string, string> = env, method = 'GET') =>
  worker.fetch(new Request('https://proxy.example.invalid' + path, {
    method,
    headers: { 'X-Brave-API-Key': 'brave-fixture', ...headers },
  }), config, { waitUntil() {} });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('private main proxy bearer gate (Origin is not authentication)', () => {
  it('fails closed if the server Secret is absent or not configured as high entropy', async () => {
    expect((await call('/search?q=cat', {}, { PROXY_ALLOWED_ORIGINS: ORIGIN })).status).toBe(503);
    expect((await call('/search?q=cat', {}, { PROXY_ALLOWED_ORIGINS: ORIGIN, PROXY_SERVER_TOKEN: 'short' })).status).toBe(503);
  });

  it('denies missing, forged-Origin, no-Origin and wrong-token business calls before an upstream fetch', async () => {
    const outgoing = vi.fn();
    vi.stubGlobal('fetch', outgoing);
    expect((await call('/search?q=cat', { Origin: ORIGIN })).status).toBe(401);
    expect((await call('/search?q=cat', { Origin: ORIGIN, 'X-Proxy-Token': 'wrong' })).status).toBe(401);
    expect((await call('/search?q=cat', { Origin: 'https://forged.example.com' })).status).toBe(403);
    expect((await call('/search?q=cat')).status).toBe(401);
    expect(outgoing).not.toHaveBeenCalled();
  });

  it('accepts exactly the right bearer and never forwards it to Brave', async () => {
    const outgoing = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ web: { results: [] } }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', outgoing);
    const res = await call('/search?q=cat', { Origin: ORIGIN, 'X-Proxy-Token': SECRET });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(outgoing).toHaveBeenCalledTimes(1);
    const forwarded = outgoing.mock.calls[0][1]?.headers as Record<string, string> | undefined;
    expect(JSON.stringify(forwarded)).not.toContain(SECRET);
    expect(JSON.stringify(forwarded)).not.toContain('X-Proxy-Token');
  });

  it('a correct bearer never overrides the exact browser Origin allowlist', async () => {
    const res = await call('/search?q=cat', { Origin: 'https://stranger.pages.dev', 'X-Proxy-Token': SECRET });
    expect(res.status).toBe(403);
    expect(res.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });

  it('leaves CORS preflight and the non-sensitive GET health probe available', async () => {
    const preflight = await worker.fetch(new Request('https://proxy.example.invalid/search', {
      method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Headers': 'X-Proxy-Token' },
    }), env);
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('X-Proxy-Token');
    const health = await call('/api/health', { Origin: ORIGIN }, { PROXY_ALLOWED_ORIGINS: ORIGIN });
    expect(health.status).toBe(200);
  });

  it('converts authenticated upstream redirects to non-redirects, preventing XHR bearer forwarding', async () => {
    const outgoing = vi.fn(async () => new Response(null, {
      status: 302, headers: { Location: 'https://untrusted.example/steal' },
    }));
    vi.stubGlobal('fetch', outgoing);
    const res = await call('/github?url=' + encodeURIComponent('https://api.github.com/repos/a/b'), {
      Origin: ORIGIN, 'X-Proxy-Token': SECRET, Authorization: 'Bearer github-only-test',
    }, env, 'POST');
    expect(res.status).toBe(502);
    expect(res.headers.has('Location')).toBe(false);
    expect(outgoing).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(outgoing.mock.calls[0])).not.toContain(SECRET);
  });
});
