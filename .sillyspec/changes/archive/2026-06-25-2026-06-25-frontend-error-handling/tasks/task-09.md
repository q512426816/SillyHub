---
id: task-09
title: 全链路验证（pnpm test + tsc + lint + D 模式残留 grep + daemon 409 抽查）
priority: P0
estimated_hours: 1.0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08]
blocks: []
requirement_ids: []
decision_ids: []
allowed_paths: []
author: qinyi
created_at: 2026-06-25 10:21:25
---

## 目标

变更收口前的全链路验证。**不改任何产品代码 / 文档**，只跑验证命令并核对结果，确认 task-01~08 的产出满足全局验收 AC-05（测试全绿 + 类型 0 error + lint 通过）与 AC-03（D 模式残留 = 0），并抽查 daemon 删除 409 友好提示端到端生效。对应 plan.md 的 R-02 / NFR-01 / NFR-05。

> 本 task 是「验证门」：任何一条失败都必须回到对应 task 修复后重跑，不得在本 task 里改产品代码「让验证过」。

## 前置依赖

**全部 task-01~08 必须完成**。本 task 是变更的最后一步，依赖：

- task-01/02/03：`lib/errors.ts` + `errors.test.ts` 已落地（验证对象 1/2/3 命中新增测试）。
- task-04/05：daemon 删除改造 + `runtimes/page.test.tsx` 不破坏（验证对象 1 含 page 测试）。
- task-06：D 模式 16 处收敛（验证对象 4 的 grep 残留 = 0）。
- task-07：3 处局部 util 合并（验证对象 1/2 不破坏既有测试）。
- task-08：模块文档已写（不影响验证命令，但 depends_on 含它以确保变更完整性）。

## 实现步骤

### 验证 1：vitest 全量测试

**命令**（在 frontend 目录，**勿在 monorepo 根跑**——依据记忆 `sillyspec-must-run-at-repo-root.md` 的反向：sillyspec 命令在根跑，但 pnpm 子项目命令须 cd 到子项目）：

```bash
cd frontend && pnpm test
```

**预期**：
- 退出码 0。
- 全部测试套件绿，包含：
  - **新增** `src/lib/errors.test.ts`（task-03）：network_error 中文兜底 / 业务中文 message / 非 ApiError / fallback / 返回值绝不含 code 各分支。
  - **既有** `src/lib/api.test.ts` 或 `__tests__/api.test.ts`（ApiError / apiFetch 契约，task-01 改 errors.ts 不得破坏）。
  - **既有** `src/app/(dashboard)/runtimes/page.test.tsx`（task-04/05 改 handleDeleteRuntime 后必须仍绿）。
  - **既有** ppm kanban / problem-list / problem-changes 相关测试（task-07 改 store/forms 的 import 后必须仍绿）。

**失败处置**：
- 若 `errors.test.ts` 红 → 回到 task-03 修测试或 task-01 修实现（先判定是测试断言错还是实现错，依据记忆「非测试逻辑本身有误时禁止直接改测试通过」）。
- 若 `api.test.ts` 红 → task-01 改 errors.ts 时误碰了 api.ts 契约（design §9 N4 明确不得改 apiFetch/ApiError），回到 task-01 还原。
- 若 `runtimes/page.test.tsx` 红 → task-04 改 handleDeleteRuntime 破坏了 mock/断言（R-06），回到 task-05 同步更新测试（mock 新的 Modal.confirm / notify 调用）。
- 若 ppm 相关测试红 → task-07 合并 util 时改坏了 import 路径或行为，回到 task-07 修。

### 验证 2：TypeScript 类型检查

**命令**：

```bash
cd frontend && pnpm exec tsc --noEmit
```

**预期**：
- 退出码 0。
- 0 个 TS error。重点关注：
  - `lib/errors.ts` 的 `errMessage(err: unknown)` 类型窄化（`instanceof ApiError` 后访问 `code`）。
  - `useNotify` 返回类型与调用点（task-04 runtimes/page、task-06 16 处）一致。
  - task-07 改 import 后无「无法找到模块」或「未使用的 import」。

**失败处置**：
- 若 errors.ts 自身类型错 → 回到 task-01/02 修类型签名（如 `err` 需先用 `instanceof` 窄化再读 `.code`）。
- 若调用点（runtimes/page 等）类型错 → 该 task 改造时签名不匹配，回到对应 task 修（如把 `notify.error(err.code)` 误写成读 code）。
- 若是 `tsconfig` 严格度问题（noUnusedLocals 等）→ 清理未用 import，勿放宽 tsconfig。

### 验证 3：ESLint

**命令**：

```bash
cd frontend && pnpm lint
```

