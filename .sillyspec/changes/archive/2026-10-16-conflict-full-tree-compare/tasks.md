---
author: qinyi
created_at: 2026-10-16 17:06:00
change: 2026-10-16-conflict-full-tree-compare
---
# 任务清单（Tasks）— 2026-10-16-conflict-full-tree-compare

<!-- 依据 design.md 文件变更清单与 Wave 编排拆分；实现+单测同卡；原型产物已于 brainstorm 生成，本清单含对账卡 -->
<!-- Wave 1：task-01（后端，独占）→ Wave 2：task-02（契约同步，依赖 01）→ Wave 3：task-03/task-04 真并行（前端两文件正交）→ Wave 4：task-05（对账与聚焦回归）→ task-06（部署真机复验，依赖 03/04/05） -->

- [x] task-01: 后端 full-tree 兜底——`_fetch_snapshot` 抽内层按记录名取快照 + 仅 `kind=spec-tree` 且主取 `conflict_record_missing` 时以 `full-tree` 重取一次 + 归属校验与裁剪以 **`files[].path`** 段边界前缀（`changes/(archive/)?<change>/`；快照无 `conflicting_paths` 字段）为准 + 来源元数据（record_label/covered_changes/path_total=快照返回路径数，非记录真实总数）+ `conflict_record_missing` 文案改「重新同步」口径 + machines.py 响应 schema 三可选字段 + test_sillyspec_compare.py 追加（兜底命中/段边界 foo-foobar/kind=progress 不触发/首取成功不重试/文案更新） (depends_on: -)
  - target_files: backend/app/modules/daemon/sillyspec_compare.py, backend/app/modules/daemon/router/machines.py, backend/app/modules/daemon/tests/test_sillyspec_compare.py
- [x] task-02: 契约同步——后端 schema 改动后同 change 内 `pnpm gen:types`（前端）与 `pnpm -C sillyhub-daemon gen:types`，提交 openapi.json + 两份 api-types（规则 21 + 闸门⑨ fail-closed；gen 前确认前端 node_modules 健康——本会话已按规则 21 修过 `.bin` 空目录） (depends_on: task-01)
  - target_files: backend/openapi.json, frontend/src/lib/api-types.ts, sillyhub-daemon/src/api-types.ts
- [x] task-03: 前端对比弹窗——失败卡分支键 **`details.daemon_code`**（外层 code 恒 HTTP_502_DAEMON_RPC_REMOTE）：conflict_record_missing（无「重试」+服务端消息小字）/ workspace_root_unknown（无重试）/ 外层 code ∈ {HTTP_504_DAEMON_RUNTIME_OFFLINE, HTTP_504_DAEMON_RPC_TIMEOUT}（保留 504 文案+重试）/ 其余（通用失败+重试）+ full-tree 兜底命中时顶部来源提示条（对齐 response_truncated 提示位，固定说明行无关闭控件）+ conflict-compare-modal.test.tsx 分支与提示用例 (depends_on: task-02)
  - target_files: frontend/src/components/changes/conflict-compare-modal.tsx, frontend/src/components/changes/__tests__/conflict-compare-modal.test.tsx
- [x] task-04: 前端行级关闭入口——`resolveSpecConflict` 客户端函数（POST /spec-conflicts/{id}/resolve）+ registryVersionRows 行带 id + 「标记已处理」按钮与 modal.confirm 文案（仅注册表行、仅 canOperate；文案写明关闭范围=整条注册表记录含兄弟变更名行、不改本机文件；成功 invalidate `["platform-sync-section","spec-conflicts",workspaceId]` 让行消失）+ platform-sync-section.test.tsx 用例（渲染/确认调用/消失/只读不可见） (depends_on: task-02)
  - target_files: frontend/src/lib/spec-workspaces.ts, frontend/src/components/changes/platform-sync-section.tsx, frontend/src/components/changes/__tests__/platform-sync-section.test.tsx
- [x] task-05: 原型对账与聚焦回归——`pnpm prototype:build` 重编译对账（产物 git diff 为空；变更目录 prototype-conflict-sync-states.html 同步）+ 本改动面聚焦回归（后端 compare 用例族 + 前端两个测试文件 + 前端 lint/typecheck + 后端 ruff/mypy 本文件面） (depends_on: task-03, task-04)
  - target_files: frontend/src/components/prototype/conflict-sync-states-view.tsx, frontend/scripts/prototype-build.mjs, frontend/prototype-dist/conflict-sync-states.html, .sillyspec/changes/2026-10-16-conflict-full-tree-compare/prototype-conflict-sync-states.html
- [x] task-06: 部署真机复验（D-008）——按 deploy-to-server skill 打包部署腾讯云生产（124.222.127.242）后，用现网 `2026-10-13-fire-unitadd-form-import` 行验证：对比可打开且仅含该变更 4 个路径 + 来源提示在场 + 失败卡分支文案 + 「标记已处理」可用且行消失；证据（请求与响应摘要）落 verify 记录 (depends_on: task-03, task-04, task-05)
  - target_files: -
  - ✅ 2026-10-17 复验收口（3/4 达成，用户裁决接受偏离）：①commit_sha 核对 ✓（994656fdd 双路一致）②四臂文案生产实测 ✓ + 前端 44 用例绿 ③关行双通道实测 ✓（全绿自动关行 + resolve 幂等确认）；「兜底对比 200」未达——机器侧两记录名双缺（记录生命周期断层：树记录只在机器侧会话结束/扫描收尾落盘，平台定向同步不再生），兜底代码按设计工作；6 条冲突路径 server 版本未动，机器下次树推送必再冲突届时补验。证据全文：`verify-deploy-evidence.md`。
