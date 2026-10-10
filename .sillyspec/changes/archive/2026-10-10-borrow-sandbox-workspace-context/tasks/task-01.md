---
id: task-01
title: 'backend placement 借用上下文 loader + 三标记点写 borrow_workspace_context + 借用集成测试扩展（含空 dict 归一 None、Workspace 模型字段存在性核验）'
title_zh: 'backend placement 借用上下文 loader + 三标记点写 borrow_workspace_context + 借用集成测试扩展（含空 dict 归一 None、Workspace 模型字段存在性核验）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-10 15:56:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001@v1, D-002@v1, D-005@v1]
allowed_paths:
  - backend/app/modules/agent/placement.py
  - backend/app/modules/agent/tests/test_placement_borrow_integration.py
  - backend/app/modules/workspace/model.py
target_files:
  - backend/app/modules/agent/placement.py
  - backend/app/modules/agent/tests/test_placement_borrow_integration.py
provides:
  - contract: borrow_workspace_context
    fields: [name, display_alias, slug, description, type, tech_stack, repo_url, default_branch, root_path]
goal: >
  backend 借用派发时把工作区上下文（含真实 root_path）写入 lease metadata 单键
  borrow_workspace_context，让借用沙箱会话有可透传给 daemon 的工作区数据源。
implementation:
  - 核验 Workspace 模型字段存在性：backend/app/modules/workspace/model.py:33 的
    Workspace 行含 name/display_alias/slug/description/type/tech_stack/repo_url/
    default_branch/root_path 列（审查 P3-b 备忘；缺列字段从字段集移除并在卡内记录）
  - placement.py 新增模块级 async loader _load_borrow_workspace_context(session,
    workspace_id)——session.get(Workspace, workspace_id) 查行，取字段集内非 None
    值组装 dict；行缺失/异常返回 None（best-effort，对齐 _insert_borrow_audit_row
    失败语义，backend/app/modules/agent/placement.py:183）
  - 空 dict 归一为 None（审查 P3-a 备忘——全字段 None 时返回 None 而非 {}，
    保证「真值守护」语义一致）
  - _stamp_borrow_sandbox_metadata 增第 4 参 workspace_context（dict 或 None，
    缺省 None）；非 None 时 metadata 增加 borrow_workspace_context 键
    （backend/app/modules/agent/placement.py:139）
  - 三调用点接线（borrowed 分支、_insert_borrow_audit_row 旁）：
    dispatch_to_daemon :512 / prepare_interactive_dispatch :934 / scan :1096，
    均 workspace_id is not None 守护下先查 loader 再传参
  - 测试扩展 test_placement_borrow_integration.py：三标记点各加断言
    metadata.borrow_workspace_context 存在且字段与 seed Workspace 行一致（AC8
    先例 test_ac8_dispatch_borrow_writes_sandbox_marker:701）；补 Workspace 行
    缺失场景（无键不抛）；补空字段行（归一 None 无键）；非借用场景无新键
acceptance:
  - 三标记点借用 lease metadata 含 borrow_workspace_context，字段集=
    design 总体方案字段集，None 值字段不落键
  - Workspace 行缺失/全 None 字段 → 不写键且派发不抛错
  - 非借用 lease metadata 无 borrow_workspace_context 键（零回归）
verify:
  - cd backend && uv run pytest -q --no-cov app/modules/agent/tests/test_placement_borrow_integration.py
constraints:
  - 不改写 _stamp_borrow_sandbox_metadata 既有 cwd marker 行为（D-002@v1 单键
    附加，marker 逻辑逐字节不变）
  - loader 失败不得阻塞借用派发（对齐审计 best-effort 语义）
  - 不动 context.py（task-02 专属）
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
