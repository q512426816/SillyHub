---
id: task-03
title: '服务层——create/update/_to_read + probe(:358)/quota(router:151)/litellm register(:84) 三消费点切主模型派生'
title_zh: '服务层——create/update/_to_read + probe(:358)/quota(router:151)/litellm register(:84) 三消费点切主模型派生'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-06 21:36:44
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-01]
decision_ids: []  # (预填源未就绪：plan 阶段后跑 prefill-refresh)
allowed_paths:
  - backend/app/modules/llm_provider/
target_files:
  - backend/app/modules/llm_provider/service.py
  - backend/app/modules/llm_provider/router.py
  - backend/app/modules/llm_provider/litellm_client.py
goal: >
  服务层与三个读旧列的消费点切换到 models 列表口径（FR-01 落库链路）：create/update/_to_read
  改赋 models；probe（service.py:358）/ quota（router.py:151）/ litellm register（litellm_client.py:84）
  三处读 row.model 或 provider.model 的点全部切「主模型派生」（N-2：四旧列删除后这些点是
  AttributeError 爆点），并提供模块级主模型派生 helper 供 task-04/06 复用同一口径。
implementation:
  - backend/app/modules/llm_provider/service.py 新增模块级主模型派生 helper（如 derive_primary_model(models) -> str | None）：sonnet 角色首条 ?? 列表首条 ?? None（R-05 规则显式；空列表返回 None）；docstring 注明口径与消费方（probe/quota/litellm + task-04 注入折算 + task-06 会话链 import 复用，避免多处口径漂移）
  - service.py create（:219-229）：data.model / data.model_role_mappings / data.default_fallback_model / multimodal 四行赋值删除，改 models=data.models（条目经 task-02 pydantic 校验后整体落列）
  - service.py update（:251-273）：四旧键的 updates 处理删除（含 :271-273 multimodal 显式 None 不覆盖分支）；updates 含 models 且非 None 时整体替换列表
  - service.py _to_read：models 透传，四旧字段读取删除
  - service.py probe 链 :358：row.model 取值改 derive_primary_model(row.models)
  - backend/app/modules/llm_provider/router.py quota 链 :151：query_zhipu_quota 的 model 实参改 derive_primary_model(row.models)（N-2：row.model 列已删，漏改即 AttributeError）
  - backend/app/modules/llm_provider/litellm_client.py :84：raw_model 取值改 derive_primary_model(provider.models)，缺省哨兵 or "gpt-3.5-turbo" 保留（Grill P1-4）
  - fetch_models 返回形态不动（前端拉取后自加行，design 文件清单）；probe/quota 的其余逻辑不动
  - grep backend/app/modules/llm_provider/ 清零四旧列属性读残留（row.model / provider.model / .model_role_mappings / .default_fallback_model / .multimodal）
acceptance:
  - derive_primary_model 口径：列表含 sonnet 角色条目时取 sonnet 首条；无 sonnet 标记时取列表首条；空列表返回 None
  - create 落库 models 为传入条目列表；update 不传 models 不动列表、传新列表整体替换；Read 响应含 models
  - probe / quota / litellm register 三链在四旧列删除后不再读旧列（grep 零命中），取值均为主模型派生
  - cd backend && uv run pytest app/modules/llm_provider/tests 模块域跑通（存量旧字段断言失效属预期，修复统一归 task-07）
verify:
  - cd backend && uv run pytest app/modules/llm_provider/tests/test_probe.py app/modules/llm_provider/tests/test_quota.py app/modules/llm_provider/tests/test_litellm_client.py -q --no-cov
  - grep -rn "\.model_role_mappings\|\.default_fallback_model\|\.multimodal" backend/app/modules/llm_provider/（期望零命中；row.model / provider.model 裸属性读一并人工核对清零）
  - cd backend && uv run python -c "from app.modules.llm_provider.service import derive_primary_model; assert derive_primary_model([{'name':'a','roles':['sonnet'],'one_m':False},{'name':'b','roles':[],'one_m':False}]) == 'a'; assert derive_primary_model([{'name':'b','roles':[],'one_m':False}]) == 'b'; assert derive_primary_model([]) is None; print('ok')"
constraints:
  - MUST NOT 改 sillyhub-daemon 仓任何代码
  - MUST NOT 动 fetch_models 逻辑与返回形态；MUST NOT 动 openai_chat/pi 组合校验（上一变更已收口）
  - 主模型派生口径 MUST 单一（helper 唯一实现，task-04/06 import 复用不得另写一份）
  - 本卡不修既有测试不新增测试（断言失效修复与折算契约用例归 task-07）；禁止跑全量测试（规则 0）
  - router.py 只动 quota 链一处；其余端点（create/update/delete/set_default）逻辑不动
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
