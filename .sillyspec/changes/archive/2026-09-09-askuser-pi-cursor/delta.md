---
generated_at: 2026-09-09T17:24:56.136Z
sources_reconcile: 命中（ran_at=2026-09-09T17:19:43.102Z，verify-runs 按 change 过滤取最新）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-09-09-askuser-pi-cursor

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

（受影响模块集为空——交付/差集文件均未命中任何模块 paths）

未匹配文件（不归属任何模块 paths，人工裁量）：backend/app/modules/agent/provider_caps.py、backend/app/modules/agent/tests/test_provider_caps_alignment.py、backend/app/modules/daemon/permission_service.py、backend/app/modules/daemon/tests/test_session_permissions.py、frontend/src/components/ask-user-dialog-card.test.tsx、frontend/src/components/ask-user-dialog-card.tsx、frontend/src/components/ask-user-marker-card.test.tsx、frontend/src/components/ask-user-marker-card.tsx、frontend/src/components/daemon/__tests__/session-panel-provider-caps.test.tsx、frontend/src/components/daemon/turn-timeline.tsx、frontend/src/components/group-chat/__tests__/group-askuser-aggregate.test.tsx、frontend/src/components/group-chat/group-chat-panel.tsx、frontend/src/lib/__tests__/askuser-marker.test.ts、frontend/src/lib/askuser-marker.ts、frontend/src/lib/provider-caps.ts、sillyhub-daemon/src/interactive/pi-rpc-driver.ts、sillyhub-daemon/src/interactive/providers.ts、sillyhub-daemon/src/interactive/session-manager/driver-factory.ts、sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts、frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx、frontend/src/lib/daemon/session-sse.ts、frontend/src/lib/daemon/sessions.ts

### 声明域并集（decisions.md 模块域）

（decisions.md 解析出 0 条当前版本决策，均未填写模块域——声明域为空）

## Delta（做了什么）

### 交付文件 × 模块归属

| 交付文件 | 模块归属 |
|---|---|
| backend/app/modules/agent/provider_caps.py | —（未匹配） |
| backend/app/modules/agent/tests/test_provider_caps_alignment.py | —（未匹配） |
| backend/app/modules/daemon/permission_service.py | —（未匹配） |
| backend/app/modules/daemon/tests/test_session_permissions.py | —（未匹配） |
| frontend/src/components/ask-user-dialog-card.test.tsx | —（未匹配） |
| frontend/src/components/ask-user-dialog-card.tsx | —（未匹配） |
| frontend/src/components/ask-user-marker-card.test.tsx | —（未匹配） |
| frontend/src/components/ask-user-marker-card.tsx | —（未匹配） |
| frontend/src/components/daemon/__tests__/session-panel-provider-caps.test.tsx | —（未匹配） |
| frontend/src/components/daemon/turn-timeline.tsx | —（未匹配） |
| frontend/src/components/group-chat/__tests__/group-askuser-aggregate.test.tsx | —（未匹配） |
| frontend/src/components/group-chat/group-chat-panel.tsx | —（未匹配） |
| frontend/src/lib/__tests__/askuser-marker.test.ts | —（未匹配） |
| frontend/src/lib/askuser-marker.ts | —（未匹配） |
| frontend/src/lib/provider-caps.ts | —（未匹配） |
| sillyhub-daemon/src/interactive/pi-rpc-driver.ts | —（未匹配） |
| sillyhub-daemon/src/interactive/providers.ts | —（未匹配） |
| sillyhub-daemon/src/interactive/session-manager/driver-factory.ts | —（未匹配） |
| sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | —（未匹配） |

- 对账基线：status=undeclared / form=post-apply / sources=main:status-porcelain(untracked-all)、apply-pathspec
- missing（声明未落盘）：无
- undeclared（落盘未声明，3 项）：frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx；frontend/src/lib/daemon/session-sse.ts；frontend/src/lib/daemon/sessions.ts

### 决策清单（id × 模块域）

（decisions.md 无当前版本 D 条目——决策清单为空）

### 探针 metrics 摘要（验证结论表的机器半边）

快照时刻：2026-09-09T16:46:26.168Z
- probe1：matches=3 / skippedFiles=4 / worktreeHits=0 / globEntries=0
- probe3：tasks=13 / hasTest=8
- probe5：backendEndpoints=2087 / frontendCalls=0
- probe6：deletions=0 / unavailable=false

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 无新增顶层模块/目录——全部改动落在既有模块文件内（askuser-marker.ts 入 frontend lib、marker 卡入 frontend components、桥接入 daemon interactive），_module-map 无需增改 | done |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

### scan 刷新建议

- （受影响模块集为空——无重点刷新面）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：backend/app/modules/agent/provider_caps.py、backend/app/modules/agent/tests/test_provider_caps_alignment.py、backend/app/modules/daemon/permission_service.py、backend/app/modules/daemon/tests/test_session_permissions.py、frontend/src/components/ask-user-dialog-card.test.tsx、frontend/src/components/ask-user-dialog-card.tsx、frontend/src/components/ask-user-marker-card.test.tsx、frontend/src/components/ask-user-marker-card.tsx、frontend/src/components/daemon/__tests__/session-panel-provider-caps.test.tsx、frontend/src/components/daemon/turn-timeline.tsx、frontend/src/components/group-chat/__tests__/group-askuser-aggregate.test.tsx、frontend/src/components/group-chat/group-chat-panel.tsx、frontend/src/lib/__tests__/askuser-marker.test.ts、frontend/src/lib/askuser-marker.ts、frontend/src/lib/provider-caps.ts、sillyhub-daemon/src/interactive/pi-rpc-driver.ts、sillyhub-daemon/src/interactive/providers.ts、sillyhub-daemon/src/interactive/session-manager/driver-factory.ts、sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts、frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx、frontend/src/lib/daemon/session-sse.ts、frontend/src/lib/daemon/sessions.ts

### 端点基线提示

- 端点增删：无增删（基线 571 端点 × 现算 571 端点，method+归一 path 全一致）
