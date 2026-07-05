---
plan_level: full
author: WhaleFall
created_at: 2026-07-01 11:55:00
---

# 实现计划：spec-workspace import 异步化（SSE）+ 变更中心补 change reparse

## Spike 前置验证
| Spike | 验证内容 | 不通过后果 |
|---|---|---|
| spike-01 | reparse changes 1100 文件实测耗时（design 假设 ~10s） | 若 >50s，task-03 SSE 需考虑 changes reparse 后台化或 WS RPC timeout 不足 |
| spike-02 | Next.js rewrite proxy 对 SSE 长连接 + keepalive 心跳是否不断连 | 若仍断连，task-03 心跳策略需调整（间隔/内容） |

> 两个 Spike 在 task-02/task-03 执行时顺手实测，不单列 Wave。

## Wave 1（并行，无依赖）
- [ ] task-01: daemon 撤 ql-003 的 get_spec_bundle excludeNames changes（覆盖：FR-02, D-002）
- [ ] task-02: backend apply_sync 拆分——apply(写盘)/reparse_docs/reparse_changes 三步各自容错(dirty)，返回各段 parsed（覆盖：FR-01, FR-05, D-003）

## Wave 2（依赖 Wave 1）
- [ ] task-03: backend import_from_repo 改 SSE 流式（分阶段事件 packing/packed/applying/reparsing_docs/reparsing_changes/done/error + packing 心跳保活）；sync 端点 DTO 加 reparsed_changes（覆盖：FR-03, FR-04, FR-06, D-001）

## Wave 3（依赖 Wave 2）
- [ ] task-04: frontend importSpecWorkspace 改流式 fetch 读 SSE + workspace 详情页 import 阶段进度 UI + done 刷新变更中心（覆盖：FR-07）

## Wave 4（依赖 Wave 1-3）
- [ ] task-05: 端到端验收测试 + 部署（daemon bundle + rebuild backend；spec_workspace/change 模块测试；daemon vitest；ruff/format/mypy/typecheck）（覆盖：AC-01~06）

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | daemon 撤 excludeNames changes | W1 | P0 | — | FR-02, D-002 | get_spec_bundle 仅保留 excludeRuntime；packSpecDir excludeNames 选项保留(通用) |
| task-02 | apply_sync 拆分加 change reparse | W1 | P0 | — | FR-01, FR-05, D-003 | 拆 apply/reparse_docs/reparse_changes 三段；ChangeService.reparse 失败 dirty 不阻断 |
| task-03 | import 改 SSE + sync DTO | W2 | P0 | task-02 | FR-03, FR-04, FR-06, D-001 | StreamingResponse event-stream；packing 心跳；error 事件透传 ql-001 错误码 |
| task-04 | frontend 流式 import + 进度 | W3 | P0 | task-03 | FR-07 | 绕过 apiFetch 原生 fetch+ReadableStream；done 刷新变更中心 |
| task-05 | 验收测试 + 部署 | W4 | P0 | task-01~04 | AC-01~06 | bundle+rebuild backend；用户重启 daemon；全栈测试 |

## 关键路径
task-02 → task-03 → task-04 → task-05（apply_sync 拆分是 SSE 分阶段的前提；SSE 契约是前端流式的前提）

## 全局验收标准
- [ ] spec_workspace 全模块 + change 模块测试通过（含新增 SSE import 测试）
- [ ] sillyhub-daemon vitest 通过（packSpecDir 含 changes）
- [ ] backend ruff/format/mypy 通过；frontend typecheck/lint 通过
- [ ] (brownfield) sync 端点行为兼容（DTO 加字段不删）
- [ ] daemon-client workspace 导入后变更中心显示 changes（AC-01）
- [ ] import 全程 SSE 无 proxy 500（AC-02）

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001 (import 改 SSE) | task-03 | AC-02 |
| D-002 (撤 ql-003 changes) | task-01 | AC-01 |
| D-003 (两阶段 reparse 容错) | task-02 | AC-04 |
| D-004 (daemon 不流式) | task-03 | AC-02 (packing 阶段占位) |
| FR-01 (变更中心显 changes) | task-02 | AC-01, AC-05 |
| FR-02 (恢复 changes 导入) | task-01 | AC-01 |
| FR-03 (SSE 流式) | task-03 | AC-02 |
| FR-04 (心跳保活) | task-03 | AC-02 |
| FR-05 (apply_sync 容错) | task-02 | AC-04 |
| FR-06 (sync 一致) | task-03 | AC-05 |
| FR-07 (前端流式) | task-04 | AC-01, AC-02 |
