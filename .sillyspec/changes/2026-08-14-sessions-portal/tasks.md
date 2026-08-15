---
author: WhaleFall
created_at: 2026-08-14 23:17:00
---

# 任务清单（Tasks）

> 骨架，plan 阶段展开为 Wave 分组与依赖关系。

- [ ] task-01: 后端模型+迁移：`AgentSession` 加 `agent_profile_id/llm_provider_id/config_snapshot`、`AgentRun` 加 `llm_provider_id`（agent/model.py + Alembic 迁移）
- [ ] task-02: 后端 DTO 具名化：`SessionCreateRequest`（runtime_id/provider 双入口 + agent_profile_id/llm_provider_id，去 model）/`SessionInjectRequest`（agent_profile_id/llm_provider_id）迁入 daemon/schema.py；`AgentSessionRead` 加配置字段（含 snapshot 摘要）
- [ ] task-03: 后端 create_session 接线：runtime_id→runtime→provider 校验在线；placement 加 runtime_id 钉定（跳过 first-online/fallback，Grill C-01）；档案解析只取 system_prompt+mcp/skill（会话专用非 commit 变体，D-013）；会话级供应商解析写 lease metadata `session_llm_provider_id`；快照落库（含 machine_name/agent_name）
- [ ] task-04: 后端 `_inject_provider_config` 会话级供应商最高优先级分支（两级：会话>全局默认，独立 metadata key 不碰 bound 链）+ 优先级单测 + 未传零回归测试
- [ ] task-05: 后端 inject_session 切换：配置变更校验（供应商 agent_kind+归属（借用场景），FR-06 4xx）→ 同事务先落新 AgentRun（新快照）+ 更新会话三列 → 下发 SESSION_SWITCH_CONFIG（原子 payload：profile(systemPrompt/mcp/skill)+providerConfig+prompt/run_id/claim_token）→ send 失败按既有 inject 收敛
- [ ] task-06: 后端会话列表扩展：GET /api/daemon/sessions 加 runtime_id/machine_id/provider/q 过滤 + 分页验证
- [ ] task-07: 后端供应商额度端点 GET /api/llm-providers/{id}/quota（一期 GLM；无数据返回 null；接口失败不阻塞）
- [ ] task-08: daemon 类型+热切换：SessionSwitchConfigPayload；markPendingConfigSwitch/reloadWithConfig（共用 _reloadSession 内核）；state/持久化补 config 快照
- [ ] task-09: daemon SESSION_SWITCH_CONFIG 消息处理（idle 立即/running 挂边界；喂 prompt；Codex 只切配置不注人格）
- [ ] task-10: 前端路由+菜单 3 处 + sessions/page.tsx 两栏骨架（新页面）
- [ ] task-11: 前端 SessionListPanel：筛选（引擎 tab/状态/机器多选/搜索回车）+ 虚拟滚动 + 紧凑两行条目（chips 读 snapshot）
- [ ] task-12: 前端 NewSessionForm：四选择器联动（默认机器 D-005、智能体默认 CC、供应商引擎锁定、档案过滤）+ 开始会话
- [ ] task-13: 前端 InteractiveSessionPanel 抽共享子组件（TurnTimeline/SessionInputBar），弹窗零回归
- [ ] task-14: 前端 SessionConfigBar（样式 B 输入框下四控件 + 切换下拉 + running 置灰）+ 消息 who 行轮次快照渲染
- [ ] task-15: 前端 CtxUsageBar：上下文用量环（usage 累计；分母=供应商配置派生 1M→模型常量表→只显示累计，D-014；变色、详情）+ QuotaPill（供应商 quota 联动，null 不显示）
- [ ] task-16: 前端 client 扩展：createSession/injectSession/listAgentSessions 新参数；类型迁 api-types 生成版
- [ ] task-17: `pnpm gen:types` 同步提交（api-types.ts + openapi.json，规则 20）
- [ ] task-18: 测试收口：后端（优先级矩阵/切换校验/列表过滤/零回归）+ daemon（reload resume+新配置/pending 边界）+ 前端（联动/切换/who 行/列表）；npm test + lint 全绿
