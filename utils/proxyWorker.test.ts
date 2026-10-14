import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PROXY_WORKER,
  getProxyWorkerUrl,
  setProxyWorkerUrl,
  isCustomProxyWorker,
  rewriteStaleWorkerUrl,
  requestProxyWorkerSettingsFocus,
  consumeProxyWorkerSettingsFocus,
  setProxyWorkerUrlOverride,
  getProxyWorkerAccessToken,
  setProxyWorkerAccessToken,
  setProxyWorkerRuntimeAuth,
  proxyWorkerAuthHeadersFor,
} from './proxyWorker';

const LS_KEY = 'sully_proxy_worker_url_v1';

describe('proxyWorker 中心配置', () => {
  afterEach(() => setProxyWorkerUrlOverride(null));
  it('旧公共域名迁移，保留路径查询串，自有地址不被误匹配', () => {
    localStorage.setItem(LS_KEY, 'https://sullymeow.ccwu.cc/');
    expect(getProxyWorkerUrl()).toBe(DEFAULT_PROXY_WORKER);
    expect(DEFAULT_PROXY_WORKER).toBe('https://proxy.invalid');
    expect(rewriteStaleWorkerUrl('https://sullymeow.ccwu.cc/api?test=1')).toBe(`${DEFAULT_PROXY_WORKER}/api?test=1`);
    setProxyWorkerUrlOverride('https://sullymeow.ccwu.cc');
    expect(getProxyWorkerUrl()).toBe(DEFAULT_PROXY_WORKER);
    setProxyWorkerUrlOverride('https://my-proxy.test');
    expect(getProxyWorkerUrl()).toBe('https://my-proxy.test');
    setProxyWorkerUrlOverride(null);
    setProxyWorkerUrl('https://sullymeow.ccwu.cc.example.com');
    expect(getProxyWorkerUrl()).toBe('https://sullymeow.ccwu.cc.example.com');
    expect(rewriteStaleWorkerUrl('https://own.example.com/path/sullymeow.ccwu.cc')).toBe('https://own.example.com/path/sullymeow.ccwu.cc');
  });
  beforeEach(() => {
    localStorage.clear();
  });

  it('没设过时返回默认地址', () => {
    expect(getProxyWorkerUrl()).toBe(DEFAULT_PROXY_WORKER);
    expect(isCustomProxyWorker()).toBe(false);
  });

  it('设了自定义地址后读得到，且标记为自定义', () => {
    setProxyWorkerUrl('https://my-worker.example.com');
    expect(getProxyWorkerUrl()).toBe('https://my-worker.example.com');
    expect(isCustomProxyWorker()).toBe(true);
  });

  it('去掉首尾空格和结尾斜杠', () => {
    setProxyWorkerUrl('  https://my-worker.example.com///  ');
    expect(getProxyWorkerUrl()).toBe('https://my-worker.example.com');
  });

  it('填的就是默认地址 → 清空存储，回落默认', () => {
    setProxyWorkerUrl('https://my-worker.example.com');
    expect(isCustomProxyWorker()).toBe(true);
    setProxyWorkerUrl(DEFAULT_PROXY_WORKER);
    expect(localStorage.getItem(LS_KEY)).toBeNull();
    expect(getProxyWorkerUrl()).toBe(DEFAULT_PROXY_WORKER);
  });

  it('传空字符串 → 清空存储，回落默认', () => {
    setProxyWorkerUrl('https://my-worker.example.com');
    setProxyWorkerUrl('');
    expect(localStorage.getItem(LS_KEY)).toBeNull();
    expect(getProxyWorkerUrl()).toBe(DEFAULT_PROXY_WORKER);
  });

  it('非法地址（不带 http/https）→ 不写入', () => {
    setProxyWorkerUrl('my-worker.example.com'); // 缺协议
    expect(localStorage.getItem(LS_KEY)).toBeNull();
    expect(getProxyWorkerUrl()).toBe(DEFAULT_PROXY_WORKER);
  });

  it('存量里如果是脏数据（非 http）→ 读取时回落默认', () => {
    localStorage.setItem(LS_KEY, 'javascript:alert(1)');
    expect(getProxyWorkerUrl()).toBe(DEFAULT_PROXY_WORKER);
  });

  it('旧的 *.workers.dev 默认域名 → 读取时迁移回默认', () => {
    localStorage.setItem(LS_KEY, 'https://sully-n.qegj567.workers.dev');
    expect(getProxyWorkerUrl()).toBe(DEFAULT_PROXY_WORKER);
  });

  it('http（非 https）的自定义地址也接受', () => {
    setProxyWorkerUrl('http://localhost:8787');
    expect(getProxyWorkerUrl()).toBe('http://localhost:8787');
  });

  it('已过期的 sullymeow.ccwu213.cc → 读取时迁移回默认', () => {
    localStorage.setItem(LS_KEY, 'https://sullymeow.ccwu213.cc');
    expect(getProxyWorkerUrl()).toBe(DEFAULT_PROXY_WORKER);
  });
});

describe('网络代理设置定位', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, String(value)); },
      removeItem: (key: string) => { store.delete(key); },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('公告发出的定位请求只消费一次', () => {
    expect(consumeProxyWorkerSettingsFocus()).toBe(false);
    requestProxyWorkerSettingsFocus();
    expect(consumeProxyWorkerSettingsFocus()).toBe(true);
    expect(consumeProxyWorkerSettingsFocus()).toBe(false);
  });
});

