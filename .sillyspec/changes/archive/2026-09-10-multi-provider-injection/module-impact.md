# 模块影响分析（Module Impact）— 多供应商注入

> 骨架由 plan --done 生成（design 声明清单 × module-map 前缀匹配）；影响类型与 review 标记为语义判断，以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| NEW:codex-settings（sillyhub-daemon） | NEW:src/codex-settings.ts + tests/codex-settings.test.ts | 新增（per-form 写盘器；golden=spike a2b/a2-auth；wire_api 恒 responses 0.147 基线） | 否（18 用例） |
| NEW:pi-settings（sillyhub-daemon） | NEW:src/pi-settings.ts + tests/pi-settings.test.ts | 新增（三文件写盘器；golden=spike b1b/b1-models/b1-settings；api 恒 openai-completions 0.81 基线） | 否（15 用例） |
| daemon（sillyhub-daemon） | src/daemon.ts（interactive 接线+kind 守卫+热切换重写+目录 Map/清理/boot 扫描）+ src/credential-injector.ts（注释） | 接口变更（env 注入对新增）+ 调用关系变更（PROVIDER_CONFIG_CHANGED 扩展） | 否（dispatch/lifecycle/handler 42 用例） |
| task-runner（sillyhub-daemon） | src/task-runner.ts（applyProviderFileSettings 单点+batch 接线+守卫+收尾清理） | 新增（分派函数）+ 调用关系变更 | 否（含 17 直测+batch 集成） |
| llm_provider（backend） | schema.py（词表+codex+Create 禁配 validator）/service.py（Update 禁配 AppError）/tests×2 | 接口变更（词表放宽+422 禁配双侧） | 否（237 用例） |
| llm-providers（frontend） | 表单组件+api 类型+__tests__ | 接口变更（codex 选项/pi 禁选/端点提示） | 否（74 用例） |
| 生成物 | backend/openapi.json + frontend/src/lib/api-types.ts + sillyhub-daemon/src/api-types.ts | 配置变更（gen:types 词表各 1 行） | 否（gen:types:check 零漂移） |

## 未匹配文件

以下变更文件未命中 _module-map.yaml：

- `.sillyspec/docs/sillyhub-daemon/modules/{codex-settings,pi-settings}.md + _module-map.yaml` → 主仓 spec 产物（规则禁写 worktree 副本），task-07 已落主仓并提交；_module-map 两条目登记在案（非索引缺口）
- 其余 worktree diff 文件全部命中上表模块

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `.sillyspec/docs/sillyhub-daemon/modules/_module-map.yaml` | 已增 codex-settings/pi-settings 两条目（task-07 实改主仓，提交在案）；未匹配文件均属主仓 spec 产物非模块索引过期，无需 modules rebuild | done |
| `.sillyspec/docs/sillyhub-daemon/modules/codex-settings.md` / `pi-settings.md` | 新模块卡两张（CLI 版本基线+spike golden 路径+漂移由冒烟暴露 R-03 入注意事项） | done |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
