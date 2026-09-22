# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| backend | backend/app/modules/platform_sync/service.py | 逻辑变更（无 hub 分支归属改 ctx-owner 两级解析 + 分组 quick 优先；hub 分支/R7/时间过滤不动） | 是（task-03 review 已过） |
| backend | backend/migrations/versions/20260912050000_agent_log_attribution_reset.py | 新增（纯数据迁移零 schema：归属列置 NULL + tool_report 软删 + 两张 links 全清） | 否（task-05 review 已过） |
| backend | backend/app/modules/platform_sync/tests/test_agent_log_push.py | 逻辑变更（预期语义变化用例更新，task-04） | 是（task-04 审） |
| backend | backend/app/modules/platform_sync/tests/test_agent_log_attribution.py | 新增（归属解析新用例，task-04） | 是（task-04 审） |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `src/agent-session-log.js` —— 跨仓文件（sillyspec 仓 C:/Users/qinyi/IdeaProjects/sillyspec，本仓索引天然不覆盖；归 sillyspec 仓自身管理，非索引过期）
- `docs/platform-agent-log-protocol.md` —— 同上（跨仓）
- `test/agent-session-log.test.mjs` —— 同上（跨仓）

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 未匹配 3 文件均为跨仓（sillyspec 仓）文件，本仓索引无需增改 | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
