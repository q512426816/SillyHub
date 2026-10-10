---
id: task-06
title: '注释/DTO 文档串语义同步（agent/schema.py + protocol.py）'
title_zh: '注释/DTO 文档串语义同步（agent/schema.py + protocol.py）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-06 14:31:42
priority: P0
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-005]
allowed_paths:
  - backend/app/modules/agent/schema.py
  - backend/app/modules/daemon/protocol.py
target_files:
  - backend/app/modules/agent/schema.py
  - backend/app/modules/daemon/protocol.py
goal: >
  task-04 解析链集合化后，把 provider_config 两个文档面（backend/app/modules/agent/schema.py 的 DTO 注释与 description、backend/app/modules/daemon/protocol.py 的协议注释）中「agent_kind=供应商行种类」旧语义同步为「agent_kind=会话引擎（多引擎行按会话引擎盖写下发）」，消除文档与行为漂移（FR-05/D-005）。
implementation:
  - backend/app/modules/agent/schema.py:101-115——provider_config 字段注释块与 Field description 同步：命中口径「is_default 且 agent_kind 对齐的 LlmProvider」改「is_default 且 agent_kinds 包含会话引擎」；字段清单中 agent_kind 标注「恒为该会话引擎值（多引擎供应商行经盖写/扇出按会话引擎下发，D-005）」。
  - backend/app/modules/daemon/protocol.py:307-331——ProviderConfigChangedPayload 注释块同步：agent_kind 语义改为「会话引擎，恒为该会话引擎值」；protocol.py:326「切换到无默认 provider 的 agent_kind」表述改「该会话引擎无默认」（停止场景 provider_config=None 语义本身不变）。
  - 纯注释/docstring/description 字符串改动——不改字段类型、默认值、校验、payload 结构与任何运行时行为。
acceptance:
  - 两处文档均无「provider_config.agent_kind 取供应商行 agent_kind」旧语义残留，均明确 agent_kind 恒为会话引擎值。
  - DTO 字段集、类型、默认值与 WS payload 结构零变化（diff 仅注释与 description 字符串），daemon 仓与前端消费方零感知。
  - 若 description 变更引起 backend/openapi.json 漂移不在本卡提交——统一归 task-09 的 gen:types 批次再生成。
verify:
  - cd backend && python -m pytest app/modules/agent/tests -q
  - cd backend && python -c "import app.modules.agent.schema, app.modules.daemon.protocol"
constraints:
  - 纯文档语义同步：不引入任何行为改动、不增删字段、不加校验。
  - 只改上述两文件；不动 backend/openapi.json、frontend 与其它模块（openapi/api-types 归 task-09）。
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
