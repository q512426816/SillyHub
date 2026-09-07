---
plan_level: full
author: qinyi
created_at: 2026-09-07 13:33:00
---

# 实现计划（Plan）— Agent 会话活性状态推导

## Spike 前置验证

| Spike | 验证内容 | 不通过后果 | 结果（2026-09-07 实证） |
|---|---|---|---|
| spike-01 | 实调 mission/worker 状态上报链路：daemon 推导结果汇入 `list_workers` 的最佳注入点（`backend/app/modules/agent/orchestrator.py` / `mission_context.py` / `mcp_tools.py` 实读 + worker 状态上报 DTO 定位） | task-12 降级为 backend 直查 `platform_agent_logs` 最新状态（design R-03 既定降级路径，不推翻设计） | **直查即正道**：`_list_workers_core`（mcp_tools.py:1555）是纯 DB 函数；`platform_agent_logs.agent_session_id` 已建索引（model.py:229），worker 子会话 id 直查落库状态即可，无需 daemon→mission 链路改造——task-12 按直查实现 |
| spike-02 | E-01 十分钟实证：本机裸跑 claude CLI 制造一次 permission 等待，逐行查 transcript 尾部是否记录等待事件 | task-11 的 blocked 分支关闭（deriver 只保留 working/idle 规则并回写结论；FR-04 既定证伪处置，D-002@v1） | **证伪**（2026-09-07 扫描 160 个最近 transcript）：顶层记录类型清单（assistant/user/attachment/queue-operation/last-prompt/mode/ai-title/file-history-snapshot/system/permission-mode/file-history-delta）无"等待审批"事件类型——`permission-mode` 仅模式切换；零审批结果/拒绝记录，关键词命中均为对话内容。裸 claude 等人瞬间不落 transcript（与 zcode E-03 同构）→ task-11 blocked 分支关闭，日志推导 blocked 全线定稿为不承诺 |

## Wave 1（并行，无依赖）
- task-01
- task-07

## Wave 2（依赖 Wave 1）
- task-02
- task-03
- task-04
- task-08

## Wave 3（依赖 Wave 2）
- task-05
- task-06
- task-09
- task-10

## Wave 4（依赖 Wave 3）
- task-11
- task-12
- task-14

## Wave 5（依赖 Wave 4）
- task-13