**预期**：
- 退出码 0，next lint 通过。
- 无 error 级告警（warning 可接受但建议清理）。

**失败处置**：
- 若有 `react-hooks/exhaustive-deps` 告警（useNotify 闭包依赖）→ 回到 task-02 检查 hook 依赖数组。
- 若有 `@typescript-eslint/no-explicit-any` → 回到对应 task 把 `any` 改 `unknown` + 类型窄化。
- 若有未使用 import → 清理。

### 验证 4：D 模式残留 grep（AC-03 核心验证）

**命令**（在 repo 根跑，rg 路径是 `frontend/src`）：

```bash
rg '\$\{[^}]*[Cc]ode[^}]*\}\s*[:：]' frontend/src
```

**正则解读**：匹配模板字符串里 `${...code...}` 后跟半角/全角冒号的形式，即 D 模式 `` `${err.code}: ${err.message}` `` 的特征。

**预期**：
- **输出 0 行**（exit code 1，rg 的「无匹配」语义）。
- 对照 design §6 的 D 模式 16 处清单，确认全部已收敛：
  - `api-key-create-dialog.tsx:53`
  - `daemon-dir-browser.tsx:49`
  - `health-card.tsx:35`
  - `server-status-card.tsx:77`
  - `workspace-scan-dialog.tsx:92/111/125/142`（4 处）
  - `workspaces/[id]/members/page.tsx:57/82/110/131`（4 处）
  - `workspace-member-add-dialog.tsx:78/129`（2 处）
  - `settings/api-keys/page.tsx:50/82`（2 处）

**失败处置**：
- 若有残留行 → 逐一对照清单，回到 task-06 收敛遗漏点。
- **注意排除误报**：grep 可能命中合法的 `${xxx.code}:` 模板（如展示 HTTP status code 的调试面板、非错误语境的 code 字段）。逐行人工核对：仅「错误展示给用户」语境的 `${...code...}:` 才算违规，调试/日志/非用户可见的 code 展示不在收敛范围（design N3 仅收敛用户可见 D 反模式）。若判定为误报，在验证报告里标注理由。

### 验证 5：daemon 删除 409 端到端抽查（AC-02 抽查）

**背景**：task-04 改了 `handleDeleteRuntime`，409 时应弹后端中文 message（如「该 daemon 仍被 N 个 workspace 绑定…」）而非英文 code/500。本验证确认端到端生效。

**方式 A（首选，单测覆盖）**：检查 `runtimes/page.test.tsx` 是否有 409 场景的测试用例（task-05 可能已补）：

```bash
grep -n "409\|CONFLICT\|绑定" frontend/src/app/\(dashboard\)/runtimes/page.test.tsx
```

若有 409 用例且验证 1 全绿 → AC-02 抽查通过。

**方式 B（环境允许时，手动 mock）**：若方式 A 无覆盖且本机可起 frontend + backend：

1. 制造一个绑定状态：把某 daemon runtime 绑定到 workspace（或在 DB 直接插绑定记录）。
2. 在 `/runtimes` 页点删除该 runtime。
3. 观察toast：应显示后端中文「该 daemon 仍被 N 个 workspace 绑定…」，**不应**出现 `HTTP_409_CONFLICT: ...` 或英文 code。
4. 点确认弹窗应是 antd `Modal.confirm`（有遮罩 + 主题样式），**不应**是浏览器原生 `window.confirm`（无遮罩、系统样式）。
5. 删除成功（未绑定的情况）应弹 `notify.success("运行时已移除")` + 列表实时移除。

**方式 C（环境不允许时）**：方式 A 无覆盖且无法起服务 → **记为遗留**，在验证报告里标注「409 端到端抽查待环境就绪后补」，不阻塞变更收口（因 task-04 改造 + task-05 测试已覆盖逻辑层，单测绿即可放行；端到端抽查是 NFR-05 的额外保障，非阻塞项）。

**失败处置**：
- 方式 A 测试红 → 回到 task-05 修测试或 task-04 修实现。
- 方式 B 观察到英文 code → task-04 未正确接入 `notify.error(err)`（仍读 err.code），回到 task-04 修。
- 方式 B 观察到 `window.confirm` → task-04 未替换为 `Modal.confirm`，回到 task-04 修。

### 验证 6（可选）：未接入页面行为零变化（AC-06）

**背景**：design §9 渐进式兼容，未接入 `errMessage`/`useNotify` 的页面行为应完全不变。

**抽查方式**：grep 找出未接入的页面（如 admin/users 的 C 模式 `err.code` 映射、其他未改的 inline setError），手动或单测验证其错误展示与变更前一致。

