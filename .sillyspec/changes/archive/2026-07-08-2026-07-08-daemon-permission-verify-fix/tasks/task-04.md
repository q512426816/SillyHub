---
author: qinyi
created_at: 2026-07-08T21:55:21
id: task-04
title: PolicyEngine allowed_roots 放行临时路径
priority: P0
estimated_hours: 2
depends_on: []
blocks: []
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
goal: 在 daemon PolicyCache 注入点追加 sillyspec 临时路径常量，让 PolicyEngine isPathUnderAnyRoot 放行临时路径写入。
implementation: |
  1. 读 daemon.ts:939-963 register 响应处理和 daemon.ts:1875-1905 附近 _syncPolicyCache。
  2. daemon.ts 顶部常量区新增 SILLYSPEC_TEMP_ROOTS（C:\dev\null、C:/dev/null、/dev/null、tmpdir()），import tmpdir from node:os。
  3. daemon.ts:948-953 register 响应 per-runtime PolicyCache.set 的 union 中追加 SILLYSPEC_TEMP_ROOTS。
  4. _syncPolicyCache 心跳路径同样追加 SILLYSPEC_TEMP_ROOTS。
  5. normalizeAllowedRoots 会做规范化，临时路径经其处理即可。
  6. PolicyEngine 本身（filesystem-policy.ts）不改，只消费 policy.allowedRoots。
acceptance: |
  - PolicyCache.get(<runtimeId>).allowedRoots 含 C:\dev\null / /dev/null / <tmpdir>。
  - isPathUnderAnyRoot('c:\\dev\\null', policy.allowedRoots) 返回 true。
  - 单测 mock register 响应 allowed_roots=['C:/Users/test']，断言 PolicyCache.get(rid).allowedRoots 含临时路径。
  - task-08：临时路径 canWrite allow + 越界路径 D:/evil canWrite 仍 deny。
  - task-07 端到端：sillyspec CLI 写 c:\dev\null 不再被 PolicyEngine deny。
verify: vitest
constraints: 跨平台 tmpdir 返回值不同（Windows AppData\Local\Temp / macOS /var/folders / Linux /tmp）；常量写死 3 类路径不接受外部输入；Windows C:\dev\null 是 null 设备 realpath 可能特殊需单测验证。
covers: [FR-003]
---
# task-04: PolicyEngine allowed_roots 放行临时路径

## 文件
修改 `sillyhub-daemon/src/daemon.ts`（PolicyCache 注入点）

## 背景
PolicyEngine（`sillyhub-daemon/src/policy/filesystem-policy.ts`）的写裁决 `judgeWrite`（filesystem-policy.ts:176-212）取 `policy.allowedRoots`（从 PolicyCache.get(runtimeId)）做 `isPathUnderAnyRoot` 边界校验（filesystem-policy.ts:201）。allowedRoots 来源：daemon register 响应 per-runtime `allowed_roots`（daemon.ts:948-953）+ 心跳响应同步（daemon.ts:1835-1852 `_syncPolicyCache` 路径），均来自 backend 下发的 daemon 实体级 allowed_roots（不含 sillyspec 临时路径）。

sillyspec 写 `c:\dev\null` / 系统 temp / `.sillyspec/.runtime` 时，PolicyEngine `isPathUnderAnyRoot` 返回 false → deny（filesystem-policy.ts:208-211），文案 "Runtime Policy 拒绝本次写入"（日志实证，根因 4 PolicyEngine 侧）。

本 task 在 daemon 侧 PolicyCache 注入点追加临时路径常量，与 task-03（CLI --settings allow）双重放行（R-01 写安全兜底：canUseTool 写校验 + CLI deny）。

