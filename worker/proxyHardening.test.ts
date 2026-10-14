import { describe, expect, it } from 'vitest';
// @ts-expect-error standalone Worker entry is JS, not a typed module
import proxyWorker from './index.js';

const worker = proxyWorker as {
  fetch: (request: Request, env: Record<string, string>, context?: unknown) => Promise<Response>;
};
const allowed = {
  PROXY_ALLOWED_ORIGINS: 'https://private.pages.dev,http://localhost:5173',
};

const call = (path: string, method: string, origin?: string, env = allowed) =>
  worker.fetch(new Request(`https://proxy.example.invalid${path}`, {
    method,
    ...(origin ? { headers: { Origin: origin } } : {}),
  }), env);

describe('private proxy origin and Cloudflare relay boundary', () => {
  it('rejects browser origins when no allowlist is configured', async () => {
    const response = await call('/api/health', 'OPTIONS', 'https://private.pages.dev', {} as typeof allowed);
    expect(response.status).toBe(403);
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });

  it('answers a preflight only for an exact allowed browser origin', async () => {
    const response = await call('/api/health', 'OPTIONS', 'https://private.pages.dev');
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://private.pages.dev');
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('rejects other browser origins before routing', async () => {
    const response = await call('/api/health', 'GET', 'https://not-private.pages.dev');
    expect(response.status).toBe(403);
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });

  it('does not emit wildcard CORS for server-to-server requests', async () => {
    const response = await call('/api/health', 'GET');
    expect(response.status).toBe(200);
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });

  it('removes the privileged Cloudflare API relay even from an allowed origin', async () => {
    const response = await call('/cf-api?path=/accounts', 'GET', 'https://private.pages.dev');
    expect(response.status).toBe(404);
  });
});
