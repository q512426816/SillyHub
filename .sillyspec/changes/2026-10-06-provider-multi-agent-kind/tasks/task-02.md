---
id: task-02
title: '模型/DTO agent_kinds list[str] + pi×openai_chat 集合级校验（schema+service 双口径）'
title_zh: '模型/DTO agent_kinds list[str] + pi×openai_chat 集合级校验（schema+service 双口径）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-06 14:31:42
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-01, FR-04]
decision_ids: []  # (预填源未就绪：plan 阶段后跑 prefill-refresh)
allowed_paths:
  - backend/app/modules/llm_provider/
target_files:
  - backend/app/modules/llm_provider/schema.py
  - backend/app/modules/llm_provider/service.py
goal: >
  llm_provider 模块 DTO 层把引擎字段从单值 agent_kind 升级为 agent_kinds: list[str]
  （min_length=1、去重、沿用 claude/pi/codex 引擎词表），Create/Update/Read 三 DTO 同步（FR-01）；
  pi×openai_chat 禁配从行级单值升级为集合级 422，schema.py 与 service.py 双口径同批落地（FR-04）；
  响应体仅出新字段、无过渡期（规则 11 单仓同批收口）。
implementation:
  - backend/app/modules/llm_provider/schema.py:22 Create：`agent_kind：Literal["claude","pi","codex"] = "claude"` 改 `agent_kinds：list[Literal["claude","pi","codex"]]` + Field(min_length=1)，删默认值（必须显式传 ≥1 个引擎）；加去重 validator（保序 dedupe：["claude","claude"] 归一为 ["claude"]，去重后仍须非空）
  - backend/app/modules/llm_provider/schema.py:42-57 Create._forbid_pi_openai_chat：判定改 `self.api_format == "openai_chat" and "pi" in self.agent_kinds` → raise ValueError（422 ValidationError 自然冒泡），docstring 语义从「agent_kind 是 pi」改「集合含 pi」（FR-04）
  - backend/app/modules/llm_provider/schema.py:60-76 Update：新增 `agent_kinds：list[Literal["claude","pi","codex"]] | None = None`（None=不动，design §接口定义）；非 None 时 min_length=1 + 去重与 Create 同口径
  - backend/app/modules/llm_provider/schema.py:85 Read：`agent_kind：str` 删除，改 `agent_kinds：list[str]`（from_attributes 直映射新列；openapi.json/api-types 再生成归 task-09）
  - backend/app/modules/llm_provider/service.py:211-239 create：`agent_kind=data.agent_kind` 赋值改 `agent_kinds=data.agent_kinds`；:238 日志字段 agent_kind=row.agent_kind 改输出 agent_kinds 集合
  - backend/app/modules/llm_provider/service.py:251-259 update 组合校验集合化（与 schema 双口径）：判定改「生效 api_format（updates 显式传 openai_chat 或行现值 openai_chat）且 生效 agent_kinds（updates.agent_kinds 或 row.agent_kinds）含 pi」→ raise LlmProviderKindFormatForbidden（422）——双向堵绕过：改集合引入 pi 时行已是 openai_chat、改 format 时集合已含 pi 两个方向都必须拒绝；details 的 agent_kind 键改输出集合
  - grep backend/app/modules/llm_provider/ 全模块清零 `agent_kind\b` 行字段残留引用（router/helpers；前端 api 层归一化归 task-09 不在本卡）
acceptance:
  - Create 校验：agent_kinds 不传或传空列表 → 422（min_length=1）；["claude","claude"] 去重存为 ["claude"]；["gemini"] → 422（引擎词表外）
  - Create 组合禁配（FR-04）：agent_kinds 含 "pi" 且 api_format=openai_chat → 422；含 pi 但 api_format=anthropic → 创建成功；codex/claude × openai_chat 不受限
  - Update 双口径（FR-04）：对 openai_chat 行 PATCH agent_kinds=["pi"] → 422 LlmProviderKindFormatForbidden；对集合含 pi 行 PATCH api_format="openai_chat" → 422；Update.agent_kinds=None → 不动原集合（exclude_unset 语义不变）
  - Read 响应体含 agent_kinds 数组、不含 agent_kind 键（接口无过渡期）
  - grep -n "agent_kind\b" backend/app/modules/llm_provider/ 下无行字段残留引用（仅剩 agent_kinds 与语义同步后的注释/文档串）
verify:
  - cd backend && python -m pytest app/modules/llm_provider/tests（模块域回归；存量 agent_kind 单值断言失效属预期，修复统一归 task-07）
  - cd backend && python -c "from app.modules.llm_provider.schema import LlmProviderCreate, LlmProviderUpdate, LlmProviderRead; print('dto import ok')"
constraints:
  - MUST NOT 改 sillyhub-daemon 仓任何代码
  - MUST NOT 保留 Read.agent_kind 旧字段（无过渡期，规则 11）；前端 api-types/归一化/表单改造归 task-08/09 同批收口，本卡后端先行
  - MUST NOT 动默认互斥逻辑（_clear_sibling_defaults 及 create/update/set_default 清兄弟语义归 task-03）；MUST NOT 动 probe/fetch_models/usage（与引擎无关）
  - schema.py 与 service.py 双口径校验 MUST 同批落地，MUST NOT 只改一处（否则 Update 侧留绕过口）
  - 与 task-01 串行（消费迁移后的 agent_kinds 列）；既有测试（backend/app/modules/llm_provider/tests/test_llm_provider.py、test_api_format.py 等）断言失效更新统一归 task-07，本卡不修测试不新增测试
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
