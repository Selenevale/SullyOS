import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { assertPrivateAmsgBundle, verifyPrivateAmsgBundle } from './verify-private-amsg-bundle.mjs';

const safeBundle = [
  'const DEFAULT_PROXY_WORKER = "https://proxy.invalid";',
  'const requiredOrigin = "AMSG_ALLOWED_ORIGIN";',
  'const deniedOrigin = "ORIGIN_NOT_ALLOWED";',
  'const badToken = "INVALID_CLIENT_TOKEN";',
  'const selfUpdateIsOff = "SELF_UPDATE_DISABLED";',
  'const upstreamBlocked = "https://blocked.invalid";',
  'isMissing: (env) => !isValidAmsgOrigin(env.AMSG_ALLOWED_ORIGIN),',
  'if (origin && origin !== resolveAmsgAllowedOrigin(env)) return deny;',
  'if (!(await constantTimeEqual(supplied, env.AMSG_SERVER_TOKEN.trim()))) return deny;',
  'cors: { origin: resolveAmsgAllowedOrigin(env) || "https://blocked.invalid", allowHeaders: CORS_ALLOW_HEADERS },',
].join('\n');

describe('private AMSG artifact checker', () => {
  it('accepts a fixture containing all private-baseline markers', () => {
    assert.equal(verifyPrivateAmsgBundle(safeBundle).ok, true);
    assert.doesNotThrow(() => assertPrivateAmsgBundle(safeBundle));
  });

  it('fails if the worker omits browser-origin or token enforcement', () => {
    const missing = safeBundle.replaceAll('AMSG_ALLOWED_ORIGIN', '').replace('INVALID_CLIENT_TOKEN', '');
    const result = verifyPrivateAmsgBundle(missing);
    assert.equal(result.ok, false);
    assert.match(result.errors.join(' '), /website-origin configuration/);
    assert.match(result.errors.join(' '), /per-request authentication/);
    assert.throws(() => assertPrivateAmsgBundle(missing), /fails private-baseline validation/);
  });

  it('accepts esbuild-renamed constant-time authentication helper', () => {
    const renamed = safeBundle.replace('constantTimeEqual(', 'constantTimeEqual2(');
    assert.equal(verifyPrivateAmsgBundle(renamed).ok, true);
    assert.doesNotThrow(() => assertPrivateAmsgBundle(renamed));
  });

  it('rejects the original author proxy as the Worker default', () => {
    const bad = safeBundle.replace('https://proxy.invalid', 'https://proxy.friedsully.com');
    assert.equal(verifyPrivateAmsgBundle(bad).ok, false);
  });

  it('rejects a bundle that still contains an autonomous or privileged updater', () => {
    const bad = safeBundle + '\nfunction runAutoUpdate() {}\nfunction handleSelfUpdate() {}';
    const result = verifyPrivateAmsgBundle(bad);
    assert.equal(result.ok, false);
    assert.equal(result.errors.filter(x => x.startsWith('Unsafe:')).length, 2);
  });
});
