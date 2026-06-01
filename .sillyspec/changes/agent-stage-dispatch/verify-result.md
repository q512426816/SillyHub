---
author: claude-verify-agent
created_at: 2026-06-01 09:45:00
---

# Verification Report: Agent Stage Dispatch

## Verdict: NEEDS_ATTENTION

总体判定：**有条件通过**。核心功能实现完整、新测试全部通过（149/149），但存在 1 个回归缺陷需要修复。

---

## 1. Checks Performed

| # | Check | Result | Details |
|---|-------|--------|---------|
| 1 | 代码质量审查 | ✅ PASS | 10 个核心文件审查完成，代码结构清晰，注释充分 |
| 2 | 测试通过率 | ⚠️ NEEDS_ATTENTION | 837 passed / 6 failed / 12 errors |
| 3 | 新增测试覆盖 | ✅ PASS | 149 个 agent-stage-dispatch 专属测试全部通过 |
| 4 | 前端一致性 | ✅ PASS | TypeScript 编译通过，TransitionResponse 类型对齐 |
| 5 | 安全审查 | ⚠️ NEEDS_ATTENTION | 发现 3 个 Medium 级已知问题（path traversal / race condition），无 Critical 阻塞项 |
| 6 | 设计一致性 | ✅ PASS | 7 Phase / 22 Task 全部实现，design.md 与代码一致 |
| 7 | 文档完整性 | ✅ PASS | design.md、plan.md、TASKS.md 齐全 |

---

## 2. Test Results

### 全量测试结果

```
837 passed, 6 failed, 12 errors (76.88s)
```

### 新增测试（全部通过）

| 测试文件 | 数量 | 说明 |
|----------|------|------|
| `tests/modules/change/test_dispatch.py` | 26+ | dispatch 核心逻辑 |
| `tests/modules/agent/test_stage_dispatch.py` | 15+ | bundle 构造 + adapter |
| `tests/modules/agent/test_spec_bundle_stage_dispatch.py` | 6 | adapter 集成 |
| `tests/modules/change/test_auto_dispatch.py` | 3 | auto-dispatch chain |
| `tests/modules/change/test_router_transition.py` | 5+ | TransitionResponse 格式 |
| `tests/modules/change_writer/test_router.py` | 3 | change_writer 路由 |
| `tests/modules/change/test_e2e_stage_dispatch.py` | 1+ | 端到端链路 |
| **Total** | **149** | **全部通过** |

### 失败测试分析

| 失败文件 | 数量 | 根因 | 是否本次变更导致 |
|----------|------|------|-----------------|
| `workflow/tests/test_router.py` | 6 | 请求体字段名 `target` → `target_stage` 不匹配 | **是** |
| `task/tests/test_router.py` | 12 | UNIQUE constraint fixture 隔离问题 | 否（已有问题） |

---

## 3. Issues Found

### 🔴 Issue #1: workflow test_router 回归（HIGH）

**文件**: `backend/app/modules/workflow/tests/test_router.py`
**原因**: `TransitionRequest` schema 字段名从 `target` 改为 `target_stage`，但旧测试仍发送 `{"target": "proposed"}`
**影响**: 6 个测试返回 422（Unprocessable Entity）
**修复**: 更新测试中的请求 JSON key 从 `"target"` 改为 `"target_stage"`

```python
# 旧 (line 94)
json={"target": "proposed"}
# 新
json={"target_stage": "proposed"}
```

### 🟡 Issue #2: Path traversal 风险（MEDIUM）

**文件**: `backend/app/modules/agent/service.py:95`
**说明**: `resolve_work_dir()` 未验证 `change.path` 解析后是否在 workspace root 内
**建议**: 添加 `resolved_path.resolve().is_relative_to(ws_root.resolve())` 检查

### 🟡 Issue #3: 竞态窗口（MEDIUM）

**文件**: `backend/app/modules/change/dispatch.py:257-264`
**说明**: `has_active_run()` 检查与 `dispatch()` 之间存在时间窗口，理论上可重复调度
**缓解**: 已有 chain limit（10次）防护，实际风险低
**建议**: 考虑数据库级 advisory lock

### ℹ️ Issue #4: unawaited coroutine 警告（LOW）

