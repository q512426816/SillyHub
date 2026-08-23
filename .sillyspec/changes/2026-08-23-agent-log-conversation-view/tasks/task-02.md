---
id: task-02
title: 'daemon 解析器注册表 + host_fs RPC 方法 read_agent_log_messages——白名单复用、not_found/forbidden 走既有 throw 通道、status 分层返回、未注册 format→unsupported + RPC 单测'
title_zh: 'daemon 解析器注册表 + host_fs RPC 方法 read_agent_log_messages——白名单复用、not_found/forbidden 走既有 throw 通道、status 分层返回、未注册 format→unsupported + RPC 单测'
author: 'qinyi'
created_at: 2026-08-23 21:24:18
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-02, FR-04]
decision_ids: [D-001@v1, D-006@v1]
allowed_paths:
  - sillyhub-daemon/src/agent-log/registry.ts
  - sillyhub-daemon/src/host-fs-handler.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/agent-log/read-agent-log-messages.test.ts
provides:
  - contract: read_agent_log_messages
    fields: [status, messages, truncated, totalSegments, skippedLines]
expects_from:
  task-01:
    - contract: NormalizedLogMessage
      needs: [seq, kind, text, tool_name, tool_use_id, tool_input, tool_result, is_error, ts]
goal: >
  新增 agent-log 解析器注册表（MVP 仅注册 zcode-model-io-jsonl）并在 HostFsHandler
  落地 readAgentLogMessages 第 10 方法 + daemon.ts 注册 host_fs.read_agent_log_messages
  RPC：白名单复用 assertWithinAllowedRoots、not_found/forbidden 照旧 throw RpcError
  （backend 既有映射零改动）、解析结果 status 分层返回、未注册 format → unsupported
  （FR-02 归一化消息出 daemon；FR-04 二进制维持 backend 409 黑名单不变，daemon 侧
  未注册即 unsupported 兜底）。
implementation:
  - 新建 src/agent-log/registry.ts——解析器注册表 format → parser 映射，MVP 仅注册 'zcode-model-io-jsonl'（与 CLI 上报落库 format 串逐字一致，design §6）；未注册 format 查询返回 null，由调用方转 status:'unsupported'（D-002 二期扩展点，不预写多格式抽象）
  - host-fs-handler.ts 新增 readAgentLogMessages(path, format, beforeSeq?)——先 assertWithinAllowedRoots(path, this._rootsProvider())（复用 readFile 同款白名单守卫，越界抛 forbidden RpcError）；readFile 失败经 toRpcError 抛 not_found（与 readFile 完全同通道，D-006 裁决三/Grill B3）
  - 白名单通过后 lstat 预判文件大小——超 20MB 直接返回 status:'too_large' 不读全文；否则 readFile utf8 全量读交解析器（解析器内部 20MB 预算兜底为 task-01 契约）
  - 注册表分发——format 未注册返回 {status:'unsupported', messages:[], truncated:false, totalSegments:0, skippedLines:0}（不进解析器）；已注册调解析器（透传 content + beforeSeq），原样回传 {status, messages, truncated, totalSegments, skippedLines}（外层 camelCase 对齐 host-fs-handler.ts 命名惯例与 design §7.1，messages 内层 NormalizedLogMessage snake_case）
  - daemon.ts _registerHostFsRpcHandler 追加注册 ws.registerRpcHandler('host_fs.read_agent_log_messages', …)——参数清洗与既有九方法同款（path/format typeof string 守卫、beforeSeq 数字可选缺省 undefined）
  - 新建 tests/agent-log/read-agent-log-messages.test.ts——风格对齐 tests/host-fs-handler.test.ts（mkdtemp 真实临时目录 + 真实 fs 写 fixture 文件）；覆盖白名单 happy path（真实 zcode 形状文件 → parsed + 字段断言）、越界 forbidden throw、文件不存在 not_found throw、未注册 format → unsupported、超 20MB → too_large、beforeSeq 透传切片、registry 单测（zcode-model-io-jsonl 已注册/未知 format 返回 null）
acceptance:
  - 白名单内真实 zcode model-io JSONL 文件 → status:'parsed'，messages 为 NormalizedLogMessage[]（内层 snake_case），truncated/totalSegments/skippedLines 正确
  - 越界路径抛 RpcError code='forbidden'；文件不存在抛 RpcError code='not_found'——与 readFile 同通道同 code，backend 既有错误映射零改动可复用
  - 未注册 format（含二进制格式串透传到达时）→ status:'unsupported'、messages 空、不调用解析器
  - 文件超 20MB → status:'too_large'（lstat 预判，不读全文入内存）
  - beforeSeq 透传解析器，返回 seq < beforeSeq 的窗口切片（加载更早）
  - registry 仅含 zcode-model-io-jsonl 一项；RPC 方法 host_fs.read_agent_log_messages 已在 daemon.ts 注册（老 daemon method-not-found 语义由 backend task-03 映射 422）
  - 既有 host-fs-handler.test.ts / host-fs-handler-worktree.test.ts 等九方法测试零回归
verify:
  - cd sillyhub-daemon && pnpm test tests/agent-log/read-agent-log-messages.test.ts
  - cd sillyhub-daemon && pnpm test
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - ESM import 带 .js 后缀（CONVENTIONS 13，如 import … from './agent-log/parse-zcode-model-io.js'）
  - not_found/forbidden 走既有 throw RpcError 通道（assertWithinAllowedRoots + toRpcError，与 readFile 同款）；解析失败不走 throw——status:'unsupported'/'parse_error'/'too_large' 结构化返回（「RPC 成功≠解析成功」分层，design §7.1/§7.2）
  - 白名单复用 file-rpc.ts 的 assertWithinAllowedRoots，不自建路径校验；roots 经 _rootsProvider() 取，与现有九方法一致
  - 注册表 MVP 仅注册 zcode-model-io-jsonl（D-002），不做多格式扩展
  - 不改 task-01 的 parse-zcode-model-io.ts（解析器归 task-01 所有，发现解析缺陷回 task-01 修）；host-fs-handler.ts 既有九方法行为零变更
  - 外层返回字段 camelCase（对齐 host-fs-handler.ts 现有命名惯例），messages 内层 NormalizedLogMessage snake_case（与 backend schema 逐字对齐由 task-03 消费）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
