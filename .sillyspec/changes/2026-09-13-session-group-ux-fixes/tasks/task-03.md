---
id: task-03
title: 'group visible workspace ids backend'
title_zh: '后端群列表可见工作区集合'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-13 00:44:49
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-3]
decision_ids: [D-003@v1, D-004@v1]
allowed_paths:
  - backend/app/modules/daemon/group/service/crud.py
  - backend/app/modules/daemon/group/router.py
  - backend/tests/modules/daemon/
provides:
  - "GET /api/daemon/group-chats 列表项新字段 visible_workspace_ids: list[uuid]（直接归属∪项目关联，去重）"
target_files: [backend/app/modules/daemon/group/service/crud.py, backend/app/modules/daemon/group/router.py, NEW:backend/tests/modules/daemon/test_group_visible_workspaces.py]
goal: >
  群列表端点返回 visible_workspace_ids（直接归属∪项目关联，批量查）。
implementation:
  - crud.py：新增 get_project_workspace_map(session, project_ids) 单条 IN 批量查 PpmProjectWorkspace
  - backend/app/modules/daemon/group/router.py:62：GroupChatListItemRead 加 visible_workspace_ids: list[uuid.UUID] = []
  - router.py 列表端点：_to_list_item 组装后统一填充（去重 [workspace_id] ∪ 项目关联集；照 online_member_ids 端点层组装先例）
  - 后端测试：群挂项目（关联 D/F、锚 D）→ 含 D/F；无项目群=[workspace_id]；非成员不可见不变
acceptance:
  - 群挂多工作区项目时列表项含全部关联工作区
  - 无 project 群仅直接归属
  - 非成员过滤零回归
verify:
  - cd backend && uv run pytest tests/modules/daemon -q --no-cov -k group
constraints:
  - GroupChatRead 本体（agent/schema.py）不加字段
  - 不在 crud.list_groups 组装（DTO 通路进不去）
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