**文件**: `backend/app/modules/agent/service.py:936`
**说明**: `RuntimeWarning: coroutine 'AsyncMockMixin._execute_mock_call' was never awaited`
**影响**: 仅在 mock 环境中出现，不影响生产
**建议**: 检查 `_execute_stage_run` 中的异常处理路径，确保所有 await 正确

---

## 4. Implementation Completeness

### Wave 完成度

| Wave | Task Range | 状态 | 说明 |
|------|-----------|------|------|
| W1 | task-01/02/03 | ✅ 完成 | 废弃标记、bundle 扩展、阶段配置补齐 |
| W2 | task-04/05/06 | ✅ 完成 | CLAUDE.md 修复、build_stage_bundle、adapter prompt |
| W3 | task-07/08 | ✅ 完成 | SillySpecStageDispatchService、change_writer 迁移 |
| W4 | task-09/10/11/12 | ✅ 完成 | sync_stage_status、auto_dispatch、read_only 修复、work_dir 策略 |
| W5 | task-13/14/15/16 | ✅ 完成 | TransitionResponse schema、router、前端类型、步骤进度组件 |
| W6 | task-17-22 | ✅ 完成 | 全量测试覆盖（149 tests passed） |

### Design 一致性

| Design Phase | 实现文件 | 一致 |
|-------------|---------|------|
| P1: 统一调度入口 | dispatch.py, coordinator.py | ✅ |
| P2: Agent prompt 修复 | base.py, claude_code.py, context_builder.py | ✅ |
| P3: 阶段配置补齐 | dispatch.py STAGE_AGENT_CONFIG | ✅ 8 阶段全覆盖 |
| P4: 状态同步 | dispatch.py sync_stage_status | ✅ |
| P5: 工作区策略 | service.py resolve_work_dir | ✅ |
| P6: API 前端契约 | schema.py, router.py, changes.ts | ✅ |
| P7: 测试闭环 | tests/ 目录 7 个文件 | ✅ |

### 验收标准对照

| 标准 | 状态 | 说明 |
|------|------|------|
| Agent prompt 包含 `sillyspec run <stage> --change <key>` | ✅ | `_build_stage_dispatch_prompt` 已实现 |
| STAGE_AGENT_CONFIG 覆盖全部 8 个阶段 | ✅ | scan/brainstorm/propose/plan/execute/verify/archive/quick |
| `start_sillyspec_run` 无新调用 | ✅ | 仅保留 deprecated 方法体 |
| sillyspec.db 同步当前步骤状态 | ✅ | `sync_stage_status` 实现 |
| 前端 TransitionResponse 类型 | ✅ | TypeScript 编译通过 |
| pytest 全部通过 | ⚠️ | 新测试全通过，6 个旧测试需更新 |
| draft → propose → plan 链路端到端 | ✅ | test_e2e_stage_dispatch 通过 |

---

## 5. Recommendations

1. **立即修复**: 更新 `workflow/tests/test_router.py` 中的 `{"target": ...}` 为 `{"target_stage": ...}`，消除 6 个测试失败
2. **后续优化**: 在 `resolve_work_dir` 中添加 path containment 检查
3. **后续优化**: 考虑 database advisory lock 防止 dispatch 竞态
4. **后续优化**: 统一 `datetime.utcnow()` 为 `datetime.now(timezone.utc)`（全项目范围）

---

## 6. Risk Assessment

| 维度 | 评级 | 说明 |
|------|------|------|
| 功能完整性 | 🟢 低风险 | 22 个 Task 全部实现，design 一致 |
| 测试覆盖 | 🟢 低风险 | 149 个新测试全部通过 |
| 回归影响 | 🟡 中风险 | 6 个旧测试因字段名变更失败，需修复 |
| 安全性 | 🟡 中风险 | path traversal 和 race condition 需后续加固 |
| 性能 | 🟢 低风险 | 无 N+1 查询，chain limit 防止无限循环 |

**Overall Risk**: 🟡 **MEDIUM** — 修复 Issue #1 后可降至 LOW

---

## Conclusion

Agent Stage Dispatch 的核心实现**质量良好**，7 Phase / 22 Task 全部完成，149 个新测试全部通过。主要问题是 `workflow/tests/test_router.py` 中 6 个旧测试未同步更新字段名（`target` → `target_stage`），这是一个明确的回归问题。

**建议**: 修复 Issue #1 后即可进入 business review。
