---
id: task-02
title: 'backend git_log 模块骨架（router/service/schema + main.py 挂载 + 权限门控 + 错误映射 + local.yaml modules 补 git_log 映射）'
title_zh: 'backend git_log 模块骨架（router/service/schema + main.py 挂载 + 权限门控 + 错误映射 + local.yaml modules 补 git_log 映射）'
author: 'qinyi'
created_at: 2026-08-25 21:37:20
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-05, FR-07]
decision_ids: [D-002@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/git_log/__init__.py
  - backend/app/modules/git_log/router.py
  - backend/app/modules/git_log/service.py
  - backend/app/modules/git_log/schema.py
  - backend/app/main.py
  - .sillyspec/local.yaml
goal: >
  新建 backend git_log 只读查询模块骨架（仿 explorer 四件套先例，D-002 方案 A）——三 GET 端点 + WORKSPACE_READ 门控 + 模块本地 AppError 错误族 + 显式超时常量 + §7.4 响应 schema，挂载进 main.py 并补 local.yaml modules 映射。
provides:
  - contract: GitLogModule
    fields:
      - GitLogCommitsResponse
      - GitLogCommitDetailResponse
      - GitLogDiffResponse
      - AppError错误族(404/403/502/504/422)
      - RPC超时常量
      - '字段细目（§7.4）——git_mode 两态 git/no_git、commits 含 seq 全局绝对序/lane/edges/refs、top-level branches 全量分支、head、has_more、total_in_window、files 含 path/add/del/binary、diff/truncated/binary'
implementation:
  - 新建 git_log 四件套骨架——router.py 三 GET 端点（commits 列表 / commits 详情 / commits 单文件 diff）均 require_permission(Permission.WORKSPACE_READ) 门控，依赖与前缀形态照抄 explorer/router.py
  - service.py 落模块本地 AppError 错误族（未绑定 404 / forbidden 403 / offline 502 / timeout 504 / method_not_found 422 中文文案）与三档显式超时常量（log/show/diff 各 30s，Final 常量对齐 explorer/service.py）；方法体本 task 可占位，数据链路完整化归 task-04
  - schema.py 按 §7.4 写全三响应模型（producer=service 组装 → FastAPI JSON → consumer=前端 pnpm gen:types）
  - main.py 追加 include_router 一行（对齐 explorer 挂载约定）
  - local.yaml modules 块末尾补 git_log 映射一行（对齐 ppm/runtime 既有条目形态）——path 取 backend/app/modules/git_log/，test 取 cd backend && uv run pytest app/modules/git_log -q --no-cov -n auto（Plan Review I-1，防 verify 模块对账 fallback 全量）
acceptance:
  - backend 启动后 OpenAPI 出现三个 git-log 端点且全部要求 WORKSPACE_READ 权限
  - service 含完整错误族（404/403/502/504/422）与三个 30s 超时常量，可 grep 到且文案为中文
  - local.yaml modules 含 git_log 条目，键值形态与 ppm 等既有条目一致
  - schema 三模型字段与 design §7.4 逐字段一致（git_mode 两态 / branches 全量 / seq 全局序语义）
verify:
  - cd backend && uv run ruff check app/modules/git_log && uv run ruff format --check app/modules/git_log && uv run pytest app/modules/git_log -q --no-cov -n auto
constraints:
  - 只落骨架，数据链路（绑定解析/RPC 转发/probe 映射/refs 合并）与集成测试归 task-04
  - 不改 explorer 模块与既有端点；local.yaml 仅追加 git_log 一行不动既有条目；无 DB 模型/迁移（纯只读，D-003）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
