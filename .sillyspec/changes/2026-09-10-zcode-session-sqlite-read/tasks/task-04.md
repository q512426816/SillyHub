---
id: task-04
title: 'add-backend-content-zcode-branch-with-pseudo-jsonl-synthesis-and-read-file-fallback'
title_zh: 'backend content 端点 zcode 分支——messages RPC 合成伪 jsonl + read_file 回落'
author: 'qinyi'
created_at: 2026-09-10 11:50:46
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-001@v1, D-002@v1, D-007@v1]
allowed_paths:
  - backend/app/modules/platform_sync/router.py
  - backend/app/modules/platform_sync/tests/test_agent_log_content.py
target_files:
  - backend/app/modules/platform_sync/router.py
  - backend/app/modules/platform_sync/tests/test_agent_log_content.py
goal: >
  read_agent_log_content（platform_sync/router.py）对 entry.format=
  zcode-model-io-jsonl 增加 zcode 分支：先经既有 _send_agent_log_rpc 通路调
  host_fs.read_agent_log_messages（rpc_args 含 path/format），status=parsed 时将
  messages 九字段逐行全量 JSON 序列化为伪 jsonl 返回（不截断），status 非 parsed
  或 RPC 抛错回落既有 read_file 路径（原 256KB 尾部截断语义一字不改），使原文
  视图不再依赖短命 rollout 文件（FR-02）。
implementation:
  - router.py read_agent_log_content：_resolve_agent_log_read_target 之后按小写 format（同既有黑名单 fmt 口径）判定 entry.format=='zcode-model-io-jsonl' 进 zcode 分支，claude/codex 及其它 format 流程零改动
  - zcode 分支先发 messages RPC——复用 _send_agent_log_rpc（method='read_agent_log_messages'，rpc_args={'path':entry.log_path,'format':entry.format or ''}，与 messages 端点 rpc_args 同构，unsupported_on_method_not_found=True）
  - status='parsed' → 合成伪 jsonl（D-007@v1）：resp['messages'] 逐条按九字段固定序（seq/kind/text/tool_name/tool_use_id/tool_input/tool_result/is_error/ts）json.dumps 全量序列化、'\n' 连接（封闭列举，不加省略号/额外字段）；返回 {content, truncated=resp['truncated'], size_bytes=len(content.encode('utf-8'))}——不做 256KB 截断（D-002@v1，按会话查询天然有界）
  - status 非 parsed（unsupported/parse_error/too_large）或 messages RPC 抛错（not_found/method_not_found 老 daemon/离线/超时，捕获不透传）→ 回落既有路径——_send_agent_log_rpc('read_file', {'path':entry.log_path}) + 原尾部 262144 截断逻辑原样保留（D-001@v1 文件灾备；回落 RPC 自身错误按现状语义冒出=双失败）
  - test_agent_log_content.py 沿既有 mock send_host_fs_rpc（_RPC 常量 patch）惯例补用例：zcode parsed 合成断言 / messages 失败（not_found 抛错 + unsupported 状态）回落 read_file 断言（第二跳 method 与 args）/ claude format 首跳即 read_file 断言
acceptance:
  - zcode format + messages RPC status=parsed：content 为逐行 JSON，行数=len(messages)，每行 loads 回九字段固定键集（无多余字段），truncated=resp.truncated 透传，size_bytes=len(content 编码后字节)；合成文本超 262144 字节也不截断
  - zcode format + messages RPC 抛 not_found（或 method_not_found/离线/超时）或 status=unsupported：回落第二跳 read_file {path}，返回走原尾部截断语义（大文件 262144 截断断言仍绿）
  - claude format：不进新分支，mock 首跳 method 即 read_file（不发 read_agent_log_messages）
  - 既有用例（截断/黑名单 409/scope 404/daemon 定位/错误映射）零回归
verify:
  - cd backend && uv run pytest app/modules/platform_sync/tests/test_agent_log_content.py -q --no-cov
constraints:
  - claude/codex 及其它 format 不进新分支；不改 AgentLogContentResponse 模型、_send_agent_log_rpc 错误映射与既有 read_file 主流程
  - 回落路径 256KB 尾部截断语义一字不改（D-002@v1 仅 DB 路径不截断）；九字段封闭列举不加省略号
  - provides/expects_from 不填（消费既有 read_agent_log_messages RPC 契约，无新契约产出）
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
