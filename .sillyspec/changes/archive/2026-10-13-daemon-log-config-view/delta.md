---
generated_at: 2026-10-13T13:18:55.914Z
sources_reconcile: 命中（ran_at=2026-10-13T13:01:27.791Z，verify-runs 按 change 过滤取最新）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-10-13-daemon-log-config-view

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

（受影响模块集为空——交付/差集文件均未命中任何模块 paths）

未匹配文件（不归属任何模块 paths，人工裁量）：backend/app/modules/daemon/router/__init__.py、backend/app/modules/daemon/router/machines.py、backend/app/modules/daemon/schema.py、backend/openapi.json、backend/tests/modules/daemon/test_daemon_machine_diag.py、frontend/src/app/(dashboard)/runtimes/page.tsx、frontend/src/components/daemon/__tests__/daemon-diagnostic-dialog.test.tsx、frontend/src/components/daemon/daemon-diagnostic-dialog.tsx、frontend/src/components/daemon/machine-card.tsx、frontend/src/lib/api-types.ts、frontend/src/lib/daemon/machines.ts、sillyhub-daemon/src/daemon.ts、sillyhub-daemon/src/diag-rpc.ts、sillyhub-daemon/tests/diag-rpc.test.ts

### 声明域并集（decisions.md 模块域）

sillyhub-daemon、backend、frontend

## Delta（做了什么）

### 交付文件 × 模块归属

| 交付文件 | 模块归属 |
|---|---|
| backend/app/modules/daemon/router/__init__.py | —（未匹配） |
| backend/app/modules/daemon/router/machines.py | —（未匹配） |
| backend/app/modules/daemon/schema.py | —（未匹配） |
| backend/openapi.json | —（未匹配） |
| backend/tests/modules/daemon/test_daemon_machine_diag.py | —（未匹配） |
| frontend/src/app/(dashboard)/runtimes/page.tsx | —（未匹配） |
| frontend/src/components/daemon/__tests__/daemon-diagnostic-dialog.test.tsx | —（未匹配） |
| frontend/src/components/daemon/daemon-diagnostic-dialog.tsx | —（未匹配） |
| frontend/src/components/daemon/machine-card.tsx | —（未匹配） |
| frontend/src/lib/api-types.ts | —（未匹配） |
| frontend/src/lib/daemon/machines.ts | —（未匹配） |
| sillyhub-daemon/src/daemon.ts | —（未匹配） |
| sillyhub-daemon/src/diag-rpc.ts | —（未匹配） |
| sillyhub-daemon/tests/diag-rpc.test.ts | —（未匹配） |

- 对账基线：status=ok / form=post-apply / sources=main:status-porcelain(untracked-all)、main:log-msg-window(declared-rescue-only:HEAD)、apply-pathspec
- missing（声明未落盘）：无
- undeclared（落盘未声明）：无

### 决策清单（id × 模块域）

| 决策 | 模块域 |
|---|---|
| D-001@v2 | （未填写） |
| D-002@v1 | sillyhub-daemon、backend、frontend |
| D-003@v1 | frontend |
| D-004@v1 | sillyhub-daemon、backend、frontend |
| D-005@v1 | （未填写） |
| D-006@v1 | （未填写） |
| D-007@v1 | （未填写） |
| D-008@v1 | （未填写） |

### 探针 metrics 摘要（验证结论表的机器半边）

快照时刻：2026-10-13T12:35:58.418Z
- probe1：matches=0 / skippedFiles=0 / worktreeHits=0 / globEntries=0
- probe3：tasks=3 / hasTest=3
- probe5：backendEndpoints=2386 / frontendCalls=3
- probe6：deletions=0 / unavailable=false
- probe8：mispairs=0 / feOnly=0 / missingNotNull=0 / contractCount=0 / contractOrphans=0 / missingRequired=0 / feKeys=0 / backendFields=0
- probe9：javaFileCount=0 / groupCount=0 / inconsistentGroups=0
- probe10：checkedFiles=4 / unclearedFiles=0

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/app-pages.md` | runtimes 页新增诊断弹窗接线（一行级） | done（changelog sidecar 登记） |
| `modules/daemon.md` | daemon 侧新增 diag RPC（handler 注册 + diag-rpc.ts） | done（changelog sidecar 登记） |
| `modules/lib-api.md` | api-types 产物新增两 schema 类型 | done（changelog sidecar 登记） |
| `_module-map.yaml` | 根 map 三模块 main_symbols 各追加一条（sillyhub-daemon readLogTail/getMaskedConfig、backend machine diag 端点、frontend DaemonDiagnosticDialog）；新文件物理路径已被各模块 paths glob（backend/** 等）覆盖，细粒度索引刷新留给 scan 周期 | done（archive step2 手动同步，2026-10-13） |

### scan 刷新建议

- （受影响模块集为空——无重点刷新面）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：backend/app/modules/daemon/router/__init__.py、backend/app/modules/daemon/router/machines.py、backend/app/modules/daemon/schema.py、backend/openapi.json、backend/tests/modules/daemon/test_daemon_machine_diag.py、frontend/src/app/(dashboard)/runtimes/page.tsx、frontend/src/components/daemon/__tests__/daemon-diagnostic-dialog.test.tsx、frontend/src/components/daemon/daemon-diagnostic-dialog.tsx、frontend/src/components/daemon/machine-card.tsx、frontend/src/lib/api-types.ts、frontend/src/lib/daemon/machines.ts、sillyhub-daemon/src/daemon.ts、sillyhub-daemon/src/diag-rpc.ts、sillyhub-daemon/tests/diag-rpc.test.ts

### 端点基线提示

- 端点 diff：基线 650 端点 × 现算 652 端点（method+归一 path 集合运算；changed 不配对，天然呈独立行）

| 增删 | method | path | source |
|---|---|---|---|
| + 新增 | GET | /machines/{instance_id}/logs | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\machines.py |
| + 新增 | GET | /machines/{instance_id}/config | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\machines.py |