## Wave 6（依赖 Wave 5）
- task-15

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | daemon liveness 基座（types + registry） | W1 | P0 | — | FR-01, D-003@v1 | LivenessState/DeriverInput/Output 类型 + format→deriver 注册表（仿 parser 扩展点模式） |
| task-02 | zcode deriver + fixtures | W2 | P0 | task-01 | FR-01 | E-03 实证规则；与 task-10/11 分 Wave（共用 registry.ts 注册行） |
| task-03 | tailer 循环 | W2 | P0 | task-01 | FR-01 | offset 差量读/reset/ended 回收/watch≤16/4MB 预算/R-02 fail-open |
| task-04 | 自发现最小版（直算路径） | W2 | P0 | task-01 | FR-02 | spawn 记录 + sessions.json 恢复 + 窗口重扫兜底；claude/pi 直算 |
| task-05 | 自发现窄扫（codex/zcode） | W3 | P1 | task-04 | FR-02 | uuid 文件名/共享 rollout 目录窄扫 + 标记匹配 + cwd 防串台 |
| task-06 | hub-client 批量上报 + 第一方 blocked 并入 + daemon 挂接 | W3 | P0 | task-02,03,04 | FR-01, FR-03, FR-04 | 三职：POST /states 接线；GET /agent-logs 周期拉登记行（watch list 增强源）；推送时按 D-012 优先级并入 PERMISSION_REQUEST pending 作 blocked 主源（zcode/codex 不产 blocked，此为唯一 blocked 供给路径之一）；daemon.ts 生命周期挂接（独立 try） |
| task-07 | backend 四列迁移 + ORM/schema | W1 | P0 | — | FR-03 | alembic（state/state_derived_at/state_evidence/last_event_at） |
| task-08 | states 端点（upsert-create + 转移检测） | W2 | P0 | task-07 | FR-03 | origin=liveness-discovered；blocked 段时间戳；GET 透传四字段 |
| task-09 | Notification agent_blocked | W3 | P0 | task-08 | FR-04 | 120s 阈值/段级 dedupe/与 5min auto-deny 同源分级/Redis 推 |
| task-10 | codex deriver | W3 | P1 | task-01 | FR-01 | E-02 词汇表规则（task_complete/function_call 配对/token_count） |
| task-11 | claude deriver（spike-02/E-01 门控） | W4 | P1 | task-01, spike-02 | FR-04, D-002@v1 | 证伪则只保留 working/idle 并回写结论 |
| task-12 | list_workers liveness 字段（spike-01 定汇入点） | W4 | P0 | task-08, spike-01 | FR-06 | 汇入链路过重则降级 backend 直查落库状态（R-03） |
| task-13 | sillyspec 派发模板改写（跨仓 repo:sillyspec） | W5 | P0 | task-12 | FR-06 | 终态轮询+kill lease 段升级：blocked→升级不 kill / working→再等 |
| task-14 | 前端两层展示（D-004） | W4 | P0 | task-08 | FR-05, D-004@v1 | 列表小灯+悬浮卡/工作台总览卡片/面板徽章/idle 小红点/通知渲染 + pnpm gen:types |
| task-15 | 集成验收 | W6 | P0 | task-05~14 全部 | FR-01~06 | 10s 可见性/裸会话自发现/R-01 空闲无通知/R-02 崩溃隔离/E-03 轮转恢复/长任务不抢跑 |

## 关键路径

task-07 → task-08 → task-12 → task-13 → task-15（backend 落库→编排消费→跨仓模板→集成验收，5 个 Wave 决定最短交付周期；daemon 侧 01→02→06 为次长路径）

## 全局验收标准

1. daemon：liveness 模块单测全绿（每 deriver fixture + tailer 轮转/预算/fail-open）；既有 agent-log 解析与登记链路测试零回归
2. backend：platform_sync/notification/agent 模块相关测试全绿；alembic 迁移可升可回滚；旧落库行显示 unknown
3. 前端：pnpm gen:types 通过且 api-types.ts 与 openapi.json 同步提交；双主题下徽章/小灯/悬浮卡/总览卡片渲染正常（对照 prototype-agent-liveness-states.html）
4. 集成（task-15）：zcode 会话派发后 10s 内出状态；裸 agent 会话同样 10s 内出状态；空闲会话不产生 blocked 通知；tailer 崩溃不影响既有链路；worker 卡确认→list_workers 见 blocked 且升级非 kill；长任务不被抢跑
5. （brownfield）CLI 上报契约零变更；未部署 daemon 新版本时平台显示 unknown，既有功能不变

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1（P1 全量 a–e） | task-01~15 全部 | 全局验收标准 1-4 |
| D-002@v1（E-01 纳入） | task-11, spike-02 | spike-02 结论回写；证伪处置路径明确 |
| D-003@v1（方案 1） | task-01~06, task-09 | daemon 自发现+日志推导+第一方汇聚架构落地 |
| D-004@v1（两层展示） | task-14 | 全局验收标准 3；原型对照 |
| FR-01 | task-01,02,03,10,11 | deriver fixtures + tailer 单测 |
| FR-02 | task-04,05 | 裸会话 10s 出状态（验收 4） |
| FR-03 | task-06,07,08 | upsert-create + GET 透传测试 |
| FR-04 | task-06,09,11 | R-01 回归（空闲无 blocked 通知）；第一方源并入（D-012） |
| FR-05 | task-14 | gen:types + 双主题渲染 |
| FR-06 | task-12,13 | blocked 升级非 kill / 长任务不抢跑 |
