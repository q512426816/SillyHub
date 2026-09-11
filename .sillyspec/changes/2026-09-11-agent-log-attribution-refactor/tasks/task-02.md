---
id: task-02
title: 'CLI attribution tests + agent-log protocol doc update (sillyspec repo)'
title_zh: 'CLI 测试 + 协议文档更新（sillyspec 仓）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-12 05:15:06
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-006@v2, D-007@v1, D-008@v1]
repo: sillyspec
base_commit: 8aadc0f40e610fcb8b7c474924b41f3afd3d7e30
head_commit: 0b10dc611ed57e5731608a1c836e351ec5b18f31
allowed_paths:
  - test/agent-session-log.test.mjs
  - docs/platform-agent-log-protocol.md
target_files: [test/agent-session-log.test.mjs, docs/platform-agent-log-protocol.md]
related_tests: [test/agent-session-log.test.mjs]
goal: >
  承接 task-01 的行为变化收尾——更新/新增 test/agent-session-log.test.mjs 用例全量覆盖锚定/
  own 打标/双向互斥/推送范围语义并收敛 task-01 遗留的旧断言红，同步改写 protocol.md
  §1/§3/会话化上下文使协议文档与新实现对齐（FR-07）。
implementation:
  - 更新既有失败断言到新语义——§9/§11/§11b 受 own-only 合并、payload 收敛、双向互斥影响的用例（keep-prev 断言保留但口径限定 own 条目）
  - 新增锚定命中用例（tmp fixture + 注入 env/homeDir/now，沿用现有 makeXxxFixture 风格）：claude（CLAUDE_SESSION_ID 精确 + env 缺席回退 project 目录最新活跃 jsonl）、zcode（临时 db.sqlite fixture 用 node:sqlite 现场写 session 表——主会话 directory=cwd、子代理 parent_id 链 directory=worktree 路径，断言子链命中且不比 directory）、pi/dsh（safePath 直算）、codex（首行 session_meta.cwd 匹配取最新主文件）、SILLYSPEC_AGENT_LOG 覆盖=own
  - 新增锚定失败不打标用例：锚定器未命中时 own 为空 → entry ctx 不写（留底仅探测事实），payload 不含该条目
  - 新增 zcode 回退链用例：db.sqlite 缺失/查询异常 → 仅锚最新活跃主会话文件、subagent 文件无 ctx（宁缺毋滥）
  - 新增双向互斥镜像用例：预置 change_key 的留底条目经 quick run 变 quick_id 非 null 且 change_key=null；预置 quick_id 的留底条目经 change run 变 change_key=X 且 quick_id=null（两方向独立断言）
  - 新增推送范围用例：留底同时含 own+非 own 条目时 mock fetch 捕获 body.entries 只含 own（按 log_path 逐条断言），本地产物 entries 仍含全部（同一次 run 内对照）
  - 新增 own 豁免上限用例（DG-17）：同 cwd 并发超过 MAX_PER_HARNESS 个活跃 zcode 文件时 own 主会话/子代理仍进 detected
  - 新增 keep-prev 用例：无 ctx 的 run（context 缺省，如 status 类命令）对 own 条目保留原 ctx 不动
  - 更新 docs/platform-agent-log-protocol.md——§1 推送范围改「entries=留底∩own」并写明 keep-prev 与双向互斥；§3 增补 per-harness 锚定规则与回退链（zcode db.sqlite 主会话+parent_id 子链/回退、claude env 精确与回退、own 豁免 MAX_PER_HARNESS、env 覆盖=own、loose 档不锚不推）；「会话化上下文」段改写为双向互斥语义+ctx-owner 平台行为（两级 find/quick 优先分组/空 ctx 单桶，对齐主仓变更口径）；头部 updated_at 一并更新
acceptance:
  - node test/agent-session-log.test.mjs 全绿（exit 0）——含全部新增用例与更新后的既有断言（task-01 遗留红全部收敛）
  - 双向互斥两镜像方向均有显式断言（quick 清 change_key / change 清 quick_id）
  - 推送 own-only 与留底全量在同一次 run 内对照断言（payload 仅 own、产物含全部）
  - 锚定命中（各 harness）/锚定失败不打标/子代理链命中与回退缺省/own 豁免上限/keep-prev 均有对应用例且通过
  - protocol.md §1/§3/会话化上下文反映新协议——own-only 推送、per-harness 锚定与回退、双向互斥、ctx-owner 平台行为、keep-prev；旧口径表述（全量重推/单向互斥/harness|ctx 分组）无残留
verify:
  - cd C:/Users/qinyi/IdeaProjects/sillyspec && node test/agent-session-log.test.mjs
  - 人工对照 docs/platform-agent-log-protocol.md 与 src/agent-session-log.js 实现（§1/§3/会话化上下文逐节核对，注释与实现不一致是万恶之源）
constraints:
  - 只动 test/agent-session-log.test.mjs 与 docs/platform-agent-log-protocol.md；发现 src 实现缺陷回报修正 task-01，不在测试里就地绕过（CLAUDE.md 规则 9）
  - 测试不依赖真实 ~/.zcode 库与真实 home——db.sqlite fixture 在 tmp 目录用 node:sqlite 现场构建
  - 协议文档中文为主（必要专业术语除外），不改协议字段结构（schema_version 仍为 1）
  - 不跑 sillyspec 仓全量测试套件（run-tests.mjs 留给 CI），仅跑本文件用例
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
