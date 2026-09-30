---
plan_level: full
execution_mode: main  # dispatch=子代理派发（判据见执行模式声明）；本变更任务串行依赖链长（协议→匹配→takeover→前端），直写缺省更优
---

# 实现计划（Plan）

## Wave 1（并行，无依赖）
- task-01
- task-02

## Wave 2（依赖 Wave 1）
- task-03

## Wave 3（依赖 Wave 2）
- task-04

## Wave 4（依赖 Wave 3）
- task-05

## Wave 5（依赖 Wave 4）
- task-06

## Wave 6（依赖 Wave 5）
- task-07

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | platform_agent_logs 机器身份两列 + alembic 迁移 | W1 | P0 | — | FR-01, D-001@v1 | AgentSessionLogORM 加 reported_machine_id/name + 迁移 + 模型单测 |
| task-02 | daemon 心跳 machine_id 上报与落 metadata | W1 | P1 | — | FR-01, D-001@v1 | daemon.ts/hub-client.ts 心跳附 machine_id（~/.sillyhub/machine-id 读/生成）+ heartbeat.py 落 daemon_runtimes.metadata |
| task-03 | 上报协议 v2 machine 块接收落库 + 聚合 + 协议文档 | W2 | P0 | task-01 | FR-01, D-001@v1 | schema DTO machine 块、upsert 落列、config_snapshot.latest_reported_machine、协议文档新建 |
| task-04 | takeover 服务核心：四级匹配 + fork 分叉落库 + native resume + 端点 | W3 | P0 | task-03 | FR-02, FR-03, D-002@v1, D-006@v1 | takeover.py（resolve_takeover_runtime 四级 + create 链 fork 三件套可空 + resume_session_id）+ DTO + 路由 + test_takeover.py 核心 |
| task-05 | handoff 档：交接文档 + RPC 读 + 引擎/档案重选 + 降级 | W4 | P0 | task-04 | FR-04, D-004@v1, D-005@v2 | build_handoff_prompt 模板帽、read_agent_log_messages RPC 复用、provider∈原机校验 422、handoff_doc=false 降级 + 独立测试文件 |
| task-06 | 懒激活退役 + reset-tool-report 端点 | W5 | P0 | task-04 | FR-02, FR-05, D-003@v1 | inject 对 pending tool_report 409 指引、删 _activate_tool_report_session、reset 端点（守卫+回滚+事件）+ 既有用例改写 |
| task-07 | 前端衔接状态全量 + gen:types | W6 | P0 | task-04, task-05, task-06 | FR-06, D-002@v1, D-005@v2, D-006@v1 | 提示条/接手选择器/takeover 发送切会话/原机离线态/重置按钮 + takeover.ts + api-types 生成 + 组件测试 |

## 关键路径
task-01 → task-03 → task-04 → task-05 → task-07（最长依赖链，决定最短交付周期）

## 全局硬约束（从 design.md 逐字抄录，绑定所有 task）
- 错误文案一律中文（含机器名与"开机/装 daemon"指引）
- 派发 MUST NOT 静默换机（四级无果 409，宁拒不猜）；源会话任何路径 MUST NOT 写 active/lease/runtime
- 老 CLI 上报（无 machine 块）行为不变：extra=ignore 落 NULL，上报幂等语义不变
- 不改变既有 fork 端点（POST /sessions/{id}/fork）行为——takeover 复用内部函数不改签名语义
- 不做：CLI 仓 machineId 改造、交接文档 LLM 总结、chat 会话换机、zcode adapter
- agent_sessions 不加列（机器匹配走 config_snapshot.latest_reported_machine + 最新 entry 兜底）；daemon_runtimes.metadata 增键 machine_id 无需迁移
- 兼容 Windows/Linux/macOS（路径处理沿用既有口径）

## 全局验收标准
1. 所有单元测试通过（backend: uv run pytest 相关目录；frontend: pnpm test 相关文件；daemon: pnpm test 相关）
2. 路由/跨层装配（takeover/reset 端点、daemon 心跳、前端切会话）建议集成冒烟验收
3. brownfield：老 CLI 上报、旧前端 inject（409 指引）、存量已激活会话三条回退路径行为符合 design 兼容策略

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-02, task-03, task-04 | FR-01 协议落库 + FR-03 四级匹配 |
| D-002@v1 | task-04, task-07 | 409 不换机 + 前端离线态 |
| D-003@v1 | task-06 | reset 端点+回滚守卫 |
| D-004@v1 | task-04, task-05 | native resume / handoff 交接分档 |
| D-005@v2 | task-05, task-07 | 引擎/档案重选（takeover 载体）+ 选择器 |
| D-006@v1 | task-04, task-06, task-07 | 分叉式接手 + 激活退役 + 溯源 UI |
