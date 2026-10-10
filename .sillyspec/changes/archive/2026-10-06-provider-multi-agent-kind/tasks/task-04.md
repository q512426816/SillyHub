---
id: task-04
title: '解析链集合化（context.py resolve_default/bound/_inject_provider_config + inject_gates.py + capability.py + mcp_gateway/tools.py 池描述符）'
title_zh: '解析链集合化（context.py resolve_default/bound/_inject_provider_config + inject_gates.py + capability.py + mcp_gateway/tools.py 池描述符）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-06 14:31:42
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-01, FR-05]
decision_ids: []  # (预填源未就绪：plan 阶段后跑 prefill-refresh)
allowed_paths:
  - backend/app/modules/daemon/lease/context.py
  - backend/app/modules/daemon/session/service/inject_gates.py
  - backend/app/modules/session_attachment/capability.py
  - backend/app/modules/mcp_gateway/tools.py
target_files:
  - backend/app/modules/daemon/lease/context.py
  - backend/app/modules/daemon/session/service/inject_gates.py
  - backend/app/modules/session_attachment/capability.py
  - backend/app/modules/mcp_gateway/tools.py
goal: >
  会话解析链四处把「引擎 == 供应商 agent_kind」改为「引擎 ∈ 供应商 agent_kinds」集合包含命中，
  且下发 provider_config 的 agent_kind 字段恒盖为会话引擎值（D-005）——
  daemon 注入器 getInterceptor(agent_kind) 分发契约与 claim/switch 生命周期事件结构零变化。
implementation:
  - backend/app/modules/daemon/lease/context.py:92-100 resolve_default_provider_config 查询：去掉 `LlmProvider.agent_kind == agent_kind` SQL 条件，user_id 先过滤拉行后 Python 行级判 `agent_kind in (row.agent_kinds or [])` 且 is_default（每用户行数几十级无性能面，R-01 口径）；:116 与 :133 两处构造 config 的 "agent_kind" 键值从 provider.agent_kind（行字段）改为 agent_kind（函数入参=会话引擎，盖写，D-005）
  - backend/app/modules/daemon/lease/context.py:184 resolve_bound_provider_config 引擎校验：`provider.agent_kind != agent_kind` 改 `agent_kind not in (provider.agent_kinds or [])`（归属校验 user_id 不动）；:192 与 :207 两处 config 构造同款盖会话引擎值
  - backend/app/modules/daemon/lease/context.py:219-343 _inject_provider_config：注入链复用上述两个 resolve（本身无独立列匹配），核查 payload["provider_config"] 三处赋值点无 agent_kind 行字段直读残留，docstring「引擎一致/agent_kind 对齐」语义串同步为「会话引擎 ∈ agent_kinds 集合」
  - backend/app/modules/daemon/session/service/inject_gates.py:278 会话级供应商引擎校验：`llm_provider_row.agent_kind != provider` 改 `provider not in (llm_provider_row.agent_kinds or [])`；422 DaemonSessionLlmProviderKindMismatch 语义不变，details 的 agent_kind 键改输出该行集合
  - backend/app/modules/session_attachment/capability.py:110-121 resolve_session_gate 默认查询：去掉 :113 的 `LlmProvider.agent_kind == agent_kind` SQL 条件，user_id + is_default 过滤后 Python 行级判集合包含；会话显式绑定分支（:97-105 按 id + user_id 查）不动；群聊 shadow 间接路径（group/service/shadow.py → attachment_pipeline）经本查询自动受益（R-06）
  - backend/app/modules/mcp_gateway/tools.py:1228-1243 配额池查询：去掉 :1234 的 `LlmProvider.agent_kind == effective_agent` SQL 条件，user_id.in_ + is_default 过滤后 Python 行级判 `effective_agent in (row.agent_kinds or [])`，order_by(LlmProvider.user_id, LlmProvider.name) 确定序保留（多默认异常态池归属稳定）
  - backend/app/modules/mcp_gateway/tools.py:1030 _quota_pool_entry independent 分支：`"agent_kind": row.agent_kind` 改输出池引擎值（函数入参 agent_kind = effective_agent，语义本就是引擎）而非行字段——多引擎行下池归属按 effective_agent 判定，不随行内集合顺序漂移
acceptance:
  - 一条 agent_kinds=["claude","pi"] 的默认供应商行：claude 会话与 pi 会话 claim 各自命中（resolve_default 集合命中），payload.provider_config.agent_kind 分别为 "claude"/"pi"（盖会话引擎，daemon getInterceptor 分发契约不变，FR-01 多引擎命中场景 + FR-05）
  - resolve_bound：绑定行集合不含会话引擎（如 codex 会话绑 ["claude","pi"] 行）→ 返回 None 回退用户默认链（回退语义零回归）
  - inject_gates.py:278：会话引擎不在绑定行集合 → 422 DaemonSessionLlmProviderKindMismatch（语义不变）；引擎在集合 → 通过
  - capability.py：多选默认行按会话引擎命中多模态门控解析（群聊 shadow 间接路径同受益，R-06）
  - tools.py：配额池按 effective_agent 命中多选默认行；independent 池描述符的 agent_kind == effective_agent（池引擎值，非行字段）
  - 存量单元素行（agent_kinds == [旧值]）四路径行为与单值时代逐项等价（FR-02 兼容：值域不变性由迁移保证，本卡解析语义等价）
  - grep -n "\.agent_kind\b" 于 4 个 allowed_paths 文件无 LlmProvider 行字段读取残留
verify:
  - cd backend && python -m pytest app/modules/daemon/tests/test_resolve_default_provider_config.py app/modules/daemon/tests/test_resolve_bound_provider_config.py tests/modules/daemon/lease/test_provider_config_payload.py app/modules/session_attachment/tests/test_capability.py（四路径存量测试；单值 == 匹配与行字段直读断言失效属预期，修复统一归 task-07）
constraints:
  - MUST NOT 改 sillyhub-daemon 仓任何代码（D-005：daemon 注入链零改动）
  - MUST NOT 改 provider_config 结构/字段名（agent_kind 键名与取值域不变，仅值来源细化为会话引擎盖写；claim/switch 生命周期契约表零变化）
  - MUST NOT 动 provider_switch.py 扇出（归 task-05）、agent/schema.py 与 protocol.py 注释语义（归 task-06）
  - 仅改 4 个 allowed_paths 文件；attachments.py/control.py/group/service/shadow.py/attachment_pipeline.py/agent/router.py:343 已核查传的是会话引擎值非行字段，MUST NOT 顺手改
  - 与 task-02 串行（消费 model 层 agent_kinds 列）；不新增测试、不修存量测试（四域用例统一归 task-07）
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
