---
author: qinyi
created_at: 2026-09-04 14:25:00
---
# 验证报告

## 结论
PASS

## 任务完成度
7/7 任务完成（tasks.md 全勾），逐任务 review 双 pass（execute-runs/exec-2026-09-04-114710）。execute 14/14 + 独立 QA 验收 pass（execute-review-2026-09-04-140905，10 checklist 全 pass：跨 task 交界/design 对照/组装行为三项必查+DB 抽查与 smoke 逐字一致）。worktree apply 三方合入完成（onboarding.md 冲突取主仓终版），主仓提交 4e2d7be98 已推送。

## 设计一致性（决策覆盖：D-001@v1 RPC 长驻架构全命令面落地；D-002@v1 桥接+如实标记——8 caps 三态结论与实证一致，subagent 终值 false 守先实现后翻值纪律）
design v2（双轮 Grill pass）全部要点在代码可指认（验收审查逐条核过）：LfLineFramer 严格分帧/get_state 合成 session_started/inject 三模式降级链（锚定 pi 错误文案）/agent_settled 四级收敛+事件计数守卫/ui_request 自动取消/resume --session 链路（design 笔误实证修正）/四承诺区零改动（git diff name-only 核实，唯一 backend 触碰是 F-1 白名单一行）。caps 三端与 design §5.3 一致：4 true + 4 false（subagent 终值 false，task-06 真机实证聚合型无归属，D-002 纪律）。

## 探针结果
- 已接受偏差 7 项全有登记载体（验收审查差异登记）；主仓 WIP commit 12bdd549b 与 worktree 的 onboarding 双写已由三方合并解决（取终版）。
- 零 DB 迁移、零 OpenAPI 变化核实（改动集不含 migration/openapi.json）。

## 测试结果（主仓合入后实跑，2026-09-04 14:15-15:15）

**CLI 实测对账 flaky 说明（如实记录）**：CLI 首次实测（20260904070405，421s，module 策略命中 frontend+sillyhub-daemon+daemon+agent）backend 1233 passed 但 daemon 段 2 用例挂 waitForSpy 3000ms 超时判 failed。排查：涉事 3 文件（daemon-kind-dispatch/skill-manager/integration/worker-resume——均非本变更 touched 文件）**单跑 48/48 全过**；daemon 全量**复跑 194 文件/3484 用例 0 失败全过**。结论：既有测试基建在全量并发资源竞争下的 flaky（waitForSpy 超时窗不足，vitest.config 已有并发说明注释），非本变更回归。
- sillyhub-daemon：vitest tests/interactive/ + agent-event-schema → **55 文件 792 用例全过** + tsc 零错
- backend：对齐+session_provider_caps → **20 passed**
- frontend：pre-session-picker → **20 passed** + tsc 零错
- 真机冒烟 10/10 PASS（详见 Runtime Evidence）

## 变更风险等级
integration-critical（daemon/session 关键词命中）

## Runtime Evidence（实跑证据）

### 〔unit_tests〕单元测试
上节 792+20+20 全过（合入后主仓集成态）。

### 〔contract_tests〕契约测试
agent-event-schema 21 例（zod↔类型一致）；caps 三端源文件读取守护 4 例（含 pi 键集）；provider-registry 6 例（键集 canary/family=pi_json 反查/实例化）；session-store-persistence F-2 回归用例（pi 记录载入保留）。

### 〔real_daemon_backend_integration〕daemon↔backend 真实集成（真机全链路）
smoke-result.md（.sillyspec/changes/2026-09-04-provider-pi-onboarding/）10 项全 PASS：创建 pi 会话（Bash 真执行 pi-smoke-e2e）→双轨落库（44 行/43 带 metadata.agent_event，text39/tool_use2/tool_result1/thinking1）→partial 流式（10s 窗 36 事件实时）→usage 实时（34 tokens 事件，66→72 与终值一致）→inject 追加→interrupt（数数截断 9/50 精确）→resume（daemon 重启恢复+记忆连续，答出首轮 echo 输出）→thinking 落库→claude 回归（62218/421 tokens 正常）→subagent 复核（真机 spawn+聚合实证，caps=false 结论一致）。DB 证据由独立验收审查 psql 复查逐字一致。

### 〔real_startup_once〕真实启动验证
冒烟期间 worktree 构建 daemon（含 PiRpcDriver）真实运行并注册（pi/claude runtime 心跳 fresh），完成全部 10 项真机会话后恢复正式版。正式 bundle 升级部署属本报告后动作（见交付收尾）。

### 〔runtime_log_evidence〕日志片段（冒烟实录摘录）
```
[daemon.session_resume_ok] session_id=29711587…（pi 会话重启恢复成功）
run a0593330: completed/exit 0, [TOOL_RESULT] pi-smoke-e2e（真实 Bash 输出）
interrupt 轮: 截断于 9/50，session 保持 active，run 收敛 completed
DB: SELECT count(*) FROM agent_run_logs WHERE run_id='a0593330' AND metadata->'agent_event' IS NOT NULL → 43/44
```
完整证据链见 smoke-result.md。

### 遗留与披露
- F-1 backend Literal 修复缺直接回归用例（验收审查建议，P3）——档B 文档已把三处白名单列为必改点，后续 provider 接入会立即暴露。
- F-3/F-4 P3 观察（interrupted run 无 cancelled 标记/轮中 usage 为上一快照——pi 协议 turn_end 才报）如实记录在 smoke-result。
- 群聊两处引擎白名单未加 pi（design §5.4 明示后续）；canResumeSession 硬编码（task-05 遗留记录）。
- 空态文案「需要 Claude Code 或 Codex 在线」未提 Pi（P3 文案，后续顺手改）。
