---
author: qinyi
created_at: 2026-07-08T21:55:21
id: task-02
title: 撤回 635c0d4a permissionMode
priority: P0
estimated_hours: 2
depends_on: []
blocks: []
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager.ts
goal: 撤回 635c0d4a 把 permissionMode 改回 'default'，消除 bypassPermissions 模式下 SDK 行为不可预期。
implementation: |
  1. 定位 session-manager.ts:789-797，把 driverOpts.permissionMode 从 'bypassPermissions' 改回 'default'。
  2. 恢复 635c0d4a 前的注释并补 D-002 说明（canUseTool 注入无条件，bypassPermissions 下 SDK 仍调 canUseTool 未生效）。
  3. 下方 approvalReady/writeGuardEnabled/canUseTool 注入逻辑不动，写守卫靠 canUseTool 注入与 permissionMode 正交。
acceptance: |
  - git diff 显示 session-manager.ts:797 仅 1 行值改回 'default' + 注释更新（撤回 635c0d4a 等价）。
  - daemon 单测涉及 permissionMode 的用例（断言 bypassPermissions）同步改回 default，grep bypassPermissions 全仓无遗漏断言。
  - task-07 端到端：verify stage 重跑，daemon 日志不再出现 bypassPermissions 行为，canUseTool 仍正常注入。
verify: vitest
constraints: 撤回后需 pnpm bundle + 重建 backend 镜像 + 重启 daemon 才生效（task-10 部署）；canUseTool 在 approvalReady=false 分支只做写校验不弹框不影响 chat。
covers: [FR-002, D-002]
---
# task-02: 撤回 635c0d4a permissionMode

## 文件
修改 `sillyhub-daemon/src/interactive/session-manager.ts`

## 背景
commit 635c0d4a 把 `driverOpts.permissionMode` 从 `'default'` 改成 `'bypassPermissions'`（session-manager.ts:797），意图绕过 daemon 侧 permission-resolver 的 canUseTool 拦截修 5min 超时。

D-002 判定该修复基于错误前提：canUseTool 注入是无条件的（session-manager.ts:807-864，`writeGuardEnabled` 为真即注入），SDK 在 `bypassPermissions` 模式下**仍会调用**注入的 canUseTool。日志 "Runtime Policy 拒绝 c:\dev\null" 是 PolicyEngine 中文文案（filesystem-policy.ts:46-53），证明 canUseTool 被调用、bypassPermissions 未生效。真实超时根因是 `ask_user_only=false`（task-01 修），与 permissionMode 无关。

撤回 635c0d4a，恢复 `'default'`，避免 bypassPermissions 模式下 SDK 行为不可预期（写守卫虽注入但语义混淆）。

## 操作步骤
1. 读 `sillyhub-daemon/src/interactive/session-manager.ts:789-797`，定位：
   ```typescript
   // 2026-07-08：bypassPermissions 绕过 daemon 自身权限审批（permission-resolver
   // canUseTool），避免 5min 超时拒绝 + 审批弹窗用户看不到。CLI --permission-mode
   // bypassPermissions 只绕过 CLI 侧，daemon 侧独立拦截。
   driverOpts.permissionMode = 'bypassPermissions';
   ```
2. 改回 `'default'`，并恢复 635c0d4a 前的注释（git show 635c0d4a 确认原注释）：
   ```typescript
   // 显式 permissionMode=default（2026-06-30 修 bug：SDK permissionMode 缺失时
   // 可能沿用 session resume 的旧状态，绕过 canUseTool → 写守卫失效）。
   // 2026-07-08 D-002：撤回 635c0d4a 的 bypassPermissions。canUseTool 注入是无条件
   // 的（writeGuardEnabled 即注入），bypassPermissions 下 SDK 仍调 canUseTool，
   // 未生效且语义混淆。5min 超时真实根因是 ask_user_only=false（task-01 修）。
   driverOpts.permissionMode = 'default';
   ```
3. 该行下方 `approvalReady` / `writeGuardEnabled` / canUseTool 注入逻辑（session-manager.ts:798-864）**不动**——写守卫靠 canUseTool 注入，与 permissionMode 正交。

## 验收标准
- `git diff` 显示 session-manager.ts:797 仅 1 行值改回 `'default'` + 注释更新（撤回 635c0d4a 等价）。
- daemon 侧单测 `sillyhub-daemon/tests` 中涉及 permissionMode 的用例（若有断言 `bypassPermissions`）需同步改回 `default`——执行时 grep `bypassPermissions` 全仓确认无遗漏断言。
- task-07 端到端：verify stage 重跑，daemon 日志不再出现 bypassPermissions 相关行为，canUseTool 仍正常注入（写守卫生效）。

## 依赖
无（Wave 1，与 task-01 并行）。但逻辑上 task-01 修根因、task-02 撤错误修复，两者配合才能消除超时；单独撤回 task-02 不修 task-01 仍会超时。

## 风险
- R-04（design 风险登记）：撤回后需重新 `pnpm bundle` + 重建 backend 镜像（同步分发物）+ 重启 daemon 才生效（task-10 部署）。光改源码不部署无效。
- 若有用户/测试已依赖 bypassPermissions 的副作用（如某些场景期望完全不弹审批），撤回后会恢复 canUseTool 调用——但 canUseTool 在 `approvalReady=false` 分支只做写校验不弹框（session-manager.ts:853-864），不影响 chat 场景。
