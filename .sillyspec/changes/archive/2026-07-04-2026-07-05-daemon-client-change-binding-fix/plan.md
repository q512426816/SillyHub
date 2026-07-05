---
author: qinyi
created_at: 2026-07-05 00:51:15
change: 2026-07-05-daemon-client-change-binding-fix
stage: plan
---

# Plan — daemon-client 写回流程对齐 daemon-entity-binding

- **plan_level**: full
- **概述**: 4 Wave / 8 task / 跨 backend（6 模块）+ frontend。核心路径 =
  共享解析 → 后端写回点修复（4 处并行）→ 前端适配 → 测试加固。
- **依据**: `design.md`（§1-12）+ `decisions.md`（D-001~004@v1 全 accepted，无未决）。
- **核心约束**: 不改 `DaemonChangeWrite` 表结构（D-003）、不改 daemon 端轮询、
  不改 lease 流程（派发已修）、不做历史数据迁移（D-007）。

## Wave 分组与任务

### Wave 1 · 共享基础设施（先行，所有写回点依赖）

- [x] **task-01**: 抽共享 `resolve_runtime_for_writeback` + placement 查询函数提取
  - 文件：`workspace/member_runtimes/resolver.py`（新增函数）、`workspace/member_runtimes/queries.py`（新增，模块级查询）、`agent/placement.py`（三个查询方法提取为模块级）
  - 覆盖：FR-01 / D-001@v1 / D-004@v1
  - 要点：复刻 placement.py:702-749 解析；NoOnlineDaemonError 内部转译为 DaemonClientNoActiveSession（reason 字段）；placement 现有测试零回归
  - 验收：函数各边界单测（无 binding / daemon 离线 / default_agent 空 / 命中 / 无匹配）；placement 测试全绿

### Wave 2 · 后端写回点修复（4 个并行，依赖 Wave 1）

- [x] **task-02**: change_writer proxy-create 删 runtime_id 入参 + 校验改现算
  - 文件：`change_writer/proxy.py`（签名 + line 192 校验）、`change_writer/router.py`（line 90 入参）、`change_writer/service.py`（line 57 + 113-135）
  - 覆盖：FR-02 / FR-03 / D-001@v1 / D-002@v1
  - 依赖：task-01
  - 验收：daemon-client workspace proxy_create_change 成功（AC-01）

- [x] **task-03**: change/service.py write_file + _enqueue_edit_write 补 user_id + 现算
  - 文件：`change/service.py`（write_file:328 + _enqueue_edit_write:384 + line 407）、`change/router.py`（line 216 传 user.id）
  - 覆盖：FR-04 / D-001@v1
  - 依赖：task-01
  - 验收：daemon-client 写变更文件成功（AC-02）

- [x] **task-04**: spec_workspace/router.py sync-manual runtime_id 改现算
  - 文件：`spec_workspace/router.py`（line 148-196）
  - 覆盖：FR-05 / D-001@v1
  - 依赖：task-01
  - 验收：daemon-client sync-manual 走 outbox 返回 pending（AC-03）

- [x] **task-05**: daemon/runtime/service.py runtime 删除 RESTRICT 改查 lease+change_write
  - 文件：`daemon/runtime/service.py`（line 674, 696）
  - 覆盖：FR-06 / D-003@v1
  - 依赖：无（独立于 task-01，可与 W2 其他并行）
  - 验收：删除被引用的 runtime 被阻止，无引用的成功（AC-04）

### Wave 3 · 前端适配（依赖 Wave 2 task-02 端点入参稳定）

- [x] **task-06**: 前端 create-change page + lib/changes.ts 删 runtime_id + api-types 重生成
  - 文件：`frontend/src/lib/changes.ts`（line 226）、`frontend/src/app/(dashboard)/workspaces/[id]/create-change/page.tsx`（line 104）、`frontend/src/lib/api-types.ts`
  - 覆盖：FR-07 / D-002@v1
  - 依赖：task-02（端点入参改完）
  - 验收：daemon-client workspace 建变更页不传 runtime_id 成功（AC-07）

### Wave 4 · 测试加固（依赖 Wave 2/3 全部完成）

- [x] **task-07**: 后端集成测试 + 新链路覆盖 + 回归
  - 文件：`member_runtimes/tests/test_resolver.py`（新增）、`change_writer/tests/test_proxy.py`、`change/tests/test_files_router.py`、`spec_workspace/tests/test_sync_manual.py`、`daemon/runtime/tests/`、`agent/tests/test_placement*.py`
  - 覆盖：AC-01 / AC-02 / AC-03 / AC-04 / AC-05 / AC-06 / AC-08
  - 依赖：task-01~05
  - 要点：补 daemon_runtime_id=NULL + member binding fixture（现有 fixture 全用非空 runtime_id 是盲区，是 bug 漏到生产主因）
  - 验收：新链路测试全绿；现有 server-local / legacy fixture 测试零回归（AC-06）

- [x] **task-08**: 前端测试更新
  - 文件：`frontend/src/app/(dashboard)/workspaces/[id]/create-change/__tests__/page.test.tsx`
  - 覆盖：AC-07
  - 依赖：task-06
  - 验收：daemon-client workspace 建变更不传 runtime_id 仍成功；DAEMON_CLIENT_NO_SESSION 错误渲染引导（保留）

## 依赖关系

```
W1 task-01 ──┬─→ W2 task-02 ──→ W3 task-06 ──→ W4 task-08
             ├─→ W2 task-03 ──→ W4 task-07
             ├─→ W2 task-04 ──→ W4 task-07
             └─→ W2 task-05 ──→ W4 task-07
                             ↑
                  task-05 独立于 task-01（可并行）
```

- Wave 1 是硬先行（task-01 共享函数被 W2 三处调用）。
- Wave 2 内 task-02~05 互不依赖（不同模块/表），可并行实现。
- task-05 独立于 task-01（runtime 删除 RESTRICT 改查询，不调共享函数）。
- Wave 3 依赖 task-02（端点入参契约定型）。
- Wave 4 集成测试依赖所有实现 task 完成。

## 风险与对策

| 风险 | 对策 | 关联 task |
|------|------|-----------|
| placement 查询函数提取为模块级，影响派发现有测试 | 提取保持纯查询语义；task-01 全量跑 placement 测试零回归 | task-01 |
| write_file/router/_enqueue_edit_write 三处补 user_id，可能漏传 | task-03 改动链明确列出三处；单测覆盖 user_id 传递 | task-03 |
| NoOnlineDaemonError 转译逻辑放 resolver 内部，reason 映射易漏 | task-01 单测覆盖所有 reason 场景（§6 六边界） | task-01 |
| runtime 删除 RESTRICT 改查询后，lease/change_write runtime_id 必须有值 | task-05 验证前提（派发+写回现算都填）；旧 NULL 行已 D-007 重置 | task-05 |
| OpenAPI 重生成可能引入前端类型分叉 | task-06 重生成后 tsc --noEmit + page test 全绿 | task-06 |

## 自检

- [x] 覆盖 design §4/§5 全部文件变更点（task-01~06）
- [x] 每个 task 标注覆盖 FR / D-xxx@vN
- [x] 依赖关系无循环（W1→W2→W3→W4 线性 + W2 内并行）
- [x] AC-01~08 全部映射到 task 验收
- [x] 不改表结构 / daemon 端 / lease 流程（核心约束守住）
- [x] task-05 独立性标注（不阻塞 W1）
- [x] 风险对策映射到具体 task
