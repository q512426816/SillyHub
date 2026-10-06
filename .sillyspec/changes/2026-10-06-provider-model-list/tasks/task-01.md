---
id: task-01
title: '迁移——models JSON 列 + 存量折算回填（Python 侧四形态）+ 四旧列删除 + 对称 downgrade'
title_zh: '迁移——models JSON 列 + 存量折算回填（Python 侧四形态）+ 四旧列删除 + 对称 downgrade'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-06 21:36:44
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-05]
decision_ids: []  # (预填源未就绪：plan 阶段后跑 prefill-refresh)
allowed_paths:
  - backend/migrations/versions/
  - backend/app/modules/llm_provider/model.py
target_files:
  - NEW:backend/migrations/versions/20261006200000_provider_models.py
  - backend/app/modules/llm_provider/model.py
goal: >
  llm_providers 表把 model / model_role_mappings / multimodal / default_fallback_model 四旧列收敛为
  models JSON 条目列（D-001/D-005）：迁移内 Python 侧把三源存量折算成条目列表回填（D-004，FR-05）、
  删四旧列、提供对称 downgrade；同步 model.py 列定义。项目未上线不留双列（规则 11）。
implementation:
  - 新建 NEW:backend/migrations/versions/20261006200000_provider_models.py：revision="20261006200000"，down_revision 挂执行时 alembic 唯一当前 head（以 alembic heads 实查为准，目录存在多个 merge_heads 文件不凭记忆写死；姊妹迁移先例 backend/migrations/versions/20261006120000_provider_agent_kinds.py）
  - upgrade 顺序（SQLite 用 batch_alter_table 重建表语义，先例 20261006120000_provider_agent_kinds.py）：第①步 batch_alter_table 加 models JSON NOT NULL 列（已有数据的表加 NOT NULL 需 server_default 文本 '[]' 占位）→ 第②步 Python 侧折算回填（R-01：去重+角色归并 SQL 表达不了，op.get_bind() 逐行 SELECT 旧行、算出条目列表后逐行 UPDATE models 列）→ 第③步 batch_alter_table 删 model / model_role_mappings / multimodal / default_fallback_model 四旧列
  - 折算算法（D-04 口径逐条）：候选模型名集合 = 旧 model 值 + default_fallback_model 值 + model_role_mappings 四槽（sonnet/opus/fable/haiku）各自的 model 值，非空去重保序（Grill P1-2 补 fallback 值——只配 fallback 未配 model 的存量行折算后列表不能为空）；每个候选名生成一条「name + multimodal 置 auto + roles 空列表 + one_m 置 false」的条目；随后按槽归并——槽的 model 值命中某条目时该条目 roles 追加该角色、one_m 透传槽值；同一模型被多角色槽指向且 one_m 冲突时取 true 优先（与 tasks.md task-07 写死口径一致）；三源全空的供应商回填空列表（服务层允许空列表）
  - 旧供应商级 multimodal 显式标记不映射（粒度已下沉到条目级，auto 交启发式兜底——D-004 接受的行为变化点，design 兼容策略节；旧 display 槽字段随旧列整体丢弃）
  - downgrade 对称（可回退）：batch_alter_table 重建四旧列（model 与 default_fallback_model = sonnet 角色首条条目 ?? 列表首条 ?? NULL；model_role_mappings 由条目 roles+one_m 反折四槽、每槽为含 model 与 one_m 两键的子字典；multimodal 置 'auto'）→ 回填完成后再删 models 列
  - 同步 backend/app/modules/llm_provider/model.py：删 :63 model、:70 multimodal、:95 model_role_mappings、:99 default_fallback_model 四个 Field 定义，加 models list[dict] JSON 列（nullable=False，JSON 导入沿用文件顶部既有）；模块 docstring :12 同步改写（旧三字段语义已并入 models 条目）
  - 迁移文件 docstring 记明折算候选三源、one_m 冲突取 true、四旧列删除依据与不留双列（design 数据模型节 / 规则 11）
acceptance:
  - NEW:backend/migrations/versions/20261006200000_provider_models.py 存在，revision=20261006200000 且 down_revision 等于执行时 alembic heads 的唯一 head
  - alembic upgrade head 执行成功：llm_providers 表 models JSON NOT NULL 列在位，model / model_role_mappings / multimodal / default_fallback_model 四旧列全部不存在
  - 存量折算四形态正确（D-004）：单模型供应商折算为单条目且原 model 值在首位；四槽指向不同模型时列表去重保序且各条目 roles 归并正确；槽 one_m 值透传到对应条目（同模型多角色 one_m 冲突取 true 优先）；空供应商折算为空列表
  - 只配 default_fallback_model 未配 model 的存量行折算后列表非空且含 fallback 值（Grill P1-2）
  - alembic downgrade -1 后再 alembic upgrade head 往返一致：四旧列恢复（model 与 default_fallback_model 等于主模型派生值、model_role_mappings 反折四槽、multimodal 为 auto）
  - backend/app/modules/llm_provider/model.py 无四旧字段残留，models 列定义与迁移终态一一对应（model.py:8 既有列定义与迁移一一对应惯例）
verify:
  - cd backend && uv run alembic upgrade head
  - cd backend && uv run alembic downgrade -1 && uv run alembic upgrade head
  - grep -n "model_role_mappings\|default_fallback_model\|multimodal" backend/app/modules/llm_provider/model.py（期望零命中）
constraints:
  - MUST NOT 改 sillyhub-daemon 仓任何文件（全局红线：injector 消费键形态逐字保持）
  - MUST NOT 留旧列与 models 列并存（规则 11 无历史兼容）；折算候选集 MUST 含旧 model + default_fallback_model + 四槽值三源去重保序
  - 不新增测试用例（迁移折算四形态用例归 task-07 的 test_provider_models_migration.py）；本卡 verify 以 alembic 升降级往返 + grep 清零为准，禁止跑全量测试（CLAUDE.md 规则 0）
  - model.py 只改列定义与 docstring，不动 DTO/服务逻辑（schema/service 归 task-02/03，按 depends_on 串行）
  - 迁移代码 Windows/Linux/macOS 三平台兼容（规则 13：纯 alembic op + Python 折算循环，无平台 shell 调用）
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
