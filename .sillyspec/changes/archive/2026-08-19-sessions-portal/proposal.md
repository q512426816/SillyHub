---
author: WhaleFall
created_at: 2026-08-14 23:15:00
---

# 提案书（Proposal）— 智能体会话总入口页面（/sessions）

## 动机

交互式会话目前唯一入口埋在 `/runtimes` 运维页的 runtime 卡片弹窗里：没有跨机器/跨智能体的统一会话视图；「智能体提供方/智能体模型」字段是摆设（backend 默认供应商覆盖，中途不可改）；机器/供应商/档案不随会话持久化。平台已具备机器心跳、runtime=智能体、用户供应商、跨工作区档案、system_prompt 注入管道、daemon 热切换内核等全部底座，缺一个把能力串起来的**会话总入口**。

## 关键问题

1. **无总入口**：开会话要先在运维页找机器→展开→找 runtime→点会话；历史会话分散在各 runtime 弹窗里。
2. **配置不生效/不持久**：会话 UI 字段对 LLM 调用不起作用；每会话没有自己的机器/智能体/供应商/档案配置，更不能中途切换。
3. **档案与会话割裂**：档案注入管道已通（change 流程在用）但会话路径没接（继承自停用变更 2026-08-14-runtime-session-agent-profile-link 的问题意识）。

## 变更范围（概要）

- **后端**：`agent_sessions` 加 `agent_profile_id/llm_provider_id/config_snapshot` 列（+迁移）；会话创建/注入 DTO 具名化并加 `runtime_id/agent_profile_id/llm_provider_id`；会话级供应商优先级插入 `_inject_provider_config`；切换走 `SESSION_SWITCH_CONFIG` 原子 WS 消息；会话列表 API 加过滤；供应商额度查询（弱依赖，一期 GLM）。
- **daemon**：`reloadWithConfig` 统一热切换（与 `reloadWithProvider` 共用内核）+ `pendingConfigSwitch` 轮次边界挂起 + 配置快照持久化。
- **前端**：新 `/sessions` 页面（左=所有会话列表虚拟滚动+筛选，右=新建会话四选择器 / 交互式会话）；样式 B 配置控件条（输入框下）热切换；消息 who 行每轮配置快照；输入框上方上下文用量环+供应商额度胶囊；侧边栏一级菜单。

## 不在范围内（显式清单）

- 跨机器/跨引擎的会话内切换（二期，UI 置灰展示）。
- Codex 人格提示词注入（引擎/凭证/模型跟随，人格不注入）。
- /runtimes 会话弹窗改造（保留并存，零回归）。
- 批量 / `--print` 模式注入；多供应商额度聚合看板。

## 成功标准（可验证）

- 新页面能新建会话（四选择器联动正确）、列出所有会话（筛选/搜索/虚拟滚动）、续聊历史会话。
- 会话独立持有配置：同用户两个会话可用不同机器/智能体/供应商/档案，互不影响。
- idle 时切换档案/供应商：历史无缝保留（resume 重载）、新配置下一轮生效、历史消息 who 行不变、其它会话不受影响。
- 未选供应商/档案 + /runtimes 弹窗：行为与现状完全一致（零回归）。
- 后端/daemon/前端测试全绿；`pnpm gen:types` 产物同步提交。
