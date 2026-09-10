---
id: task-01
title: 'add-zcode-sess-id-extractor-and-sqlite-fixture-builder'
title_zh: 'sess id 提取纯函数 + fixture SQLite 测试库构造器'
author: 'qinyi'
created_at: 2026-09-10 11:50:46
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/src/agent-log/read-zcode-sqlite.ts
  - sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts
target_files:
  - NEW:sillyhub-daemon/src/agent-log/read-zcode-sqlite.ts
  - NEW:sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts
provides:
  - contract: extractZcodeSessId 纯函数与 fixture SQLite 造库构造器
    fields: [sess-id 提取, fixture 造库 helper]
goal: >
  新建 read-zcode-sqlite.ts（本 task 只落 sess id 提取纯函数 + 导出的 fixture
  构造 helper，开库/归一化由 task-02 续写同文件）+ 首批测试：extractZcodeSessId
  从上报 log_path 文件名解析 session.id（主会话/子代理两形态），fixture 构造器按
  真实 schema 用 node:sqlite 造可注入路径的临时测试库，为 task-02 归一化读取器
  （FR-01 恒读库）提供注入式测试地基。
implementation:
  - 新建 sillyhub-daemon/src/agent-log/read-zcode-sqlite.ts——export 纯函数 extractZcodeSessId(path)（入参完整 log_path，返回 session.id 或 null）——取 basename 匹配 model-io-sess_<id>.jsonl 与 model-io-sess_subagent_agent_<id>.jsonl 两形态（子代理同规则，<id> 即 session.id，design Phase 1 实证），不匹配返回 null；不读 fs、不抛异常
  - 同文件 export 测试 helper createZcodeFixtureDb(options)——node:sqlite DatabaseSync 按真实 schema 建表造数：session(id,title,directory,parent_id) / message(id,session_id,sequence,data 含 role、time{created,completed}、semantics) / part(id,message_id,session_id,sequence,data 含 type:text|tool{tool,callID,state{status,input,output|error}}|reasoning|step-start|step-finish|timeline|file|compaction)；库路径参数注入（默认临时目录），返回 {dbPath, close()}
  - 造数场景覆盖（供 task-02 复用）：主会话/子代理会话/空会话（仅 session 行）/隐藏消息 hidden 三判据（semantics.uiVisibility=='hidden' || transcriptVisibility=='hidden' || visibility=='model-only'）/tool part 四态（state.status=completed+error+running+pending，running/pending 无 output）/未知 part 类型/坏 JSON 行（data 列写非法 JSON 字符串）
  - 新建 sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts——extractZcodeSessId 用例（主会话全路径/子代理路径/非 zcode 命名与无 .jsonl 后缀返回 null）+ fixture 构造器用例（三表行数、session.parent_id 与 message.sequence 关键列、part.data 逐行 JSON 可解析、坏 JSON 行场景单列）
acceptance:
  - extractZcodeSessId 对 model-io-sess_<id>.jsonl 与 model-io-sess_subagent_agent_<id>.jsonl（含 rollout 目录前缀的完整路径）均返回 <id>；非 zcode 命名/无后缀路径返回 null，全程零 fs 访问（纯函数）
  - createZcodeFixtureDb 在注入路径建成含三表的临时库，各场景数据可被只读 DatabaseSync 查回；除坏 JSON 行场景外 part.data 逐行 JSON.parse 成功
  - 主会话/子代理/空会话/hidden 三判据/tool 四态/未知类型/坏 JSON 行各场景在 fixture 中按 session_id 可区分查询（行数与关键列符合造数预期）
  - fixture 建库-查回-close 全流程不泄漏文件句柄，临时库可重复构造（每用例独立路径）
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/agent-log/read-zcode-sqlite.test.ts
constraints:
  - 提取函数为纯函数：不读 fs/env/时钟，不抛异常，不可识别一律返回 null
  - fixture 构造器内联在 test 文件或经 read-zcode-sqlite.ts 导出的测试 helper，不新增其它文件（文件清单 7 项之外零新增）
  - 本 task 不实现开库/归一化/beforeSeq 窗口（task-02 续写同文件）；不动 host-fs-handler、backend、既有 parser 与 registry
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
