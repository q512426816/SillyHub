---
id: task-06
title: '会话选模型——inject_gates/create 非空 ∈ 列表校验 422 + claim model 派生'
title_zh: '会话选模型——inject_gates/create 非空 ∈ 列表校验 422 + claim model 派生'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-06 21:36:44
priority: P0
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-03]
decision_ids: []  # (预填源未就绪：plan 阶段后跑 prefill-refresh)
allowed_paths:
  - backend/app/modules/daemon/session/service/
target_files:
  - backend/app/modules/daemon/session/service/inject_gates.py
  - backend/app/modules/daemon/session/service/create.py
goal: >
  会话选模型链（FR-03）：model 三态语义（None 不动 / 空串重置 / 非空选模）不变，非空时校验
  所选 ∈ 供应商 models 列表（不在 → 422 带可用模型提示）；effective_model 与 claim payload
  的 model 派生全部切「会话所选 ?? 主模型派生」口径（四旧列读清零，N-2）。
implementation:
  - backend/app/modules/daemon/session/service/inject_gates.py 选模型校验（:577-585 解析后）：selected_model 非 None 且非空串时校验 ∈ 当前生效供应商 models 条目 name 集——不在列表 → 422（新异常类或复用 DaemonSessionConfigInvalid，details 与文案列出该供应商可用模型名）；供应商 models 为空列表 → 同 422 文案引导先配模型（R-05）；空串重置语义不触发校验（走原重置分支）
  - inject_gates.py effective_model 派生（:619-635）：provider_original 分支读 effective_provider.model 或 default_fallback_model（:620-625）与 provider_changed 分支读 provider_row.model 或 default_fallback_model（:628-632）两处，改 import 复用 task-03 的 derive_primary_model（传行 .models）；prior_model 分支（会话快照沿用）不动
  - inject_gates.py claim payload 口径：payload 级 model = 会话所选 ?? 主模型派生——providerConfig 内两键同值折算已由 task-04 resolve 层完成，本卡保证 effective_model 与该口径一致（R-07 快照同步覆写链行为不变）
  - backend/app/modules/daemon/session/service/create.py 创建链（:666-676）：config_snapshot 的 model 派生（model or 供应商主模型）改 derive_primary_model(llm_provider_row.models)；创建请求即带 model 时做同款 ∈ 列表 422 校验（若创建入口不收 model，grep 复核后在卡内记录免改）
  - grep backend/app/modules/daemon/session/service/ 清零 .model_role_mappings / .default_fallback_model / .multimodal 旧列属性读（config_snapshot 字典键与 lease metadata 键不算旧列读，注意区分）
  - 422 异常文案带可用模型提示（如「所选模型不在该供应商模型列表，可用：a、b、c」），空列表文案引导「先在供应商配置中添加模型」
acceptance:
  - 会话选不在列表的模型 → 422 且响应含可用模型名提示；选列表内模型 → 生效并写入快照与下发链
  - 空 models 供应商选任意非空模型 → 422 提示先配模型；不选模型（None 或空串）→ 不校验，走不动/重置语义
  - effective_model 派生口径全部为主模型派生（sonnet 首条 ?? 列表首条），grep inject_gates.py / create.py 无四旧列属性读残留
  - model 三态语义回归：None 不动、空串重置、非空选模三分支行为与现状一致（仅取值来源切列表派生）
verify:
  - cd backend && uv run pytest app/modules/daemon/tests -q --no-cov -k "provider_switch or provider_config or session_config"（相关域回归，存量旧断言红属预期，422 用例归 task-07）
  - grep -n "\.model_role_mappings\|\.default_fallback_model\|\.multimodal" backend/app/modules/daemon/session/service/inject_gates.py backend/app/modules/daemon/session/service/create.py（期望零命中）
constraints:
  - MUST NOT 改 sillyhub-daemon 仓任何文件
  - 非空校验 MUST 422 不静默降级（对齐 agent_kinds 集合校验先例 inject_gates.py:556）；空串重置与 None 不动语义 MUST NOT 变
  - 主模型派生 MUST import task-03 helper（不得内联再写）；MUST NOT 动 attachments.py（task-05）与 context.py（task-04）
  - 本卡不修测试不新增测试（选模型 422 用例归 task-07）；禁止跑全量测试（规则 0）
  - 允许路径为 daemon/session/service/ 目录（grep 复核发现同目录其它旧列读文件时一并修复并记录）
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
