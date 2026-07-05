---
id: task-04
title: backend run_sync 双路径落库 + 两处 publish payload 加 tool_kind
author: qinyi
created_at: 2026-07-05 10:05:43
priority: P0
depends_on: [task-01, task-02]
blocks: [task-09]
requirement_ids: [FR-04, FR-05, FR-06]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/daemon/run_sync/service.py
goal: backend 双路径（interactive _extract_sdk_messages + batch submit_messages）落库填 tool_kind + 两处 publish payload 带 tool_kind
implementation: _extract_sdk_messages(1081-1137) btype=tool_use 调 classify_tool_kind 打标(FR-04)；submit_messages(282-398) msg.get优先+JSON.parse兜底(FR-05)；published_logs(400+)+session_payload(147-154)两处加 tool_kind(FR-06)
acceptance: interactive 路径打标；batch 兜底（msg无+JSON.parse）；两处 publish 含 tool_kind；stdout 文本行 NULL；零回归
verify: cd backend && uv run pytest tests/modules/daemon/run_sync/ -v；task-09 集成测试覆盖
constraints: R-02 interactive 漏标（双兜底）；R-08 publish 两处漏字段；仅 run_sync 落库点(381)传 tool_kind，user_input 构造点不改
provides:
  - contract: AgentRunLog 落库
    fields: [tool_kind]
  - contract: published_logs_payload
    fields: [tool_kind]
expects_from:
  task-01:
    - contract: AgentRunLogEntry
      needs: [tool_kind]
  task-02:
    - contract: classify_tool_kind
      needs: [TOOL_KIND_VALUES, classify_tool_kind]
---

# task-04 · backend run_sync 双路径落库 + publish

## goal

backend 双路径落库填 `tool_kind`（interactive `_extract_sdk_messages` 主路径 + batch `submit_messages` 兜底）+ 两处 publish payload 加 `tool_kind`，让 DB 列与 SSE 实时流都带标签。覆盖 design §5 Phase 2（含 C-01/02/03 Grill 修正）、FR-04/05/06。

## implementation

1. **interactive 主路径（FR-04）**：`run_sync/service.py:_extract_sdk_messages`（1081-1137）的 `btype==="tool_use"` 分支，从 SDK block 的 `name` + `input` 调 `classify_tool_kind`（task-02）识别，生成 tool_call 记录时填 `tool_kind`。
2. **batch 兜底（FR-05）**：`submit_messages`（282-398）落库构造 `AgentRunLog(...)`（381）时 `tool_kind=msg.get("tool_kind")` 优先（新 daemon 已带）；缺则仅对 `channel='tool_call'` 行 `JSON.parse(content)` 取 tool/args 调 `classify_tool_kind` 兜底；stdout 文本行不兜底（tool_kind=NULL）。
3. **两处 publish payload（FR-06，R-08）**：`published_logs.append`（400+）dict 加 `"tool_kind": <值>`；`session_payload`（147-154）dict 加 `"tool_kind": <值>`。

## 验收标准

- [ ] interactive 路径（btype=tool_use）tool_kind 正确识别填列
- [ ] batch 路径：msg 带 tool_kind 时优先用；缺则 JSON.parse 兜底（仅 tool_call 行）
- [ ] `published_logs` + `session_payload` 两处 payload dict 都含 `tool_kind`（R-08）
- [ ] stdout `[TOOL_USE]` 文本行 tool_kind=NULL（C-02）
- [ ] 现有去重/usage/thinking override 逻辑零回归

## verify

- `cd backend && uv run pytest tests/modules/daemon/run_sync/ -v`
- task-09 集成测试覆盖（迁移 + 落库 + publish + API）

## constraints

- **R-02 interactive 漏标**：双兜底应对（daemon task-06 + backend 本任务）。
- **R-08 publish 漏字段**：两处都要加（design §6 点明）。
- 仅 `run_sync/service.py:381` 落库点传 tool_kind；user_input 构造点（agent/service.py:618、daemon/session/service.py:403/589）不改。
- 兜底 JSON.parse 失败时静默退 NULL（不抛错）。
