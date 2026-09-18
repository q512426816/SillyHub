---
id: task-03
title: 'create-menu-overrides-migration-with-seed'
title_zh: '迁移：建 menu_overrides 表 + 种子（4 新权限 key 授全部现存角色）'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-09-18 14:46:09
priority: P0
depends_on: ['task-01', 'task-02']
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/migrations/versions/
target_files:
  - NEW:backend/migrations/versions/20260918150000_create_menu_overrides.py
expects_from:
  - task-01 提供 contract Permission 四个菜单读权限枚举成员 SKILL_READ、MCP_READ、AGENT_PROFILE_READ、AGENT_SESSION_READ（字符串值 skill:read、mcp:read、agent_profile:read、agent_session:read）
goal: >
  新建迁移建 menu_overrides 表并把 4 个新权限 key 幂等授给全部现存角色，保证上线后 4 个常显菜单可见性与现状一致。
implementation:
  - 新建迁移文件，down_revision 接写码时实测唯一 head（当前为 20260917160000），upgrade 用 op.create_table 建 menu_overrides 且字段与 task-02 模型一一对应（menu_key 唯一约束），downgrade 反向删表
  - 种子用类型化 sa.table 桩 SELECT 全部现存 roles.id（含 disabled 角色，不筛 is_active），把 4 个新权限字符串字面量插入 role_permissions，先判存再 bulk_insert 保幂等（范式同 20260917104400）
  - 权限字符串在迁移内硬编码不 import 应用代码；downgrade 先显式删除 4 个权限的全部授权行再删表，roles 本体与其它权限不动
acceptance:
  - upgrade 后表结构字段与 MenuOverride 模型一致且 menu_key 唯一
  - 每个现存角色（含 disabled）各获得 4 个新权限恰好一行，重跑 upgrade 不重复，其它权限行零变化
  - downgrade 可完整回退（4 个权限授权行清空、表删除、roles 本体不动）
verify:
  - cd backend && uv run alembic upgrade head
  - cd backend && uv run ruff check migrations/versions/20260918150000_create_menu_overrides.py
constraints:
  - 种子直插 role_permissions，不调 Redis 与 invalidate_all_permissions，权限缓存按 TTL 300 秒自愈（R-02）
  - 迁移幂等不依赖 ON CONFLICT，兼容 PG 与 SQLite 双方言，数据依赖型 SELECT 仅支持 online upgrade（同既有先例取舍）
  - 种子覆盖全部现存角色含 disabled（无害保现状）；无任何角色的存量用户为例外已记 R-07
  - 代码兼容 Windows、Linux 和 macOS
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
