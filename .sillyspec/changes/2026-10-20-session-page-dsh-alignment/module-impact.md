# 模块影响分析（骨架由 `sillyspec module-impact --change <变更名>` 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| backend | `backend/app/modules/daemon/router/__init__.py` | <!--TODO--> | <!--TODO--> |
| backend | `backend/app/modules/daemon/router/session_insights.py` | <!--TODO--> | <!--TODO--> |
| backend | `backend/openapi.json` | <!--TODO--> | <!--TODO--> |
| components-daemon | `frontend/src/components/daemon/attachment-chips.tsx` | <!--TODO--> | <!--TODO--> |
| components-daemon | `frontend/src/components/daemon/turn-segment-views.tsx` | <!--TODO--> | <!--TODO--> |
| components-daemon | `frontend/src/components/daemon/turn-timeline.tsx` | <!--TODO--> | <!--TODO--> |
| components-sessions | `frontend/src/components/sessions/session-list-panel.tsx` | <!--TODO--> | <!--TODO--> |
| components-shared | `frontend/src/components/app-shell.tsx` | <!--TODO--> | <!--TODO--> |
| components-shared | `frontend/src/components/top-bar.tsx` | <!--TODO--> | <!--TODO--> |
| components-workspace-config | `frontend/src/components/workspace-switcher.tsx` | <!--TODO--> | <!--TODO--> |
| frontend | `frontend/.sillyspec/quicklog/QUICKLOG-WhaleFall.md` | <!--TODO--> | <!--TODO--> |
| frontend | `frontend/prototype-dist/change-center.html` | <!--TODO--> | <!--TODO--> |
| frontend | `frontend/prototype-dist/change-detail-v2.html` | <!--TODO--> | <!--TODO--> |
| frontend | `frontend/prototype-dist/change-detail.html` | <!--TODO--> | <!--TODO--> |
| frontend | `frontend/prototype-dist/conflict-sync-states.html` | <!--TODO--> | <!--TODO--> |
| frontend | `frontend/prototype-dist/index.html` | <!--TODO--> | <!--TODO--> |
| frontend | `frontend/prototype-dist/session-portal.html` | <!--TODO--> | <!--TODO--> |
| frontend | `frontend/prototype-dist/sillyspec-flow.html` | <!--TODO--> | <!--TODO--> |
| frontend | `frontend/prototype-dist/workspace-list.html` | <!--TODO--> | <!--TODO--> |
| frontend | `frontend/prototype-dist/workspace-overview.html` | <!--TODO--> | <!--TODO--> |
| frontend | `frontend/scripts/prototype-build.mjs` | <!--TODO--> | <!--TODO--> |
| frontend | `frontend/src/components/chat/round-divider.tsx` | <!--TODO--> | <!--TODO--> |
| lib-api | `frontend/src/lib/api-types.ts` | <!--TODO--> | <!--TODO--> |
| sillyhub-daemon | `sillyhub-daemon/src/api-types.ts` | <!--TODO--> | <!--TODO--> |
| styles | `frontend/src/app/globals.css` | <!--TODO--> | <!--TODO--> |
| test-utils | `frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx` | <!--TODO--> | <!--TODO--> |
| test-utils | `frontend/src/components/daemon/__tests__/turn-segment-views-thinking-translate.test.tsx` | <!--TODO--> | <!--TODO--> |
| test-utils | `frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx` | <!--TODO--> | <!--TODO--> |
| test-utils | `frontend/src/components/daemon/__tests__/turn-time-display.test.tsx` | <!--TODO--> | <!--TODO--> |
| test-utils | `frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx` | <!--TODO--> | <!--TODO--> |
| test-utils | `frontend/src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx` | <!--TODO--> | <!--TODO--> |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `.claude/skills/sillyspec-flow/SKILL.md` <!--TODO: 归属判定-->
- `.openclaw/skills/sillyspec-archive/SKILL.md` <!--TODO: 归属判定-->
- `.openclaw/skills/sillyspec-auto/SKILL.md` <!--TODO: 归属判定-->
- `.openclaw/skills/sillyspec-brainstorm/SKILL.md` <!--TODO: 归属判定-->
- `.openclaw/skills/sillyspec-commit/SKILL.md` <!--TODO: 归属判定-->
- `.openclaw/skills/sillyspec-continue/SKILL.md` <!--TODO: 归属判定-->
- `.openclaw/skills/sillyspec-doctor/SKILL.md` <!--TODO: 归属判定-->
- `.openclaw/skills/sillyspec-execute/SKILL.md` <!--TODO: 归属判定-->
- `.openclaw/skills/sillyspec-explore/SKILL.md` <!--TODO: 归属判定-->
- `.openclaw/skills/sillyspec-export/SKILL.md` <!--TODO: 归属判定-->
- `.openclaw/skills/sillyspec-flow/SKILL.md` <!--TODO: 归属判定-->
- `.openclaw/skills/sillyspec-init/SKILL.md` <!--TODO: 归属判定-->
- `.openclaw/skills/sillyspec-knowledge/SKILL.md` <!--TODO: 归属判定-->
- `.openclaw/skills/sillyspec-plan/SKILL.md` <!--TODO: 归属判定-->
- `.openclaw/skills/sillyspec-propose/SKILL.md` <!--TODO: 归属判定-->
- `.openclaw/skills/sillyspec-quick/SKILL.md` <!--TODO: 归属判定-->
- `.openclaw/skills/sillyspec-resume/SKILL.md` <!--TODO: 归属判定-->
- `.openclaw/skills/sillyspec-scan/SKILL.md` <!--TODO: 归属判定-->
- `.openclaw/skills/sillyspec-state/SKILL.md` <!--TODO: 归属判定-->
- `.openclaw/skills/sillyspec-status/SKILL.md` <!--TODO: 归属判定-->
- `.openclaw/skills/sillyspec-verify/SKILL.md` <!--TODO: 归属判定-->
- `.openclaw/skills/sillyspec-workspace/SKILL.md` <!--TODO: 归属判定-->
- `.opencode/skills/sillyspec-archive/SKILL.md` <!--TODO: 归属判定-->
- `.opencode/skills/sillyspec-auto/SKILL.md` <!--TODO: 归属判定-->
- `.opencode/skills/sillyspec-brainstorm/SKILL.md` <!--TODO: 归属判定-->
- `.opencode/skills/sillyspec-commit/SKILL.md` <!--TODO: 归属判定-->
- `.opencode/skills/sillyspec-continue/SKILL.md` <!--TODO: 归属判定-->
- `.opencode/skills/sillyspec-doctor/SKILL.md` <!--TODO: 归属判定-->
- `.opencode/skills/sillyspec-execute/SKILL.md` <!--TODO: 归属判定-->
- `.opencode/skills/sillyspec-explore/SKILL.md` <!--TODO: 归属判定-->
- `.opencode/skills/sillyspec-export/SKILL.md` <!--TODO: 归属判定-->
- `.opencode/skills/sillyspec-flow/SKILL.md` <!--TODO: 归属判定-->
- `.opencode/skills/sillyspec-init/SKILL.md` <!--TODO: 归属判定-->
- `.opencode/skills/sillyspec-knowledge/SKILL.md` <!--TODO: 归属判定-->
- `.opencode/skills/sillyspec-plan/SKILL.md` <!--TODO: 归属判定-->
- `.opencode/skills/sillyspec-propose/SKILL.md` <!--TODO: 归属判定-->
- `.opencode/skills/sillyspec-quick/SKILL.md` <!--TODO: 归属判定-->
- `.opencode/skills/sillyspec-resume/SKILL.md` <!--TODO: 归属判定-->
- `.opencode/skills/sillyspec-scan/SKILL.md` <!--TODO: 归属判定-->
- `.opencode/skills/sillyspec-state/SKILL.md` <!--TODO: 归属判定-->
- `.opencode/skills/sillyspec-status/SKILL.md` <!--TODO: 归属判定-->
- `.opencode/skills/sillyspec-verify/SKILL.md` <!--TODO: 归属判定-->
- `.opencode/skills/sillyspec-workspace/SKILL.md` <!--TODO: 归属判定-->

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/backend.md` | 更新backend模块卡（本次变更涉及） | pending |
| `modules/components-daemon.md` | 更新components-daemon模块卡（本次变更涉及） | pending |
| `modules/components-sessions.md` | 更新components-sessions模块卡（本次变更涉及） | pending |
| `modules/components-shared.md` | 更新components-shared模块卡（本次变更涉及） | pending |
| `modules/components-workspace-config.md` | 更新components-workspace-config模块卡（本次变更涉及） | pending |
| `modules/frontend.md` | 更新frontend模块卡（本次变更涉及） | pending |
| `modules/lib-api.md` | 更新lib-api模块卡（本次变更涉及） | pending |
| `modules/sillyhub-daemon.md` | 更新sillyhub-daemon模块卡（本次变更涉及） | pending |
| `modules/styles.md` | 更新styles模块卡（本次变更涉及） | pending |
| `modules/test-utils.md` | 更新test-utils模块卡（本次变更涉及） | pending |
| `_module-map.yaml` | <!--TODO: 有未匹配文件，判定模块索引是否需增改（modules rebuild）--> | pending |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
