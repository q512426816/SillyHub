---
author: WhaleFall
created_at: 2026-06-18T09:35:00
---

# task-09：前端全量验证

## 修改文件

- [ ] 无新增/修改文件（除非发现回归需要修复）

## 实现要求

本任务是 Wave 4 的验证关卡，在 task-01..task-08 全部完成后执行。所有命令在 `frontend/` 目录下运行，使用 `pnpm`（项目 `packageManager: pnpm@9.6.0`）。

实测脚本名（来自 `frontend/package.json` 的 `scripts`）：
- `typecheck` → `tsc --noEmit`
- `lint` → `next lint`
- `test` → `vitest run`
- 覆盖率：`pnpm test -- --coverage`（由 vitest 原生支持，无需额外配置）

### 步骤 1：typecheck

- 命令：`cd frontend && pnpm typecheck`
- 期望：exit code 0，且全局 `grep -n ": any" frontend/src` 不引入新的 `any`
- 常见回归与修复策略：
  - task-05 删除 `PERMISSION_GROUPS` / `PermissionGroup` / `PermissionWithGroup` 后调用方未切换 → 报 `Cannot find name 'PERMISSION_GROUPS'` / `Cannot find namespace 'PermissionGroup'`。修复：定位错误行，按 task-06 的实现要求，picker 改为从 `MENU_PERMISSION_GROUPS` 读取并使用 `MenuPermissionGroup` / `PermissionItem` 类型。
  - task-02 新增 `hasAnyPermission` / `canSeeMenu` / `visibleMenusBySection` 后，task-08 的 `app-shell.tsx` 未切换到新签名 → 报参数/返回类型不匹配。修复：按 task-08 改用 `visibleMenusBySection(user, section)` 返回值渲染。
  - task-01 引入的 `MenuSection` 字面量联合类型与 picker/AppShell 的旧字符串字面量不一致 → 报 `Type 'string' is not assignable to type '"overview" | "management" | "admin" | "system"'`。修复：调用处使用常量或类型断言收敛。
  - 修复原则：只修本变更引入的回归，不在本任务中扩大重构范围。

### 步骤 2：lint

- 命令：`cd frontend && pnpm lint`
- 期望：exit code 0；warning 数量 ≤ 变更前基线（基线由 git stash 或 `git show main:frontend/` 对比确定）
- 常见回归与修复策略：
  - task-05 清理后，原文件残留未使用的 import（如 `hasAdminPermission` 仍被 import 但消费方已切换）→ 触发 `@typescript-eslint/no-unused-vars`。修复：直接移除 import。
  - task-06/08 改造后，部分旧变量未删除（如原 `ADMIN_NAV` 的局部别名）→ 同样 unused。修复：移除。
  - `@typescript-eslint/no-deprecated` 警告：仅保留 `permission.ts` 中 `hasAdminPermission` 一处（task-02 标 `@deprecated` 是有意保留，符合 requirements.md 非功能需求「兼容性」条款）。若 lint 配置开启 `no-deprecated`，需在该行加 `// eslint-disable-next-line @typescript-eslint/no-deprecated` 并附原因注释；其余位置出现 `@deprecated` 引用需清除。
  - 修复原则：能删则删，仅在「刻意保留」且有文档依据时才加 disable 注释。

### 步骤 3：test

- 命令：`cd frontend && pnpm test`
- 期望：所有 suite 通过，exit code 0
- 常见回归与修复策略：
  - task-03/04 之外仍有旧测试 import `PERMISSION_GROUPS` → 报模块解析失败。修复：切换到 `MENU_PERMISSION_GROUPS`（如断言只需要结构，可只 import 类型）。
  - 旧测试断言依赖扁平 `PermissionGroup` 结构（如 `groups[0].permissions`）→ 与新 `MenuPermissionGroup`（含 `section` / `menuKey` / `menuLabel`）字段不匹配。修复：按 task-07 的改造模式重写断言。注意：本任务只跑测试、报告问题，测试本身的修改归属 task-07；若 task-07 已完成但仍有红测，需回头补 task-07。
  - task-06 改了 picker 的 DOM 结构后，task-07 之外的集成测试（如 AppShell 集成测试）查找旧选择器失败。修复：选择器改用 `data-testid` 或按新结构定位。
  - 修复原则：测试失败先归因到具体 task，不在本任务里临时 patch。

### 步骤 4：覆盖率检查

- 命令：`cd frontend && pnpm test -- --coverage`
- 期望（重点文件）：
  - `frontend/src/lib/menu-permissions.ts` ≥ 90%
  - `frontend/src/lib/permission.ts` ≥ 90%
- 不达标策略：
  - 若 `menu-permissions.ts` 覆盖率不足（通常因 19 条数据未遍历完）→ 补断言到 task-03。
  - 若 `permission.ts` 覆盖率不足（通常因 `hasAnyPermission` 的 null 短路、`canSeeMenu` 的 platform_admin 短路未覆盖）→ 补 GWT 用例到 task-04。
  - 覆盖率工具未配置（vitest 默认未安装 `@vitest/coverage-v8`）→ 跳过本步骤，仅以「test 全绿」作为门槛，并在最终报告中注明「覆盖率未启用，建议后续 task 补 v8 provider」。

