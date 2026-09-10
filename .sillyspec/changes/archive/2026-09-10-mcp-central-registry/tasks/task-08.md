---
id: task-08
title: 'importer——JSON 粘贴导入'
title_zh: 'importer——JSON 粘贴导入'
author: 'qinyi'
created_at: 2026-09-10 11:18:41
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-004]
expects_from:
  task-01:
    - contract: McpServerCreate
      needs: [name, server_config, scope]
    - contract: McpImportRequest
      needs: [json_text, scope]
  task-02:
    - contract: McpRegistryService
      needs: [create_server]
provides:
  - contract: McpImportJsonResponse
    fields: [imported, skipped, renamed]
allowed_paths:
  - backend/app/modules/mcp_registry/importer.py
  - backend/app/modules/mcp_registry/tests/
target_files:
  - NEW:backend/app/modules/mcp_registry/importer.py
  - NEW:backend/app/modules/mcp_registry/tests/test_importer_json.py
goal: >
  新建 importer.py 实现 JSON 粘贴导入——mcpServers/servers/mcp 三种顶层包装解析、逐条容错（坏条目记 skipped 不中断整批）、name 归一化与同名冲突 skip，统一经 task-02 service 落库（secret 抽列加密在 service 层完成），source 标 imported_json。
implementation:
  - 实现 import_from_json(session, json_text, scope, user) 入口——task-03 的 import-json 端点已惰性委托此签名，返回 imported/skipped/renamed 三计数结果
  - 三包装解析——顶层 dict 依次探测 mcpServers、servers、mcp 三键取首个 dict 值；整体非合法 JSON 或三键均未命中返回 400 中文提示
  - 逐条容错——非 dict 条目、缺 command、name 归一化（小写与连字符替换，合法形态为小写字母数字开头加连字符且长 2-100，design 数据模型节）后仍非法者记 skipped 带原因；同 scope 同名冲突（owner 加 name 唯一索引）skip 不改写既有资产
  - 合法条目构造 McpServerCreate（env 明文整体放入 server_config）调 service.create_server 落库——secret 判定与加密全在 service（_SECRET_KEY_MARKERS 键名规则，settings/router.py:164），importer 禁止直接调 get_cipher 与 CredentialCipher
  - 元数据——scope=platform 置 owner NULL、mine 置 owner 当前用户；source 固定 imported_json；dedup_key 留空（去重锚仅归 workspace 导入）；renamed 统计 name 被归一化改写的条目
  - 新增 test_importer_json.py 覆盖三包装各一例、坏条目容错、同名 skip、secret 键落库后只进 encrypted_env、http 与 sse 条目拒收（D-005 仅 stdio）
acceptance:
  - 三种包装的合法 JSON 均导入成功；任一条目坏只进 skipped 不中断整批
  - env 中含 token/key/secret/password 子串的键落库后仅存在于 encrypted_env 密文，server_config.env 只含非 secret 明文
  - 非 stdio 条目不落库（skipped 带原因）；同批重复名与再次导入同名同配置全 skip（幂等不改写）
verify:
  - cd backend && uv run pytest app/modules/mcp_registry/tests/test_importer_json.py -q
  - cd backend && uv run ruff check app/modules/mcp_registry
  - cd backend && uv run mypy app/modules/mcp_registry
constraints:
  - 与 task-09 共享 importer.py，W3 波内 08 先于 09 串行（plan 依赖 task-09 depends_on task-08）；本卡仅 JSON 粘贴路径，不做 workspace 扫描与去重
  - 加密一律经 service.create_server，不得在 importer 内绕过抽列规则直接加密
  - 仅跑本卡相关测试（CLAUDE.md 规则 0 禁全量）
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