## 操作步骤
1. 读 `sillyhub-daemon/src/daemon.ts:939-963`（register 响应处理）和 `daemon.ts:1875-1905` 附近（`_syncPolicyCache` 方法）。
2. 在 `daemon.ts` 顶部常量区（或新建 `sillyhub-daemon/src/policy/temp-paths.ts` 共享常量，供 task-03 复用——但 task-03 已在 permission-rules.ts 内联，本 task 为避免跨文件耦合，在 daemon.ts 内定义局部常量）新增：
   ```typescript
   // FR-003：sillyspec 临时路径放行（与 permission-rules.ts buildWritePermissionRules
   // 同步）。PolicyEngine allowedRoots 追加这些路径，写裁决 isPathUnderAnyRoot 放行。
   import { tmpdir } from 'node:os';

   const SILLYSPEC_TEMP_ROOTS: string[] = [
     'C:\\dev\\null',
     'C:/dev/null',
     '/dev/null',
     tmpdir(), // Windows: C:\Users\xxx\AppData\Local\Temp；macOS: /var/folders/...；Linux: /tmp
   ];
   ```
3. 修改 daemon.ts:948-953 register 响应 per-runtime PolicyCache.set，在 union 中追加临时路径：
   ```typescript
   const union = new Set<string>(expanded);
   union.add(homedir());
   for (const temp of SILLYSPEC_TEMP_ROOTS) union.add(temp);  // FR-003
   this._policyCache.set(runtimeId, normalizeAllowedRoots([...union]));
   ```
4. 修改 `_syncPolicyCache`（daemon.ts:1875+，旧 backend 兜底路径）同样追加：
   ```typescript
   // _syncPolicyCache 内构造 roots 时
   const roots = [...new Set([...rootsRaw, homedir(), ...SILLYSPEC_TEMP_ROOTS])];
   ```
   （精确定位以执行时读源码为准，方法签名 `syncPolicyCache(roots: string[])` 或类似——执行时 grep `_syncPolicyCache` 确认。）
5. `normalizeAllowedRoots`（config.ts:498+）会做规范化（resolveRealPath + 大小写归一），临时路径经其处理即可，无需手动归一。
6. PolicyEngine 本身（filesystem-policy.ts）**不改**——它只消费 `policy.allowedRoots`，注入点在 daemon.ts。

## 验收标准
- daemon 启动后，`PolicyCache.get(<runtimeId>).allowedRoots` 含 `C:\dev\null` / `/dev/null` / `<tmpdir>`（按平台实际值）。
- `isPathUnderAnyRoot('c:\\dev\\null', policy.allowedRoots)` 返回 true（path-utils.ts:149 大小写归一后匹配）。
- 单测 `sillyhub-daemon/tests` 新增：mock register 响应 allowed_roots=['C:/Users/test']，调 daemon 注册流程后断言 PolicyCache.get(rid).allowedRoots 含临时路径。
- task-08 写安全测试：临时路径 canWrite allow + 越界路径（`D:/evil`）canWrite 仍 deny。
- task-07 端到端：sillyspec CLI 写 `c:\dev\null` 不再被 PolicyEngine deny（日志无 "Runtime Policy 拒绝"）。

## 依赖
task-01（Wave 1→Wave 2）。代码层面独立，验收需 task-01 + task-03 配合端到端。

## 风险
- R-02：与 task-03 同，临时路径放行扩大写范围。应对：常量数组写死 3 类路径，不接受外部输入；task-08 越界写 deny 测试守护。
- 常量重复定义（task-03 在 permission-rules.ts，task-04 在 daemon.ts）：理想应抽 `policy/temp-paths.ts` 共享。本 task 为减少爆炸半径内联，执行时若 task-03 已落地可改为 import 共享常量（执行时判断）。
- `_syncPolicyCache` 心跳路径每次心跳都追加临时路径，`normalizeAllowedRoots` 去重后无副作用，但需确认 `JSON.stringify` 变化检测（daemon.ts:1845 对比 existing.allowedRoots）不会因临时路径常驻而每次都判"变化"触发 spam 日志——临时路径是固定值，首次 set 后对比即相同，不会 spam。
- Windows `C:\dev\null` 实际是 null 设备不是目录，`resolveRealPath`（path-utils.ts）可能返回特殊值。执行时单测验证 `isPathUnderAnyRoot('c:\\dev\\null', ['C:\\dev\\null'])` 真返回 true，若 realpath 解析失败需在常量里同时保留原始串 + realpath 串。
