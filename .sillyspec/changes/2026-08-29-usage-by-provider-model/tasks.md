# tasks — 用量统计细化到供应商/模型 + 会话页模型级联选择

author: qinyi
created_at: 2026-08-29 02:37:13

## Wave 1 — backend 落库与统计

- [ ] task-01: agent_run_model_usage ORM + alembic 迁移（head 接 6756e634f119）(depends_on: —)
- [ ] task-02: schema 扩展 + pnpm gen:types（InteractiveRunResultRequest 增 model_usage[]/api_requests；RuntimeUsageRead 增 by_provider）(depends_on: task-01)
- [ ] task-03: close_interactive_run 明细 upsert + run 列填充（llm_provider_id 仅空时填，model 终态填）+ 测试 (depends_on: task-01,02)
- [ ] task-04: complete_lease batch 单行明细 + run 列填充 + 测试 (depends_on: task-01,02)
- [ ] task-05: get_runtimes_usage by_provider 查询（COALESCE 去重沿用）+ runtime 测试 (depends_on: task-01,02)

## Wave 2 — daemon 上报扩展

- [ ] task-06: daemon.ts _modelUsageRows 明细行 + run 级 assistant 消息计数 → payload.model_usage/api_requests (depends_on: task-02)
- [ ] task-07: stream-json message_start 计数器 + task-runner stats 带 model/api_requests + hub-client 透传 (depends_on: task-02)
- [ ] task-08: daemon 测试补齐（bridge 明细/计数/缺省 + stats-passthrough batch model/requests）(depends_on: task-06,07)

## Wave 3 — 前端与切换链路（task-10 因与 task-09 同文件移入 Wave 4）

- [ ] task-09: session-config-bar 四块→两块（删机器/智能体块与无用 hook，布局收缩）(depends_on: —)
- [ ] task-10: 供应商+模型级联（候选=model/default_fallback/role_mappings 去重保序+「默认」首项）+ injectSession(model)（provisional 暂存/Codex 锁定）+ lib/daemon.ts 扩参 (depends_on: task-02,09)
- [ ] task-11: backend inject_session 扩 model（空串跟随配置；无供应商非空 422）+ 兜底模型快照级同步（R-07）+ config_snapshot.model 回填 + 测试 (depends_on: task-02)
- [ ] task-12: runtime-card by_provider 分组明细 + 计费口径 footnote + 测试（mock 增 by_provider）(depends_on: task-02,05)

## Wave 4 — 配置条级联（依赖 task-09 完成）

- [ ] task-13: 全链路自测（真实会话含子代理明细=run 四维；切模型 ANTHROPIC_MODEL 生效；用量卡窗口随动）(depends_on: task-01..12)
- [ ] task-14: 模块文档变更索引 + QUICKLOG 引用 (depends_on: task-13)
