---
id: task-02
title: 'zcode-envelope.ts——ZCode 私有协议信封层：NDJSON 编解码（strict 四分支 union，多余键拒）、请求 id 关联（客户端数字自增/服务端字符串）、服务端主动请求分发器；单测钉编解码往返与分发（D-005/D-007 → FR-02/04）'
title_zh: 'zcode-envelope.ts——ZCode 私有协议信封层：NDJSON 编解码（strict 四分支 union，多余键拒）、请求 id 关联（客户端数字自增/服务端字符串）、服务端主动请求分发器；单测钉编解码往返与分发（D-005/D-007 → FR-02/04）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 13:50:04
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02, FR-04]
decision_ids: [D-005@v1, D-007@v1]
allowed_paths:
  - sillyhub-daemon/src/adapters/zcode-envelope.ts
  - sillyhub-daemon/tests/interactive/zcode-envelope.test.ts
target_files:
  - NEW:sillyhub-daemon/src/adapters/zcode-envelope.ts
  - NEW:sillyhub-daemon/tests/interactive/zcode-envelope.test.ts
provides:
  - ZcodeEnvelope 类（sendRequest/sendNotification/replyResult/replyError + onServerRequest/onNotification 分发注册 + 逐行 NDJSON 编解码，strict 四分支 union 校验）——task-03/04 消费
expects_from: []
goal: >
  ZCode 私有协议的独立轻量信封层：NDJSON 逐行编解码 + 请求关联 + 服务端主动请求分发器。
  不动 adapters/json-rpc.ts（codex 在用，零回归面）。
implementation:
  - NEW:sillyhub-daemon/src/adapters/zcode-envelope.ts：出站帧 {id,method,params?}/{id,result}/{id,error:{code,message,data?}}（strict——多余键服务端拒，实测 jsonrpc/requestId 均被拒）；客户端请求 id 数字自增；服务端请求 id 为字符串（"server-N"）
  - 入站按 union 四分支解复用：请求（有 method 有 id）→ 分发器 / 通知（有 method 无 id）→ onNotification / 响应（有 id 有 result）→ pending resolve / 错误（有 id 有 error）→ pending reject
  - 服务端请求分发器：registerServerRequestHandler(method, handler)；未注册方法回空 result（防 15s 超时挂死会话创建）
  - 单测：编解码往返、strict 拒多余键、四分支解复用、id 关联 resolve、未注册服务端请求回空、错误帧 reject
acceptance:
  - 对实测样例帧（2026-10-15 抓包序列）编解码往返无损
  - strict 校验：{jsonrpc,id,method,params} 与 {method,requestId,params} 均被拒（与 ZCode 服务端行为镜像）
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/interactive/zcode-envelope.test.ts
constraints:
  - 禁止修改 sillyhub-daemon/src/adapters/json-rpc.ts（D-007 红线）
  - 零新增 npm 依赖；纯编解码无 IO（进程管线由驱动层持有）
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
