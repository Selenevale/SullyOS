import { describe, it, expect } from 'vitest';
import { STARTUP_UPDATE_CHECK_MIN_INTERVAL_MS, pickStartupUpdateAction, shouldRequestStartupUpdateCheck } from './amsgAutoUpdateTrigger';

describe('shouldRequestStartupUpdateCheck', () => {
  const NOW = Date.parse('2026-09-25T08:00:00.000Z');

  it('从没敲过门 → 敲', () => {
    expect(shouldRequestStartupUpdateCheck(null, 'dev@abc', NOW)).toBe(true);
  });

  /**
   * 回归守卫：前端换了构建就该立刻催后端一次——两边一起改的功能，前端已经会了、
   * 后端还没跟上，正是这一下要补的空档。不能被「离上次不够久」挡住。
   */
  it('构建换了 → 不管离上次多近都敲', () => {
    expect(shouldRequestStartupUpdateCheck({ buildLabel: 'dev@old', atMs: NOW - 1000 }, 'dev@new', NOW)).toBe(true);
  });

  it('同一个构建、离上次不够久 → 不敲（手机一天开十几次 App 不该次次去撞）', () => {
    expect(shouldRequestStartupUpdateCheck({ buildLabel: 'dev@abc', atMs: NOW - STARTUP_UPDATE_CHECK_MIN_INTERVAL_MS + 1 }, 'dev@abc', NOW)).toBe(false);
  });

  it('同一个构建、够久了 → 敲', () => {
    expect(shouldRequestStartupUpdateCheck({ buildLabel: 'dev@abc', atMs: NOW - STARTUP_UPDATE_CHECK_MIN_INTERVAL_MS }, 'dev@abc', NOW)).toBe(true);
  });
});

describe('private baseline startup updater', () => {
  it('never requests an update, even for outdated or nominally update-capable workers', () => {
    expect(pickStartupUpdateAction({ state: 'outdated', autoUpdate: null })).toBe('none');
    expect(pickStartupUpdateAction({ state: 'outdated', autoUpdate: { supported: true, state: null } })).toBe('none');
    expect(pickStartupUpdateAction({ state: 'current', autoUpdate: { supported: true, state: null } })).toBe('none');
    expect(pickStartupUpdateAction({ state: 'unknown', autoUpdate: null })).toBe('none');
  });
});
