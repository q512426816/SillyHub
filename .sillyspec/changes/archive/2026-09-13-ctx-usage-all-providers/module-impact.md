---
author: qinyi
created_at: 2026-09-13 13:22:00
---

# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**与 review 标记是语义判断，已按 worktree 真实 diff（21 文件：19 M + 2 NEW）逐行回填。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| sillyhub-daemon interactive | sillyhub-daemon/src/interactive/usage-ctx.ts、sillyhub-daemon/src/interactive/pi-events.ts、sillyhub-daemon/src/interactive/cursor-events.ts、sillyhub-daemon/src/interactive/codex-app-server-driver.ts、sillyhub-daemon/src/interactive/claude-events.ts、sillyhub-daemon/src/interactive/providers.ts | 新增+逻辑变更+接口变更（ctx 派生 helper 纯函数 NEW；三解析器派生回填；claude 改调 helper 零行为变化；ProviderCaps 第 11 键 ctx_usage） | 否（daemon 相关面 148 绿+typecheck 0） |
| sillyhub-daemon 脚本 | sillyhub-daemon/scripts/gen-provider-caps.mjs | 配置变更（CAPS_KEYS+renderFrontend 模板同步 11 键） | 否（生成幂等两连跑逐字节一致） |
| sillyhub-daemon 测试 | sillyhub-daemon/tests/interactive/usage-ctx.test.ts、sillyhub-daemon/tests/interactive/pi-events.test.ts、sillyhub-daemon/tests/interactive/cursor-events.test.ts、sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts、sillyhub-daemon/tests/interactive/provider-registry.test.ts、sillyhub-daemon/tests/provider-adapter-registry.test.ts | 逻辑变更（断言扩展/守护同步，usage-ctx.test 为 NEW） | 否（8 套件 148 绿） |
| frontend lib | frontend/src/lib/provider-caps.ts | 配置变更（@generated 重生成 11 键） | 否（tsc 0） |
| frontend sessions 组件 | frontend/src/components/sessions/ctx-usage-bar.tsx、frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx、frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx | 逻辑变更（caps 门控+provider prop；门控三分支与十一键断言） | 否（55 绿+tsc+eslint 0 error） |
| frontend daemon 组件 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 调用关系变更（两处 CtxUsageBar 调用传 provider） | 否（55 绿+tsc 0） |
| backend agent 模块 | backend/app/modules/agent/provider_caps.py、backend/app/modules/agent/tests/test_provider_caps_alignment.py | 配置变更+逻辑变更（@generated 重生成 11 键；守护同步 EXPECTED+len 断言） | 否（alignment 4 绿+ruff/mypy 0） |
| docs | docs/agent-provider-onboarding.md | 文档（派生口径两种+caps 登记指引+gen 流程+PAIR_RE 注记） | 否（docs gate 过） |
| sillyhub-daemon | sillyhub-daemon/tests/interactive/usage-ctx.test.ts（NEW）+ pi-events / cursor-events / codex-app-server-driver / provider-registry / provider-adapter-registry .test.ts | 逻辑变更（断言扩展/守护同步） | 否 |
| frontend | frontend/src/lib/provider-caps.ts | 配置变更（@generated 重生成 11 键） | 否 |
## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

（无——骨架生成时列出的 16 个文件经人工判定全部归属既有模块，见上方矩阵；未匹配系骨架生成器所用映射与实际 paths 前缀的版本差异，非索引过期。`sillyhub-daemon/tests/fixtures` 一行已在 plan 阶段从 design 清单移除（fixture 零改动，断言读既有文件），实际 diff 无此路径。）

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 无需增改——全部变更文件归属既有模块（sillyhub-daemon/frontend/backend/docs），骨架未匹配系生成器映射版本差异非索引过期 | skipped |
