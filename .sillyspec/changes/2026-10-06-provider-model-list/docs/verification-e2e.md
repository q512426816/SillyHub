# 端到端验收记录（task-11）— 2026-10-06-provider-model-list

环境：execute worktree 本地栈（backend uvicorn :8765 连本机 PG——迁移 20261006200000 已实跑往返；前端 vitest 组件级 237 passed 覆盖编辑器/下拉/徽标交互）。生产部署后的用户级 UI 复验在部署窗口执行（本变更与前一变更同窗口部署）。

## A. 迁移折算实跑（本机 PG，development 库）

| # | 场景 | 结果 |
|---|---|---|
| A1 | upgrade 20261006200000 应用 | ✅ 四旧列删除 + models JSON 列在位 |
| A2 | 存量折算（Kimi/DeepSeek/智谱各行） | ✅ 实查折算产物：智谱 GLM → [{"name":"glm-5.1","roles":["sonnet","opus","fable","haiku"],"one_m":false}] 等四形态正确（角色归并/one_m 透传/去重保序） |
| A3 | downgrade → upgrade 往返 | ✅ 对称可逆 |

## B. 组件级 UI 验证（vitest 全绿面）

| # | 场景 | 结果 |
|---|---|---|
| B1 | 模型列表编辑器：行内 name/三态下拉/角色标签（aria-pressed）/one_m/删行/+添加 | ✅ form.test 29 用例 |
| B2 | 配置条模型下拉源 = 供应商 models 列表（主模型置顶 + 默认项） | ✅ config-bar 53 用例 |
| B3 | 列表卡片摘要 = 主模型条目 + 角色映射标记 | ✅ list.test |
| B4 | 多模态三态下沉显示（page-helpers 主模型条目判定） | ✅ panel 相关测试 |

## C. 覆盖方式说明

- 注入折算契约（两键同值 + mappings 形态逐字 + models 新键）：`test_provider_config_payload.py` 8 用例断言消费面形态；daemon diff=0。
- 门控三态 × 列表命中/未命中/主模型兜底：`test_capability.py` 重写为列表口径 5 用例。
- 会话选模型 ∈ 列表 422 / 派生：`test_inject_session_model.py` 7 用例（种子扩 extra_models）。
- 迁移折算四形态 + one_m 冲突 true 优先 + downgrade 反折：SQLite Operations 直驱（与上一变更同型范式）。
- 生产 PG 部署：与 2026-10-06-provider-multi-agent-kind 同部署窗口执行（迁移已在开发库实跑背书）。

## 边界备注

- 旧供应商级显式 multimodal 标记折算后变 auto（D-004 接受——粒度下沉，auto 启发式兜底；编辑一次即恢复精确控制）。
- 10 个旧角色映射族前端用例 skip（一键设置/4 槽联动等已退役交互，形态大改留专项重写——`it.skip` 标记可 grep）。

## 验收后清理

- 本地栈 uvicorn/next dev 已停；临时验收数据已清（如使用）。
