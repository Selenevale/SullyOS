import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error standalone Worker entry is JS, not a typed module
import proxyWorker from './index.js';

const proxy = proxyWorker as {
  fetch: (request: Request, env: Record<string, string>) => Promise<Response>;
};
const env = {
  PROXY_ALLOWED_ORIGINS: 'https://private.pages.dev',
  PROXY_SERVER_TOKEN: 'proxy-fixture-token-only-never-use-in-production-0123456789',
  PROXY_WEBDAV_ALLOWED_HOSTS: 'dav.example.com',
};
const browserRequest = (path: string, init: RequestInit = {}) =>
  new Request('https://proxy.example.invalid' + path, {
    ...init,
    headers: { Origin: 'https://private.pages.dev', 'X-Proxy-Token': env.PROXY_SERVER_TOKEN, ...init.headers },
  });
const webdavRequest = (url: string) => browserRequest('/webdav?url=' + encodeURIComponent(url), {
  method: 'POST',
  headers: { Origin: 'https://private.pages.dev', 'X-WebDAV-Method': 'GET' },
});
const webpageRequest = (url: string) => browserRequest('/fetch-webpage', {
  method: 'POST',
  headers: { Origin: 'https://private.pages.dev', 'Content-Type': 'application/json' },
  body: JSON.stringify({ url }),
});

afterEach(() => vi.unstubAllGlobals());

describe('private proxy external destination boundaries', () => {
  it('denies WebDAV until a hostname is explicitly allowed', async () => {
    const outbound = vi.fn();
    vi.stubGlobal('fetch', outbound);
    const response = await proxy.fetch(webdavRequest('https://dav.example.com/backup.zip'), {
      PROXY_ALLOWED_ORIGINS: env.PROXY_ALLOWED_ORIGINS,
      PROXY_SERVER_TOKEN: env.PROXY_SERVER_TOKEN,
    });
    expect(response.status).toBe(403);
    expect(outbound).not.toHaveBeenCalled();
  });

  it('rejects WebDAV loopback and credentials in target URL', async () => {
    const outbound = vi.fn();
    vi.stubGlobal('fetch', outbound);
    expect((await proxy.fetch(webdavRequest('https://127.0.0.1/private'), env)).status).toBe(400);
    expect((await proxy.fetch(webdavRequest('https://user:pass@dav.example.com/private'), env)).status).toBe(400);
    expect(outbound).not.toHaveBeenCalled();
  });

  it('forwards to an explicitly allowed WebDAV hostname without following redirects', async () => {
    const outbound = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, {
      status: 302,
      headers: { Location: 'https://other.example.com/secret' },
    }));
    vi.stubGlobal('fetch', outbound);
    await proxy.fetch(webdavRequest('https://dav.example.com/backups'), env);
    expect(outbound).toHaveBeenCalledTimes(1);
    expect(outbound.mock.calls[0][0]).toBe('https://dav.example.com/backups');
    expect(outbound.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'manual' });
  });

  it('rejects private literal URLs before fetching a shared webpage', async () => {
    const outbound = vi.fn();
    vi.stubGlobal('fetch', outbound);
    const response = await proxy.fetch(webpageRequest('http://[::ffff:127.0.0.1]/private'), env);
    expect(response.status).toBe(400);
    expect(outbound).not.toHaveBeenCalled();
  });

  it('checks the destination after a webpage redirect', async () => {
    const outbound = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, {
      status: 302,
      headers: { Location: 'http://127.0.0.1/private' },
    }));
    vi.stubGlobal('fetch', outbound);
    const response = await proxy.fetch(webpageRequest('https://news.example.com/start'), env);
    expect(response.status).toBe(400);
    expect(outbound).toHaveBeenCalledTimes(1);
    expect(outbound.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });

  it('still retrieves ordinary pages after a public redirect without sending the URL to Jina by default', async () => {
    const outbound = vi.fn(async (url: string) => url.endsWith('/start')
      ? new Response(null, { status: 302, headers: { Location: '/article' } })
      : new Response('<html><body>Hello!</body></html>', { headers: { 'Content-Type': 'text/html' } }));
    vi.stubGlobal('fetch', outbound);
    const response = await proxy.fetch(webpageRequest('https://news.example.com/start'), env);
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.data.finalUrl).toBe('https://news.example.com/article');
    expect(result.data.html).toContain('Hello!');
    expect(outbound).toHaveBeenCalledTimes(2);
    expect(outbound.mock.calls.some(([url]) => String(url).includes('r.jina.ai'))).toBe(false);
  });

  it('only uses Jina Reader after explicit opt-in', async () => {
    const outbound = vi.fn(async (_url: string) => new Response(JSON.stringify({ data: { content: 'Article text' } }), {
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', outbound);
    const response = await proxy.fetch(webpageRequest('https://news.example.com/article'), {
      ...env,
      PROXY_ENABLE_JINA_READER: '1',
    });
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.data.mode).toBe('reader');
    expect(outbound.mock.calls[0][0]).toContain('https://r.jina.ai/');
  });
});