// 已死的历史公共实例域名必须被迁到当前 worker，否则独立持久化的存量配置
// （音乐播放器 / 小红书 serverUrl）会一直打 DNS 解析失败的地址
describe('rewriteStaleWorkerUrl', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('迁移已过期的 sullymeow.ccwu213.cc，保留路径', () => {
    expect(rewriteStaleWorkerUrl('https://sullymeow.ccwu213.cc')).toBe(DEFAULT_PROXY_WORKER);
    expect(rewriteStaleWorkerUrl('https://sullymeow.ccwu213.cc/api')).toBe(`${DEFAULT_PROXY_WORKER}/api`);
  });

  it('迁移最早的 workers.dev 默认域名', () => {
    expect(rewriteStaleWorkerUrl('https://sully-n.qegj567.workers.dev/api')).toBe(`${DEFAULT_PROXY_WORKER}/api`);
  });

  it('中心配了自部署 worker 时，死域名跟着迁到自部署地址', () => {
    setProxyWorkerUrl('https://my-own.example.com');
    expect(rewriteStaleWorkerUrl('https://sullymeow.ccwu213.cc/api')).toBe('https://my-own.example.com/api');
  });

  it('活地址 / 用户自部署地址 / 空值原样保留', () => {
    expect(rewriteStaleWorkerUrl(DEFAULT_PROXY_WORKER)).toBe(DEFAULT_PROXY_WORKER);
    expect(rewriteStaleWorkerUrl('https://my-own.example.com/api')).toBe('https://my-own.example.com/api');
    expect(rewriteStaleWorkerUrl('')).toBe('');
  });
});

describe('private proxy access-token origin isolation', () => {
  beforeEach(() => {
    localStorage.clear();
    setProxyWorkerUrlOverride(null);
    setProxyWorkerRuntimeAuth(null, null);
  });
  afterEach(() => {
    setProxyWorkerRuntimeAuth(null, null);
    setProxyWorkerUrlOverride(null);
  });

  it('only adds the browser token for the exact chosen private Worker origin', () => {
    setProxyWorkerUrl('https://my-proxy.example.com');
    setProxyWorkerAccessToken('  local-private-token  ');
    expect(getProxyWorkerAccessToken()).toBe('local-private-token');
    expect(proxyWorkerAuthHeadersFor('https://my-proxy.example.com/search?q=hi'))
      .toEqual({ 'X-Proxy-Token': 'local-private-token' });
    expect(proxyWorkerAuthHeadersFor('https://other.example.com/search')).toEqual({});
    expect(proxyWorkerAuthHeadersFor('https://my-proxy.example.com.evil.test/search')).toEqual({});
    expect(proxyWorkerAuthHeadersFor('https://my-proxy.example.com@evil.test/search')).toEqual({});
    expect(proxyWorkerAuthHeadersFor('https://my-proxy.example.com:8443/search')).toEqual({});
  });

  it('never attaches a token to the default invalid Worker, a legacy proxy, or a non-local HTTP endpoint', () => {
    setProxyWorkerAccessToken('local-private-token');
    expect(proxyWorkerAuthHeadersFor('https://proxy.invalid/search')).toEqual({});
    setProxyWorkerUrl('https://proxy.friedsully.com');
    expect(proxyWorkerAuthHeadersFor('https://proxy.friedsully.com/search')).toEqual({});
    setProxyWorkerUrl('http://remote.example.com');
    setProxyWorkerAccessToken('bad-http-token');
    expect(proxyWorkerAuthHeadersFor('http://remote.example.com/search')).toEqual({});
  });

  it('a Worker address change or reset invalidates the old locally stored bearer', () => {
    setProxyWorkerUrl('https://worker-a.example.com');
    setProxyWorkerAccessToken('worker-a-token');
    setProxyWorkerUrl('https://worker-b.example.com');
    expect(getProxyWorkerAccessToken()).toBe('');
    setProxyWorkerAccessToken('worker-b-token');
    setProxyWorkerUrl('');
    expect(getProxyWorkerAccessToken()).toBe('');
  });

  it('AMSG runtime override takes precedence, and refuses to use a mismatched or missing secret', () => {
    setProxyWorkerUrl('https://my-proxy.example.com');
    setProxyWorkerAccessToken('browser-token');
    setProxyWorkerRuntimeAuth('https://wrong-proxy.example.com', 'cloud-secret');
    expect(proxyWorkerAuthHeadersFor('https://my-proxy.example.com/search')).toEqual({});
    setProxyWorkerRuntimeAuth('https://my-proxy.example.com', 'cloud-secret');
    expect(proxyWorkerAuthHeadersFor('https://my-proxy.example.com/search'))
      .toEqual({ 'X-Proxy-Token': 'cloud-secret' });
    expect(proxyWorkerAuthHeadersFor('https://api.search.brave.com/search')).toEqual({});
    setProxyWorkerRuntimeAuth('https://my-proxy.example.com', '');
    expect(proxyWorkerAuthHeadersFor('https://my-proxy.example.com/search')).toEqual({});
    setProxyWorkerRuntimeAuth(null, null);
    expect(proxyWorkerAuthHeadersFor('https://my-proxy.example.com/search'))
      .toEqual({ 'X-Proxy-Token': 'browser-token' });
  });
});
