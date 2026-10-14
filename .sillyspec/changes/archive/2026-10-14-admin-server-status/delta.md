---
generated_at: 2026-10-14T22:48:43.408Z
sources_reconcile: 命中（ran_at=2026-10-14T17:22:47.935Z，verify-runs 按 change 过滤取最新）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-10-14-admin-server-status

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

（受影响模块集为空——交付/差集文件均未命中任何模块 paths）

未匹配文件（不归属任何模块 paths，人工裁量）：backend/app/modules/agent/provider_caps.py、backend/app/modules/auth/permissions.py、backend/app/modules/health/router.py、backend/openapi.json、backend/tests/modules/auth/test_permissions.py、backend/tests/test_health.py、frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx、frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx、frontend/src/app/(dashboard)/admin/server-status/page.tsx、frontend/src/components/app-shell.tsx、frontend/src/lib/api-types.ts、frontend/src/lib/health.ts、frontend/src/lib/menu-permissions.ts、frontend/src/lib/provider-caps.ts

### 声明域并集（decisions.md 模块域）

（decisions.md 解析出 7 条当前版本决策，均未填写模块域——声明域为空）

## Delta（做了什么）

### 交付文件 × 模块归属

| 交付文件 | 模块归属 |
|---|---|
| backend/app/modules/agent/provider_caps.py | —（未匹配） |
| backend/app/modules/auth/permissions.py | —（未匹配） |
| backend/app/modules/health/router.py | —（未匹配） |
| backend/openapi.json | —（未匹配） |
| backend/tests/modules/auth/test_permissions.py | —（未匹配） |
| backend/tests/test_health.py | —（未匹配） |
| frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | —（未匹配） |
| frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx | —（未匹配） |
| frontend/src/app/(dashboard)/admin/server-status/page.tsx | —（未匹配） |
| frontend/src/components/app-shell.tsx | —（未匹配） |
| frontend/src/lib/api-types.ts | —（未匹配） |
| frontend/src/lib/health.ts | —（未匹配） |
| frontend/src/lib/menu-permissions.ts | —（未匹配） |
| frontend/src/lib/provider-caps.ts | —（未匹配） |

- 对账基线：status=ok / form=worktree / sources=worktree:diff-base..HEAD、worktree:status-porcelain(uncommitted)
- missing（声明未落盘）：无
- undeclared（落盘未声明）：无

### 决策清单（id × 模块域）

| 决策 | 模块域 |
|---|---|
| D-001@v2 | （未填写） |
| D-002@v2 | （未填写） |
| D-003@v1 | （未填写） |
| D-004@v1 | （未填写） |
| D-005@v1 | （未填写） |
| D-006@v1 | （未填写） |
| D-007@v1 | （未填写） |

### 探针 metrics 摘要（验证结论表的机器半边）

快照时刻：2026-10-14T17:14:05.991Z
- probe1：matches=0 / skippedFiles=0 / worktreeHits=2 / globEntries=0
- probe3：tasks=4 / hasTest=4
- probe5：backendEndpoints=648 / frontendCalls=3
- probe6：deletions=0 / unavailable=false
- probe8：mispairs=0 / feOnly=0 / missingNotNull=0 / contractCount=0 / contractOrphans=0 / missingRequired=0 / feKeys=0 / backendFields=0
- probe9：javaFileCount=0 / groupCount=0 / inconsistentGroups=0
- probe10：checkedFiles=5 / unclearedFiles=0

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/components-shared.md` | AppShell 契约行补 MENU_ICON_MAP 增 /admin/server-status→Server | done |
| `modules/lib-api.md` | 注意事项补 2026-10-14-admin-server-status 再生成条目（Permission 扩员） | done |
| `modules/lib-health.md` | 卡面重写：getSystemStatus 恢复（定位/契约/关键逻辑/注意事项，废"已不存在"旧注） | done |
| `modules/lib-menu-permissions.md` | system 组条目 5 项→6 项（服务器信息 + 落位/锚定口径） | done |
| `_module-map.yaml` | 未匹配文件判定：backend/* 归 backend 模块域、admin 新页归 app-pages 域——均索引粒度限制（backend map 按 backend/** 粗粒度收录、frontend map 未含 admin 页面路径），非游离文件、非路径漂移，无需 rebuild | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

### scan 刷新建议

- （受影响模块集为空——无重点刷新面）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：backend/app/modules/agent/provider_caps.py、backend/app/modules/auth/permissions.py、backend/app/modules/health/router.py、backend/openapi.json、backend/tests/modules/auth/test_permissions.py、backend/tests/test_health.py、frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx、frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx、frontend/src/app/(dashboard)/admin/server-status/page.tsx、frontend/src/components/app-shell.tsx、frontend/src/lib/api-types.ts、frontend/src/lib/health.ts、frontend/src/lib/menu-permissions.ts、frontend/src/lib/provider-caps.ts

### 端点基线提示

- 无基线（变更未拍 baseline）：C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\endpoint-baselines\2026-10-14-admin-server-status.json 不存在或不可解析——端点增删不可比（backendEndpoints=648（>0））
