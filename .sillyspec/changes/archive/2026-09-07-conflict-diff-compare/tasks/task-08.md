---
id: task-08
title: 'platform-sync-section 行改造 + changes-overview-card ql 标题'
title_zh: 'platform-sync-section 行改造 + changes-overview-card ql 标题'
author: 'qinyi'
created_at: 2026-09-07 13:53:21
priority: P0
depends_on: ['task-05', 'task-06']
blocks: []
requirement_ids: [FR-01, FR-05, FR-06]
decision_ids: [D-004@v1]
allowed_paths:
  - frontend/src/components/changes/platform-sync-section.tsx
  - frontend/src/components/workspace/changes-overview-card.tsx
target_files:
  - frontend/src/components/changes/platform-sync-section.tsx
  - frontend/src/components/workspace/changes-overview-card.tsx
goal: >
  按 D-002@v1/D-004@v1 改造 platform-sync-section 冲突行——ql 编号标题 + 冲突发生时间 + 按钮收敛为「查看对比」（接入 task-07 弹窗），无权限用户不渲染入口；changes-overview-card 只读冲突清单同步 ql 标题规则。
implementation:
  - 标题区——ql_id 存在时显示「【ql_id】快速修复」+ 小字 code 原 change 名，否则显示变更名（D-004@v1 存量 quick 兜底）；行上补冲突发生时间 created_at（复用本文件 relativeAge/parseIsoLikeMs helper）
  - 按钮收敛——移除行内保本地/取平台（dispatchResolve 确认逻辑移交弹窗），只留「查看对比」；machine.status 非 online 时禁用并 tooltip「机器离线，无法读取本地内容」（machineOnline 先例见 session-panel.tsx :2177）
  - 权限——access.canOperate 为 false 时不渲染「查看对比」（useMachineSyncActionAccess，FR-06 与 compare 端点同权限集合），冲突清单本身保持只读可见
  - 挂载 ConflictCompareModal（task-07 产物，同 Wave 3 合流）——行点击置 open 态，传 instanceId/change/kind/workspaceId
  - changes-overview-card.tsx 未决冲突区（:503-530）标题同步同一 ql 规则，保持只读定位不加任何按钮
acceptance:
  - ql_id 存在时行标题为「【ql-xxx】快速修复」+ 灰色小字原 ID，缺失时兜底显示变更名；行上只出现「查看对比」且显示冲突发生时间
  - 机器离线时按钮禁用带 tooltip；无权限用户看不到「查看对比」但清单仍可见；有权限用户点击可打开弹窗
  - 总览卡只读清单同规则显示 ql 标题且仍无操作入口
  - task-06 适配版 platform-sync-section.test.tsx 全绿且 tsc 0 错
verify:
  - cd frontend && pnpm vitest run src/components/changes/__tests__/platform-sync-section.test.tsx && pnpm exec tsc --noEmit
constraints:
  - changes-overview-card 只改标题显示，不动其只读定位与跳变更中心入口
  - 语义 token 禁 hex；复用 conflictTypeMeta 等既有模块内 helper，不重复造轮子
  - STRATEGY_TEXT 文案与裁决/回显链路语义不变，仅按钮位置从行迁到弹窗
expects_from:
  task-05:
    - contract: ApiTypes
      needs: [SillySpecConflictCompareResponse, DaemonHeartbeatSillySpecConflict.ql_id]
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
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
