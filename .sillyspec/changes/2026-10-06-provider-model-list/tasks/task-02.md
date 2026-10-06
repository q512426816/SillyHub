---
id: task-02
title: '模型/DTO——model.py 删四旧字段加 models 列；schema.py ProviderModelEntry（name/multimodal 三态/roles 值域/one_m）+ 三 DTO 退役 default_fallback_model 加 models'
title_zh: '模型/DTO——model.py 删四旧字段加 models 列；schema.py ProviderModelEntry（name/multimodal 三态/roles 值域/one_m）+ 三 DTO 退役 default_fallback_model 加 models'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-06 21:36:44
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: []  # (预填源未就绪：plan 阶段后跑 prefill-refresh)
allowed_paths:
  - backend/app/modules/llm_provider/
target_files:
  - backend/app/modules/llm_provider/schema.py
goal: >
  DTO 层定型模型条目结构（单一真相，FR-01/FR-02）：schema.py 新增 ProviderModelEntry 子模型
  （name 必填、multimodal 三态、roles 值域、one_m），Create/Update/Read 三 DTO 加 models 字段，
  四旧字段（model/model_role_mappings/multimodal/default_fallback_model）从三 DTO 退役——
  为 task-03 服务层、task-04 注入折算、task-08/09 前端提供契约。
implementation:
  - 复核 backend/app/modules/llm_provider/model.py 已由 task-01 完成列切换（四旧 Field 删、models JSON 列在位）；若有遗漏仅补列定义，不动其它逻辑
  - backend/app/modules/llm_provider/schema.py 新增 ProviderModelEntry 子模型：name str 必填（field_validator strip 后非空，防纯空白）；multimodal Literal 三态枚举（auto/true/false）缺省 auto；roles 为 Literal 枚举列表（值域 sonnet/opus/fable/haiku）缺省空列表，值域外 422；one_m bool 缺省 false
  - LlmProviderCreate（schema.py:15）加 models 字段，类型为 ProviderModelEntry 列表，缺省空列表（允许空列表供应商，会话选模型时由 task-06 提示先配模型）
  - LlmProviderUpdate（schema.py:69）加 models 字段，类型为 ProviderModelEntry 列表可空，None 或缺省 = 不动已有列表（与 Update 其它字段 exclude_unset 语义一致）
  - LlmProviderRead（schema.py:99）加 models 字段（from_attributes 直映射新列；空列表也出键）
  - 三 DTO 删除四旧字段：Create 侧 :27 model、:36 model_role_mappings、:37 default_fallback_model、:42 multimodal；Update 侧 :73/:83/:84/:88 同名四字段；Read 侧 :107/:112/:113/:122 同名四字段（default_fallback_model 退役依据 design Wave1-1 Grill P1-2——其兜底语义与主模型派生重合）
  - 同角色多条模型（如两条都标 sonnet）不拒——加提示性说明（docstring 注明注入取该角色首条，design 总体方案宽容口径：用户可能故意配备胎）
  - schema 模块 docstring 更新条目结构与三态语义（consumer = Read 响应 + task-04 注入折算 + task-05 门控）
acceptance:
  - ProviderModelEntry 校验：name 缺失或纯空白被拒；multimodal 传三态外值（如 yes）被拒；roles 传值域外角色（如 vanguard）被拒；one_m 缺省 false、multimodal 缺省 auto、roles 缺省空列表
  - Create 不传 models 可创建（缺省空列表）；Update 不传 models 或传 None 不动已有列表
  - grep 三 DTO 无 model / model_role_mappings / multimodal / default_fallback_model 旧字段残留（schema.py 内 ProviderModelEntry 自身的 name/multimodal/roles/one_m 键除外）
  - Read 实例化输出 models 键，条目四键齐全（缺省值补全为 auto、空 roles、false）
verify:
  - cd backend && uv run python -c "from app.modules.llm_provider.schema import ProviderModelEntry; e = ProviderModelEntry(name='glm-5.3'); print(e.multimodal, e.roles, e.one_m)"
  - grep -n "default_fallback_model\|model_role_mappings" backend/app/modules/llm_provider/schema.py（期望零命中）
  - cd backend && uv run pytest app/modules/llm_provider/tests -q --no-cov（模块域回归；存量旧字段断言失效属预期，修复统一归 task-07）
constraints:
  - MUST NOT 改 sillyhub-daemon 仓任何代码
  - MUST NOT 在 Read/Create/Update 保留四旧字段键（无过渡期，规则 11）；openapi.json 与前端 api-types 再生成归 task-09，本卡后端先行
  - MUST NOT 动 service.py / router.py / litellm_client.py（服务层与三消费点归 task-03）；MUST NOT 动 fetch-models 段（schema.py:132 起，返回形态不变）
  - schema.py 与 model.py 列口径 MUST 一致（列 nullable=False ↔ Create 缺省空列表由服务层落值）；同角色多条 MUST NOT 拒（宽容口径）
  - 既有测试断言失效更新统一归 task-07，本卡不修测试不新增测试
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