### 步骤 5：grep 守门（呼应 plan.md 全局验收）

执行以下两条 grep，确认无残留：
- `grep -r "PERMISSION_GROUPS\|PermissionGroup\|PermissionWithGroup" frontend/src/` → 期望仅命中 `permission.ts` 的 `@deprecated hasAdminPermission` 注释；其余位置 0 命中。
- `grep -rE "OVERVIEW_NAV|MANAGEMENT_NAV|SYSTEM_NAV|ADMIN_NAV" frontend/src/` → 期望 0 命中。

若仍有命中：归属对应 task（task-05 或 task-08），本任务仅报告。

## 接口定义

（无，本任务为验证关卡，不对外暴露接口）

## 边界处理

1. **typecheck 报错且属于 task-05/06/08 之外的范围**（如第三方依赖类型冲突、与本次变更无关的旧代码）→ 不在本任务自行修改，记录错误信息后向主流程报告，由 SillySpec 决定是否单独 quick 修复。
2. **lint 报 `@next/next/*` 规则警告**（如 `no-img-element`）→ 与既有配置一致，保留，不计入新增 warning。
3. **覆盖率统计工具未配置**（vitest 报 `Cannot find module '@vitest/coverage-v8'`）→ 跳过覆盖率检查，仅以「pnpm test 全绿」为门槛，最终报告中标注「覆盖率 provider 缺失」。
4. **CI 环境与本地 Node 版本差异**（`engines.node >=20.0.0`）→ 使用 `.nvmrc` 或 `package.json` engines 约束，本地用 `nvm use` 切到 20.x 再跑；版本不符导致 `tsc` 行为差异时，以 20.x 为准。
5. **测试超时或异步竞态**（vitest 默认 5s）→ 先确认是否 task-06/08 引入的真实异步问题（如 useEffect 副作用未清理）；若确属测试基础设施问题，临时调大 `testTimeout` 到 10000ms 并在报告中说明，但不在生产代码加 `setTimeout` 等妥协。
6. **pnpm lockfile 漂移**（`pnpm install` 后 `pnpm-lock.yaml` 有 diff）→ 不在本任务提交 lockfile 变更，归因到依赖管理流程。
7. **Windows 行尾符差异**（本仓库在 win32 开发）→ typecheck 不受影响，lint 若报 `@typescript-eslint/no-multiple-empty-lines` 或 CRLF 相关规则，按既有 `.gitattributes` / `.editorconfig` 处理，不本任务内引入新规则。

## 非目标

- 不修复后端任何测试（本变更纯前端，CI 不需要 backend 测试，见 requirements.md「后端无关」）
- 不修改 CI / Docker 构建配置（CI 与 Docker 验证归属 task-10）
- 不重构无直接关系的代码（即便 typecheck/lint 顺手发现的旧问题）
- 不补无相关性的新测试（仅补 task-03/04 范围内为达标覆盖率所需的最小用例）
- 不删除 `hasAdminPermission`（按 requirements.md 兼容性条款保留 `@deprecated`）
- 不调整 vitest / next lint 的全局配置

## TDD 步骤

1. 确认 task-01..task-08 全部完成（`progress.json` 显示 W1-W3 已 done），否则阻塞。
2. 在 `frontend/` 下执行 `pnpm typecheck`，逐条修复本变更引入的类型错误；修复后重跑直至 exit code 0。
3. 执行 `pnpm lint`，移除未用 import、收敛 `@deprecated` 警告；记录 warning 基线对比，确认「warning 数量不增加」。
4. 执行 `pnpm test`，确认所有 suite 绿；红测先归因到 task-07（测试侧）或 task-06/08（实现侧），不在本任务临时 patch。
5. （可选）执行 `pnpm test -- --coverage`，输出 `menu-permissions.ts` / `permission.ts` 覆盖率；不达标回到 task-03/04 补用例。
6. 执行步骤 5 的两条 grep 守门，确认无残留。
7. 在 progress.json 标记 task-09 完成，输出最终验证报告（typecheck / lint / test / 覆盖率 / grep 四项结论）。

## 验收标准

| 验收项 | 通过标准 |
|---|---|
| typecheck | `cd frontend && pnpm typecheck` exit code 0；本变更未引入新的 `any` |
| lint | `cd frontend && pnpm lint` exit code 0；warning 数量 ≤ 变更前基线 |
| test | `cd frontend && pnpm test` 所有 suite 通过，exit code 0 |
| 覆盖率 | `frontend/src/lib/menu-permissions.ts` ≥ 90% 且 `frontend/src/lib/permission.ts` ≥ 90%（覆盖率 provider 缺失时降级为「test 全绿」并注明） |
| grep 守门 | `PERMISSION_GROUPS\|PermissionGroup\|PermissionWithGroup` 仅 `@deprecated` 注释命中；`OVERVIEW_NAV\|MANAGEMENT_NAV\|SYSTEM_NAV\|ADMIN_NAV` 0 命中 |
| 回归修复 | 任何由本变更（task-01..08）引入的回归都已修复或归因到具体 task |
| 报告 | 最终向主流程汇报四项（typecheck / lint / test / 覆盖率）结论，红项需附 task 编号 |
