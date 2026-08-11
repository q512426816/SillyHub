---
id: task-10
title: Update cross-repo sync contract - add §14 workspace isolation section
title_zh: 改契约补 §14 workspace 隔离章节（token 派生 + 签发端点 + connect 换发 + WORKSPACE_WRITE 权限）
author: qinyi
created_at: 2026-08-11 20:27:34
priority: P1
depends_on: [task-07]
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-005@v1, D-006@v1]
allowed_paths:
  - sillyspec/docs/sillyspec/sillyhub-progress-sync-contract.md
provides: []
expects_from:
  task-07:
    - contract: PlatformSyncTokenCreateResponse
      needs: [token, workspace_id]
    - contract: ResolveByRootPathRequest
      needs: [root_path]
    - contract: ResolveByRootPathResponse
      needs: [workspace_id, token]
goal: >
  sillyhub-progress-sync-contract.md 补 §14 workspace 隔离章节，内容与 task-07 端点契约对齐，§3 body 与既有 §1-13 不动。
implementation:
  - 在 §13 后新增 §14 workspace 隔离，编号接续既有章节，行文风格与旧章节一致
  - 记录 workspace 归属走 workspace-scoped token 派生（shpsync_ 前缀，参照 McpToken 模式），workspace 不进 serializeForSync body（§3 裸六表不变）
  - 记录两新端点：POST /workspaces/{workspace_id}/platform-sync-tokens（WORKSPACE_WRITE 校验，201 返 PlatformSyncTokenCreateResponse 含明文仅一次）与 POST /workspaces/resolve-by-root-path（ResolveByRootPathRequest body=root_path，反查不到 404、无权限 403，200 返 ResolveByRootPathResponse 含 workspace_id+token）
  - 记录 connect 换发：sillyspec platform connect 调 resolve-by-root-path 拿 shpsync_，replaceTopLevelSection 文本级写入 local.yaml platform 段保留注释
  - 记录收件箱 3 端点鉴权升级：shpsync_ 派生 workspace_id，复合唯一 (workspace_id, change_name) 隔离多 workspace 同名 change，shk_live_ 过渡期 workspace_id=None
acceptance:
  - §14 存在且编号接续 §13 不重号；token 派生/签发端点/connect 换发/WORKSPACE_WRITE 权限要素与 design §7 及 task-07 端点契约一致
  - §3 body 未改动（无 workspace_id 字段），§4-13 内容零删改；frontmatter updated_at 已更新
verify:
  - 文档变更无 pytest；改完 git diff --check 无空白错误且 git diff 仅含该契约文件
constraints:
  - 纯文档改动，只允许编辑 sillyhub-progress-sync-contract.md 一个文件，不改任何代码
  - 章节编号与现有 §1-13 顺序一致，新增 §14 不重号不插队；补章内容必须与 task-07 端点契约对齐（expects_from 三契约字段一致）
  - workspace 隔离走 token 派生，不修改 §3 六表 body 结构（NG-2），connect 段写入沿用 replaceTopLevelSection 保留注释
---
