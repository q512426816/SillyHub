---
id: task-10
title: '模板——seed 预置 + 存为模板'
title_zh: '模板——seed 预置 + 存为模板'
author: 'qinyi'
created_at: 2026-09-10 11:18:41
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-09]
decision_ids: [D-004]
expects_from:
  task-01:
    - contract: McpTemplateRead
      needs: [name, server_config, is_preset]
    - contract: McpServerDetail
      needs: [server_config, encrypted_env]
  task-02:
    - contract: McpRegistryService
      needs: [list_servers]
provides:
  - contract: McpTemplateList
    fields: [id, name, server_config, is_preset]
allowed_paths:
  - backend/app/modules/mcp_registry/templates.py
  - backend/app/modules/mcp_registry/service.py
  - backend/app/modules/mcp_registry/tests/
target_files:
  - NEW:backend/app/modules/mcp_registry/templates.py
  - NEW:backend/app/modules/mcp_registry/tests/test_templates.py
goal: >
  新建 templates.py 承载模板能力——5-7 个预置 stdio 模板幂等 seed（fetch/context7/playwright/sequentialthinking/memory 基线，可补 filesystem/git）与存为模板（从 server 存只取非 secret 明文配置、encrypted_env 丢弃），为前端模板入口供数据。
implementation:
  - PRESET_TEMPLATES 常量定稿 5-7 个预置——每项含 name 与 server_config（command 与 args 与仅非 secret 的 env 占位说明），全部 stdio（D-005）
  - ensure_preset_templates(session) 幂等 seed——库内无 is_preset 行时 bootstrap 写入一次，删后不复活；由 list_templates 首调触发（惰性，不动 main.py 启动链）
  - list_templates(session, user)——预置（owner 为 NULL）与本人自存（owner 当前用户）合并返回；跨用户私有不出现（防枚举同语义）
  - save_template——输入 name 与 from_server_id 或 server_config 二选一；从 server 存只复制 server_config 明文，encrypted_env 不跟随（mcp_templates 明文无 secret，design 数据模型节），响应带 secret 已丢弃标记供前端提示
  - 直传 server_config 路径做 stdio-only 与 name 合法性校验；task-03 的 templates 两端点已惰性委托本模块 list/save 函数
  - 新增 test_templates.py 覆盖 seed 幂等与删后不复活、从带 secret 的 server 存模板不含密文与明文、可见性（他人自存不可见）
acceptance:
  - 空库首调模板列表返回 5-7 个预置；二次调用不重复写行
  - 从含 secret 的 server 存模板后模板行内无任何 secret 明文或密文残留
  - 自存模板仅本人与预置对调用者可见
verify:
  - cd backend && uv run pytest app/modules/mcp_registry/tests/test_templates.py -q
  - cd backend && uv run ruff check app/modules/mcp_registry
  - cd backend && uv run mypy app/modules/mcp_registry
constraints:
  - 模板是明文无 secret 资产——任何路径不得把 encrypted_env 或 secret 明文写入 mcp_templates
  - 不新增 seed 迁移脚本（惰性 bootstrap 即可；项目未上线无历史负担，CLAUDE.md 规则 11）
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
