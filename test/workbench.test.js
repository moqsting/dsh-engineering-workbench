// 基础单元测试：路径契约与 pythonw 探测（纯函数部分）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';

import { workbenchDir, resolvePythonw } from '../src/workbench.js';
import { resolveRuntime, PROFILES_DIR, ACTIVE_NAME } from '../src/runtime.js';

test('workbenchDir 落在 <profileDir>/wta/ui（布局契约）', () => {
  const dir = workbenchDir('C:/fake/home/profiles/wet-automation');
  assert.equal(dir, path.join('C:/fake/home/profiles/wet-automation', 'wta', 'ui'));
});

test('workbenchDir 对空 profileDir 返回 null', () => {
  assert.equal(workbenchDir(null), null);
});

test('resolveRuntime 优先 profileContext（零猜路径）', () => {
  const ctx = {
    profileContext: {
      name: 'wet-automation',
      dir: 'C:/fake/home/profiles/wet-automation',
      home: 'C:/fake/home',
    },
  };
  const rt = resolveRuntime(ctx);
  assert.equal(rt.source, 'profileContext');
  assert.equal(rt.hasProfileContext, true);
  assert.equal(rt.home, 'C:/fake/home');
  assert.equal(rt.profileDir, 'C:/fake/home/profiles/wet-automation');
  assert.equal(rt.profileName, 'wet-automation');
});

test('resolveRuntime 无 profileContext 时用环境变量兜底', () => {
  const old = process.env.DSH_HOME;
  process.env.DSH_HOME = 'C:/other/home';
  try {
    const rt = resolveRuntime({});
    assert.equal(rt.source, 'env');
    assert.equal(rt.hasProfileContext, false);
    assert.equal(rt.home, 'C:/other/home');
    assert.equal(rt.profilesDir, path.join('C:/other/home', PROFILES_DIR));
    assert.equal(rt.profileName, ACTIVE_NAME);
  } finally {
    if (old === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = old;
  }
});

test('resolvePythonw 返回存在的可执行文件路径', async () => {
  const pyw = await resolvePythonw();
  assert.ok(pyw, '应探测到 pythonw 路径');
  assert.ok(existsSync(pyw), `pythonw 应存在: ${pyw}`);
});
