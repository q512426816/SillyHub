# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**与 review 标记是语义判断，已按 worktree 真实 diff（21 文件：19 M + 2 NEW）逐行回填。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| sillyhub-daemon | sillyhub-daemon/src/interactive/usage-ctx.ts（NEW） | 新增（ctx 派生 helper 纯函数） | 否 |
| sillyhub-daemon | sillyhub-daemon/src/interactive/pi-events.ts | 逻辑变更（buildUsageEvent 派生 ctx_tokens） | 否 |
| sillyhub-daemon | sillyhub-daemon/src/interactive/cursor-events.ts | 逻辑变更（mapUsage 派生 + 注释修正） | 否 |
| sillyhub-daemon | sillyhub-daemon/src/interactive/codex-app-server-driver.ts | 逻辑变更（解析 last + 双路携带 + 透传） | 否 |
| sillyhub-daemon | sillyhub-daemon/src/interactive/claude-events.ts | 逻辑变更（改调共享 helper，行为零变化） | 否 |
| sillyhub-daemon | sillyhub-daemon/src/interactive/providers.ts | 接口变更（ProviderCaps 第 11 键 ctx_usage） | 否 |
| sillyhub-daemon | sillyhub-daemon/scripts/gen-provider-caps.mjs | 配置变更（CAPS_KEYS + 模板同步） | 否 |
| sillyhub-daemon | sillyhub-daemon/tests/interactive/usage-ctx.test.ts（NEW）+ pi-events / cursor-events / codex-app-server-driver / provider-registry / provider-adapter-registry .test.ts | 逻辑变更（断言扩展/守护同步） | 否 |
| frontend | frontend/src/lib/provider-caps.ts | 配置变更（@generated 重生成 11 键） | 否 |
| frontend | frontend/src/components/sessions/ctx-usage-bar.tsx | 逻辑变更（caps 门控 + provider prop） | 否 |
| frontend | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 调用关系变更（两调用点传 provider） | 否 |
| frontend | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx + pre-session-picker.test.tsx | 逻辑变更（门控三分支 / 十一键断言） | 否 |
| backend | backend/app/modules/agent/provider_caps.py | 配置变更（@generated 重生成 11 键） | 否 |
| backend | backend/app/modules/agent/tests/test_provider_caps_alignment.py | 逻辑变更（守护同步 11 键） | 否 |
| docs | docs/agent-provider-onboarding.md | 文档（派生口径 + caps 登记指引 + gen 流程） | 否 |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

（无——骨架生成时列出的 16 个文件经人工判定全部归属既有模块，见上方矩阵；未匹配系骨架生成器所用映射与实际 paths 前缀的版本差异，非索引过期。`sillyhub-daemon/tests/fixtures` 一行已在 plan 阶段从 design 清单移除（fixture 零改动，断言读既有文件），实际 diff 无此路径。）

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 无需增改——全部变更文件归属既有模块（sillyhub-daemon/frontend/backend/docs），骨架未匹配系生成器映射版本差异非索引过期 | skipped |
