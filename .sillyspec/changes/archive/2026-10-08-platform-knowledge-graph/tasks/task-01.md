---
id: task-01
title: 'daemon knowledge.graph RPC handler：白名单/三参数消毒/钳制/三态探测/裁剪/注册'
title_zh: 'daemon knowledge.graph RPC handler：白名单/三参数消毒/钳制/三态探测/裁剪/注册'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-08 17:50:00
priority: P0
depends_on: []
blocks: [task-02, task-04]
requirement_ids: [FR-04]
decision_ids: [D-001@v2, D-005@v1]
allowed_paths:
  - sillyhub-daemon/src/runtime-handler.ts
  - sillyhub-daemon/src/daemon.ts
target_files:
  - sillyhub-daemon/src/runtime-handler.ts
  - sillyhub-daemon/src/daemon.ts
goal: >
  KnowledgeGovernanceHandler 扩展 graph 方法并注册 knowledge.graph RPC——平台图查询的唯一 daemon 出口。
  消毒面覆盖 anchor/anchor2/search 三个自由串（R-01），旧 CLI 三态细分回码（D-001@v2），清单 top-50 裁剪。
implementation:
  - runtime-handler.ts KnowledgeGovernanceHandler 加 graph(params) 方法：sub 白名单 {summary,nodes,neighbors,path,impact,orphans,dangling}，白名单外 RpcError('validation_rejected')
  - sanitizeGraphText(v)：黑名单正则（先例 ROOT_PATH_METACHAR_RE 全集 /["'`$;&|<>() %^]/ 外加 \n\r\0\t）命中即 RpcError('validation_rejected')；anchor/anchor2/search 三参数同函数；正常节点 id 字符集（/ # :@ - _ .）零冲突放行（实测样本）
  - 命令拼装（锚点=CLI 位置参数，引号在黑名单内杜绝逃逸）：`sillyspec knowledge graph <sub> "<anchor>" ["<anchor2>"] --json`；edges 白名单=16 边型键∪{all}（值取自 CLI EDGE_STRENGTH 键集的硬拷贝列表）；depth parseInt 钳 1-3；search 限长 ≤200；limit 钳 1-50；sub=summary 固定追加 `--clusters 50`
  - runSillyspecCmd 30s 超时（SILLYSPEC_TIMEOUT_MS）；stdout 非信封或 ok!==true → 解析探测：含 'knowledge <' 或 code=unknown_subcommand → RpcError('cli_subcommand_missing')；graph 关键字缺失类错误 → cli_feature_missing:<sub>（summary/nodes 专属）
  - orphans/dangling 结果 JSON.parse 后 items 截 50、count 保留原值再回传
  - _guardRoot 双防线原样复用（407-418 行先例）
  - daemon.ts 在 knowledge.digest/knowledge.action 注册处（约 7095-7112）追加 ws.registerRpcHandler('knowledge.graph', ...)，params 经 normalizeRootPathParam
acceptance:
  - 全部消毒分支按 D-001@v2 契约回码；正常节点 id（decision:decisions/x.md#D-1@v1、src/foo.js）全放行
  - 注入尝试（; rm、反引号、$()、"逃逸、换行）全部 validation_rejected，无一到达 shell
  - 旧 CLI 三态（daemon 未注册/cli 无 graph/cli 缺 summary|nodes）回码可判别
verify:
  - cd sillyhub-daemon && pnpm typecheck
constraints: >
  禁止绕过 sanitize 直拼命令串；锚点引号包裹；白名单外一律 validation_rejected（R-01 注入面）
---
# task-01
