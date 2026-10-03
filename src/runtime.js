// 运行时事实：home / profiles 目录 / 当前 profile。
// 契约（与官方 dsh-pack-plugin/src/runtime.js 一致，已从其源码确证）：
//   ctx.profileContext = { name, dir, patchPath, installAnchor, cwd, home, startedBundles, overlays, ... }
//   0.1.7 起 profileContext 直接给出全部事实（零猜路径）；旧环境降级到环境变量兜底。
import path from 'node:path';
import os from 'node:os';

export const PROFILES_DIR = 'profiles';
export const ACTIVE_NAME = 'desktop';

export function resolveRuntime(ctx) {
  const pc = ctx?.profileContext;
  if (pc && typeof pc.home === 'string') {
    return {
      home: pc.home,
      profilesDir: path.join(pc.home, PROFILES_DIR),
      profileName: pc.name ?? ACTIVE_NAME,
      profileDir: pc.dir ?? null,
      patchPath: pc.patchPath ?? null,
      startedBundles: Array.isArray(pc.startedBundles) ? [...pc.startedBundles] : [],
      hasProfileContext: true,
      source: 'profileContext',
    };
  }
  // 兜底：非 dsh profile 启动（例如直接 node 跑测试），用环境变量。
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return {
    home,
    profilesDir: path.join(home, PROFILES_DIR),
    profileName: ACTIVE_NAME,
    profileDir: path.join(home, PROFILES_DIR, ACTIVE_NAME),
    patchPath: null,
    startedBundles: [],
    hasProfileContext: false,
    source: 'env',
  };
}
