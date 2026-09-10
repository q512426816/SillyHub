---
id: task-04
title: 'render.py——注入集渲染 + 诊断预检五项'
title_zh: 'render.py——注入集渲染 + 诊断预检五项'
author: 'qinyi'
created_at: 2026-09-10 11:18:41
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-04, FR-08]
decision_ids: [D-008@v2, D-011]
allowed_paths:
  - backend/app/modules/mcp_registry/render.py
  - backend/app/modules/mcp_registry/tests/
target_files:
  - NEW:backend/app/modules/mcp_registry/render.py
  - NEW:backend/app/modules/mcp_registry/tests/test_render.py
goal: >
  新建 mcp_registry/render.py 提供注入集渲染 render_injection_set（platform binding 全集 ∪ user binding、encrypted_env 解密回填 env）与诊断预检 precheck_diagnostics（D-011 五项重定义版），供 task-05 daemon 端点与诊断端点共用。
implementation:
  - 实现 render_injection_set(session, user_id)——单查询 join mcp_servers 与 mcp_server_bindings，取 platform binding 全集 ∪ scope_ref=user_id 的 user binding，user_id 为 None 时仅 platform 位（D-008@v2 兼容语义），enabled=false 过滤
  - encrypted_env 逐键解密回填 env——按密文映射每键的 ct 与 key_id 走 CredentialCipher 单值接口循环解密（backend/app/core/crypto.py:67-78），与 server_config.env 明文键合并输出
  - server_type 非 stdio 条目剔除不输出（防御性——防 daemon 侧 platform 位整包回落 builtin-only，对应 invalid_type_defensive）
  - 解密失败（CipherKeyMismatch 等）不炸渲染——该 server 降级为无 secret 形态继续输出并记 decrypt_failed 标记
  - 实现 precheck_diagnostics(session) 返回五项诊断（D-011 现行定义）——decrypt_failed / bound_but_disabled / platform_name_shadow / workspace_blocked_by_whitelist / invalid_type_defensive；后两项需读各 workspace specDir/.mcp.json 与 mcp.whitelist KV（与 daemon_rpc.py:460 _read_mcp_config_raw 同源容错语义）
  - 新建 tests/test_render.py——golden 渲染（platform ∪ user / 仅 platform / 空库空集 / 解密失败降级）+ 五项诊断逐项用例
acceptance:
  - user_id 有值返回 platform ∪ user 注入集，user_id 为 None 仅 platform，未绑定或 enabled=false 的 server 不出现
  - registry 空库输出空 mcpServers 结构不抛错（对齐 KV 缺失回落语义）
  - 单 server 解密失败时整体渲染不抛错，该 server 以无 secret 形态输出
  - 五项诊断各有至少一个单测用例命中（D-011 逐项）
  - ruff 与 mypy 通过
verify:
  - cd backend && uv run pytest app/modules/mcp_registry/tests/test_render.py -q
  - cd backend && uv run ruff check app/modules/mcp_registry/render.py
  - cd backend && uv run mypy app/modules/mcp_registry/render.py
constraints:
  - 不改 daemon_rpc 端点与 settings KV 读取（换源在 task-05）
  - 诊断按 D-011 五项现行定义实现，不实现已废弃的 will_be_rejected_by_whitelist 与 will_be_prepurged 旧项
  - render 只产出 mcpServers 内容，三键响应外壳（platform_default/whitelist/workspace）由 task-05 端点组装
  - 解密与 workspace 文件读全程容错不抛错（渲染与诊断路径一致）
provides:
  - contract: mcp_registry 注入集渲染
    fields: [render_injection_set, precheck_diagnostics]
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
