---
id: task-11
title: sillyspec isPathASupported() 改探测 MCP tools/list dispatch_worker schema
title_zh: 路径A 探测翻真（stub 恒 false → tools/list schema 探测）
author: qinyi
created_at: 2026-08-08 17:39:23
priority: P0
depends_on: [spike-01, task-04]
blocks: [task-13]
requirement_ids: [FR-04]
decision_ids: [D-005]
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/sillyspec/src/dispatch/backends/sillyhub-mcp.js
  - C:/Users/qinyi/IdeaProjects/sillyspec/src/sillyhub-mcp/client.js
expects_from:
  task-04:
    - contract: mcp_gateway（链路B）dispatch_worker inputSchema 含可选 worktree_path + worker_prompt，经 MCP 标准 tools/list 暴露
      needs:
        - dispatch_worker schema 声明 worktree_path（供 SillySpec schema 探测命中）
        - tools/list 经 SillySpec 持的 McpToken 鉴权可调通（spike-01 验证）
  spike-01:
    - contract: tools/list 探测可行性结论（FastMCP @mcp.tool 暴露 tools/list + optional 字段真入 schema）
      needs:
        - 探测可行 → 本 task 走 schema 探测；不可行 → 改 env 标记 SILLYHUB_PATH_A=1
provides:
  - isPathASupported() 探测翻真（true 时 strategy.js 切 renderSillyHubInstruction 路径A，不再降级 Local）
goal: >
  把 isPathASupported() 从 stub 恒 false 改为探测 SillyHub MCP tools/list 返回的 dispatch_worker inputSchema 含 worktree_path（+ worker_prompt）→ true；探测保守 fallback false 不硬试（R-04）。spike-01 不通过则改用 env 标记 SILLYHUB_PATH_A=1 替代 schema 探测（二选一由 spike-01 定）。
implementation:
  - client.js 加 listTools() 方法：JSON-RPC method 'tools/list'（复用 _callTool 的 fetch/SSE/鉴权骨架，但 method 非 tools/call、无 name 参数）；best-effort 返回 tools 数组或 null，未配置/异常不抛
  - sillyhub-mcp.js isPathASupported() 改为读探测结果：找 dispatch_worker.inputSchema.properties 含 worktree_path 与 worker_prompt 全命中 → true，任一缺失/探测失败 → false（保守，R-04）
  - 探测结果缓存（probe.js probeSillyHub 流程预热 + isPathASupported 同步读缓存，保持现 sync 签名避免改 strategy.js 调用点；若预热点在 probe.js 与 task-12 协调）
  - spike-01 不通过分支：isPathASupported 读 process.env.SILLYHUB_PATH_A==='1' 返回 true，schema 探测降级为 env 标记
  - 同步更新 JSDoc：删 "stub 恒 false" 表述，改写探测逻辑 + spike-01 二选一说明
acceptance:
  - tools/list 返回 dispatch_worker schema 含 worktree_path + worker_prompt → isPathASupported 返回 true（AC-07）
  - tools/list 缺字段 / 不可达 / 未配置 → 返回 false（保守不硬试，R-04）
  - spike-01 失败分支：SILLYHUB_PATH_A=1 返回 true，否则 false
  - 探测异常不抛穿 execute（best-effort）
verify:
  - cd C:/Users/qinyi/IdeaProjects/sillyspec && npm test（mock tools/list 验三分支：含字段→true / 缺字段→false / 异常→false）
  - npm run lint
constraints:
  - 探测保守：不支持即回退 Local，绝不硬试路径A（铁律）
  - 只读 daemon schema，不碰 lease
  - spike-01 结果决定 schema 探测 vs env 标记，二选一不叠加
  - 保持 isPathASupported sync 签名（探测预热在 probe 流程）；若必须改 async 需同步改 strategy.js 调用点
  - 跨平台（Win/Linux/macOS），URL 一律正斜杠
---
