---
id: task-09
title: Extend connect to exchange workspace-scoped token via resolve-by-root-path and write via replaceTopLevelSection
title_zh: connect 换发 workspace-scoped token 并 replaceTopLevelSection 写入 local.yaml platform 段
author: qinyi
created_at: 2026-08-11 20:27:34
priority: P0
depends_on: [task-07]
blocks: []
allowed_paths:
  - sillyspec/src/sync.js
expects_from:
  task-07:
    - contract: ResolveByRootPathRequest
      needs: [root_path]
    - contract: ResolveByRootPathResponse
      needs: [workspace_id, token]
requirement_ids: [FR-03]
decision_ids: [D-005@v1, D-006@v1]
goal: >
  扩展 sillyspec platform connect：用现有 user 级 shk_live_ token 携带本地 root_path（connect 的 cwd）调
  resolve-by-root-path 换发 workspace-scoped shpsync_ token，成功后用 replaceTopLevelSection 文本级写
  local.yaml platform 段（保留注释）；404/403/断网降级不阻断，沿用现有 token 继续连接。覆盖 FR-03、D-005@v1。
implementation:
  - 健康检查通过后以 token 参数为 Bearer 鉴权调 resolve-by-root-path，body 传本地 root_path（connect 的 cwd，与平台 Workspace.root_path 绑定值等值匹配）
  - 用 fetchJson 请求，成功时取响应 workspace_id 与 shpsync_ token，platform 段 token 以换发结果覆盖原 user 级 token
  - 沿用 replaceTopLevelSection 文本级写 platform 段（url 与 token 与 last_connected 与 user），文件注释与其他段字节保留
  - 换发失败降级：404 反查不到或 403 无权限或断网超时均 console.warn 提示并写原 token 继续，不阻断不退出非零
  - 不触碰 mcp 段同源逻辑（NG-4 留单独 change）
acceptance:
  - 换发成功时 local.yaml platform 段 token 为 shpsync_ 前缀且注释与其他段保留
  - 换发失败（404 或 403 或断网）时仍按现有逻辑写原 token，connect 不失败退出
  - mcp 段既有逻辑不动，其余内容字节级保留
verify:
  - cd C:\Users\qinyi\IdeaProjects\sillyspec && node test/check-syntax.mjs
  - cd C:\Users\qinyi\IdeaProjects\sillyspec && node test/local-yaml-preserve.test.mjs
  - cd C:\Users\qinyi\IdeaProjects\sillyspec && node test/platform-sync-user-config.test.mjs
constraints:
  - 保留 local.yaml 注释，写入一律 replaceTopLevelSection 文本级段替换，不走 parse 重写往返
  - 404 或 403 或断网降级不阻断 connect，沿用 best-effort 语义
  - mcp 段同源坑不顺带修（NG-4）
  - 新增 connect 换发测试用例随 task-12 connect 联调补齐
---
