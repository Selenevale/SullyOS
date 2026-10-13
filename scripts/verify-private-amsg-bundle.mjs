/**
 * AMSG private-baseline build integrity gate.
 *
 * A source-code hardening commit is NOT a hardened deployment until the
 * generated worker/amsg/worker.bundle.js contains the new policy.
 * This gate intentionally checks only stable, public code markers: it never
 * reads, compares, or emits secret values.
 */
export const verifyPrivateAmsgBundle = (bundle, label = 'AMSG Worker bundle') => {
  const required = [
    ['required website-origin configuration', 'AMSG_ALLOWED_ORIGIN'],
    ['disallowed website-origin response', 'ORIGIN_NOT_ALLOWED'],
    ['mandatory per-request authentication', 'INVALID_CLIENT_TOKEN'],
    ['blocked privileged remote updater', 'SELF_UPDATE_DISABLED'],
    ['fail-closed proxy default', 'https://proxy.invalid'],
    ['disabled missing-origin fallback', 'https://blocked.invalid'],
  ];
  const forbidden = [
    ['old public proxy as the default', /DEFAULT_PROXY_WORKER\s*=\s*["']https:\/\/proxy\.friedsully\.com["']/],
    ['old autonomous updater', /\brunAutoUpdate\s*\(/],
    ['old privileged self-update handler', /\bhandleSelfUpdate\s*\(/],
  ];
  const errors = [];
  for (const [description, marker] of required) {
    if (!bundle.includes(marker)) errors.push('Missing: ' + description);
  }
  for (const [description, pattern] of forbidden) {
    if (pattern.test(bundle)) errors.push('Unsafe: ' + description);
  }
  return { ok: errors.length === 0, label, errors };
};

export const assertPrivateAmsgBundle = (bundle, label) => {
  const verdict = verifyPrivateAmsgBundle(bundle, label);
  if (!verdict.ok) {
    throw new Error(
      verdict.label + ' fails private-baseline validation:\n- ' +
      verdict.errors.join('\n- ') +
      '\nRebuild with pnpm run build:workers before deploying; do not upload the tracked stale bundle.'
    );
  }
  return verdict;
};
