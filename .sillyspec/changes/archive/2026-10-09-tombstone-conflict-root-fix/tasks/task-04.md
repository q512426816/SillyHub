---
id: task-04
title: 'frontend 冲突行墓碑形态三态渲染（双源 join+收敛按钮+回显）'
title_zh: 'frontend 冲突行墓碑形态三态渲染（双源 join+收敛按钮+回显）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-09 11:58:09
priority: P1
depends_on: ['task-01', 'task-05']
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-001@v1, D-002@v1]
expects_from: 'task-01: POST /machines/{id}/sillyspec-tombstone-cleanup + action=tombstone_cleanup 回执；task-05: pending_conflicts[].type=tombstone 透传'
allowed_paths:
  - frontend/src/components/changes/platform-sync-section.tsx
  - frontend/src/components/changes/__tests__/platform-sync-section.test.tsx
  - frontend/src/lib/daemon/machines.ts
  - frontend/src/lib/api-types.ts
target_files:
  - frontend/src/components/changes/platform-sync-section.tsx
  - frontend/src/components/changes/__tests__/platform-sync-section.test.tsx
  - frontend/src/lib/daemon/machines.ts
  - frontend/src/lib/api-types.ts
goal: >
  前端冲突行识别墓碑形态（FR-02 三场景）：双源 join（注册表直读）后墓碑行露出「平台已删」根因、
  隐藏无效裁决入口、提供「收敛本机目录」按钮与回显。视觉基准=本变更 prototype-tombstone-conflict-row.html 三态。
implementation:
  - frontend/src/lib/daemon/machines.ts 加 triggerMachineSillySpecTombstoneCleanup(instanceId, {workspace_id, change})（对齐 triggerMachineSillySpecGhostCleanup 先例）
  - frontend/src/lib/api-types.ts 重生成（task-01 openapi 就绪后 pnpm gen:types）
  - frontend/src/components/changes/platform-sync-section.tsx：①useQuery 挂 listSpecConflicts(workspaceId, 'open')（60s 轮询，对齐 spec-sync-conflict-banner.tsx:24-27 先例；复用 specConflictsQueryKey）②墓碑索引=注册表行纯墓碑判定（details_json.platform_deleted 非空 且 conflicting_paths∖platform_deleted 为空——并集形态依据 backend/app/modules/spec_workspace/service.py:1311）按 platform_deleted 路径剥变更名（changes/<name>/ 与 changes/archive/<name>/ 前缀）③快照行 change 命中索引或快照行 type==='tombstone'（task-05 透传）→ 墓碑形态行：徽章「平台已删」（error token）+被删变更名+非版本冲突 note，隐藏查看对比与裁决；「收敛本机目录」按钮（access.canOperate+machineOnline 门控，disabled 同 waiting 回显）调新端点，登记 pendingMap（kind='tombstone_cleanup'，回显链复用 ECHO_TIMEOUT/ECHO_FAST_POLL 既有机制）④matchesCommandResult 加 tombstone_cleanup 分支（action+change 匹配）⑤注册表墓碑行快照侧无对应行时也渲染（计数并入未决冲突总数）；混合行与普通行走现状渲染不动
  - frontend/src/components/changes/__tests__/platform-sync-section.test.tsx 扩展：墓碑行渲染断言（徽章/真凶名/无查看对比按钮）/混合行不受影响/收敛按钮权限与离线禁用/回显三态/计数并入
acceptance:
  - 墓碑行显示「平台已删」+被删变更名+非版本冲突说明，无「查看对比」与裁决按钮（测试断言）
  - 「收敛本机目录」下发后行内回显 waiting→succeeded/failed/timeout 流转（复用既有回显链）
  - 混合行（conflicting_paths 差集非空）与普通版本冲突行渲染与现状一致
  - 无墓碑时整卡渲染与现状一致（join 零命中走原路径）
verify:
  - cd frontend && pnpm test -- src/components/changes/__tests__/platform-sync-section.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 心跳 schema 零改动（数据源=注册表直读，D-002@v1 钉死）
  - 墓碑判定谓词不得放宽为「platform_deleted 非空」（Grill B2：并集形态会误伤混合行）
  - 语义色走主题 token（FRONTEND_PAGE_STYLE §0.5），无 hex 硬编码
  - 中文文案；44px 触摸热区（compact 模式）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