```bash
# 找出仍用 err.message 直接展示（未接入 errMessage）的点
rg 'setError\(err\.message\)|message\.error\(err\.message\)' frontend/src --files-with-matches
```

**预期**：这些点行为不变（design N3 不全量收敛）。本项为抽样确认，非阻塞。

## 参考代码/文档

- **命令来源**：`.sillyspec/local.yaml`（frontend: `pnpm test` / `pnpm lint`，tsc 用 `pnpm exec tsc --noEmit`）
- **AC 对照**：`plan.md` 全局验收 AC-02 / AC-03 / AC-05 / AC-06
- **D 模式清单**：`design.md` §6（16 处精确路径）
- **记忆约束**：`sillyspec-must-run-at-repo-root.md`（pnpm 子项目命令 cd 到 frontend；sillyspec 命令在根）

## 验收标准（对应 AC-05 / AC-06）

本 task 即验证本身，验收标准 = 6 条验证全过：

- [ ] **AC-09a**（对应 AC-05）：`cd frontend && pnpm test` 退出码 0，含 errors.test.ts 新增 + api.test.ts / runtimes/page.test.tsx / ppm 测试既有均绿。
- [ ] **AC-09b**（对应 AC-05）：`cd frontend && pnpm exec tsc --noEmit` 退出码 0，0 TS error。
- [ ] **AC-09c**（对应 AC-05）：`cd frontend && pnpm lint` 退出码 0，next lint 通过。
- [ ] **AC-09d**（对应 AC-03）：`rg '\$\{[^}]*[Cc]ode[^}]*\}\s*[:：]' frontend/src` 输出 0 行（D 模式 16 处全收敛）。
- [ ] **AC-09e**（对应 AC-02）：daemon 删除 409 抽查通过（方式 A/B/C 任一）。
- [ ] **AC-09f**（对应 AC-06）：未接入页面行为零变化（抽查确认，非阻塞）。

全部通过 → 变更可进入 sillyspec-verify / archive 流程；任一失败 → 回到对应 task 修复后重跑本 task。

## 测试/验证命令

汇总（每条预期 + 失败处置见上方「实现步骤」对应小节）：

```bash
# 验证 1：vitest 全量
cd frontend && pnpm test

# 验证 2：TypeScript 类型检查
cd frontend && pnpm exec tsc --noEmit

# 验证 3：ESLint
cd frontend && pnpm lint

# 验证 4：D 模式残留 grep（在 repo 根跑）
rg '\$\{[^}]*[Cc]ode[^}]*\}\s*[:：]' frontend/src

# 验证 5：daemon 409 抽查（方式 A：查测试覆盖）
grep -n "409\|CONFLICT\|绑定" frontend/src/app/\(dashboard\)/runtimes/page.test.tsx

# 验证 6（可选）：未接入点抽查
rg 'setError\(err\.message\)|message\.error\(err\.message\)' frontend/src --files-with-matches
```

## 风险/注意事项

1. **测试破坏的处置原则（主要）**：依据 CLAUDE.md 规则 8「非测试逻辑本身有误时，禁止直接修改测试来通过」，验证 1 失败时必须先判定根因——是测试断言过期（测试错，改测试）还是实现破坏了契约（实现错，改实现回 task-X）。**不得在本 task 里改测试或产品代码「让验证过」**，本 task 是只读验证门。
2. **rg 正则误报**：验证 4 的 grep 可能命中非错误语境的 `${...code...}:`（如展示状态码的调试 UI）。逐行人工核对，仅「错误展示给用户」才算违规；误报在验证报告标注。
3. **D 模式清单可能漂移**：design §6 的 16 处是 Grill grep 实测时点，execute 期间若有新代码引入 D 模式（他人并行提交），grep 残留可能 > 0 且不在清单。此时区分：清单内的遗漏 → 回 task-06；清单外的新增 → 评估是否纳入本变更（design N3 边界）或记遗留。
4. **方式 C 遗留不阻塞**：daemon 409 端到端若环境不允许手测，方式 C 记遗留可放行（逻辑层有 task-04 改造 + task-05 单测保障）。但在验证报告必须明确标注「待环境就绪补端到端」，不得隐瞒。
5. **tsc 与 lint 的执行位置**：`pnpm exec tsc --noEmit` 必须在 frontend 目录（tsconfig 在那）；rg 在 repo 根（路径参数是 `frontend/src`）。勿混淆 cwd。
6. **不跑 build**：本 task 不跑 `pnpm build`（next build 较慢且与 tsc+lint 有重叠验证），AC-05 只要求 test+tsc+lint。若 sillyspec-verify 阶段要求 build，再单独跑。
