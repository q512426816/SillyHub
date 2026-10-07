---
id: task-04
title: '注入折算——context.py 两处 resolve：两键同值（会话所选??主模型）+ model_role_mappings 折算形态逐字 + models 新键'
title_zh: '注入折算——context.py 两处 resolve：两键同值（会话所选??主模型）+ model_role_mappings 折算形态逐字 + models 新键'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-06 21:36:44
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-01, FR-04]
decision_ids: []  # (预填源未就绪：plan 阶段后跑 prefill-refresh)
allowed_paths:
  - backend/app/modules/daemon/lease/context.py
target_files:
  - backend/app/modules/daemon/lease/context.py
goal: >
  注入折算（FR-04 契约保持）：context.py 两处 resolve 构造的 provider_config 从旧列读取切为
  models 条目折算——model 与 default_fallback_model 两键同值 = 会话所选 ?? 主模型、
  model_role_mappings 键形态与 daemon injector 消费面逐字一致、新增 models 原始列表键；
  daemon 仓零改动（R-02 P1）。
implementation:
  - 新增文件内折算 helper（如 _fold_role_mappings(models)）：由条目列表反折角色映射——遍历条目，条目 roles 中的每个角色指向该条目的 model 与 one_m 两键子字典；同一角色多条条目时取首条（注入取首条口径）；无条目标该角色时该角色键缺省（daemon 规则4 仅注入存在的键）。主模型派生 MUST import 复用 task-03 的 derive_primary_model（口径单一，不另写一份）
  - resolve_default_provider_config（backend/app/modules/daemon/lease/context.py:67）：openai_chat 分支（:117-133）model 键改 derive_primary_model(provider.models)；anthropic 分支（:138-150）三处替换——model 与 default_fallback_model 两键同值 = derive_primary_model(provider.models)、model_role_mappings 改 _fold_role_mappings(provider.models)、新增 models 键 = provider.models 原始条目列表
  - resolve_bound_provider_config（:153-222）：openai_chat 分支（:193-207）model 键同改；anthropic 分支（:212-222）与 default 侧逐字同口径四键折算（两处构造逻辑刻意复制的既有约定，docstring :170-175 口径一致说明同步更新）
  - 会话所选优先的覆写链保持不动：daemon/session/service/attachments.py:440-446 组装点已同时覆写 model 与 default_fallback_model 两键（Grill P1-1 核正的 injector 规则3 fallback 优先对齐点）——该文件归 task-05 门控透传改，本卡不碰
  - 空列表供应商：derive_primary_model 返回 None → model 与 default_fallback_model 两键值为 None（injector 规则3 两者皆空不写 ANTHROPIC_MODEL 语义保持）；models 键仍下发空列表
  - docstring 更新两处 resolve 的 provider_config 键说明（models 键新增 + 三折算键口径；agent/schema.py 的 provider_config DTO 文档串对齐归 task-09 gen:types 时核对，本卡不动）
  - grep backend/app/modules/daemon/lease/context.py 清零 provider.model / provider.model_role_mappings / provider.default_fallback_model 旧列读
acceptance:
  - anthropic 形态 provider_config 四键正确：models = 原始条目列表；model 与 default_fallback_model 两键同值 = 主模型派生（sonnet 首条 ?? 列表首条）；model_role_mappings 形态与 sillyhub-daemon/src/credential-injector.ts 规则3/4 消费面（:211-219）逐字一致——每角色一个含 model 与 one_m 两键的子字典，sonnet 取首条标记者
  - openai_chat 形态 provider_config 的 model 键 = 主模型派生（litellm_model_name 等其余键不变）
  - 空列表供应商两键为 None、models 为空列表；同角色多条条目时 model_role_mappings 取首条
  - sillyhub-daemon 仓 git diff 为零（R-02 daemon 消费键形态漂移即 P1 返工）
  - 既有 resolve 相关测试旧断言失效属预期，契约逐字断言更新归 task-07
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_resolve_default_provider_config.py app/modules/daemon/tests/test_resolve_bound_provider_config.py tests/modules/daemon/lease/test_provider_config_payload.py -q --no-cov（旧断言红属预期，逐字契约断言归 task-07）
  - grep -n "provider\.model_role_mappings\|provider\.default_fallback_model" backend/app/modules/daemon/lease/context.py（期望零命中；provider.model 裸属性读一并人工核对清零）
  - git -C sillyhub-daemon status --porcelain（期望空输出，daemon 仓零改动）
constraints:
  - MUST NOT 改 sillyhub-daemon 仓任何文件（injector 消费键 model / default_fallback_model / model_role_mappings 形态逐字保持，全局红线）
  - provider_config 的 model 与 default_fallback_model 两键 MUST 同值（会话所选覆写点在外层组装链 attachments.py:440-446，本卡 resolve 层发主模型派生值）
  - MUST NOT 动 capability.py 门控（归 task-05）；MUST NOT 动 inject_gates.py / create.py（归 task-06）；MUST NOT 动 attachments.py（归 task-05）
  - 主模型派生 MUST import task-03 helper，MUST NOT 在 context.py 内再写一份派生逻辑（口径漂移即 R-05 复发）
  - 本卡不修测试不新增测试（注入契约逐字断言归 task-07）；禁止跑全量测试（规则 0）
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
