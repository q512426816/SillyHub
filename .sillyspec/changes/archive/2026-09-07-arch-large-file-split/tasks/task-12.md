---
id: task-12
title: 'backend-stage-acceptance-tests-ruff-openapi-zero-diff-line-count'
title_zh: 'Wave2 验收——backend 定向测试全绿（daemon/tests 相关子集）+ ruff + openapi.json 零 diff + 行数核查'
author: 'qinyi'
created_at: 2026-09-07 08:48:02
priority: P0
low_risk: true
depends_on: ['task-07', 'task-11']
blocks: []
requirement_ids: [FR-06, FR-03]
decision_ids: [D-006@v1, D-003@v1]
allowed_paths:
  - backend/app/main.py
  - backend/app/modules/daemon/router/__init__.py
  - backend/app/modules/daemon/session/service/__init__.py
  - backend/app/modules/daemon/group/service/__init__.py
  - backend/app/modules/daemon/run_sync/service/__init__.py
  - backend/openapi.json
goal: >
  backend 阶段验收门——以定向测试全绿、ruff、openapi.json 零 diff 与行数核查证明 Wave2 拆分行为零变化，全部通过才放行进入 Wave3 frontend（FR-03 顺序门控）。
implementation:
  - 只读验收不改实现代码，从 app/main.py 与四个包的 __init__ 验证导入路径与路由挂载关系原样
  - 跑 ruff 与 daemon/tests 定向子集，任何失败回对应拆分任务修复后重跑本门
  - 重跑 scripts/dump_openapi.py 导出 openapi.json，与拆分前已提交基线对比要求零 diff（R-05 直接验收证据）
  - wc -l 核查四个包全部新子模块 ≤800 行、三个 service 类壳与 router/__init__ ≤2500 行（D-005@v3）
  - git diff 核查在途 4 个 backend 排除文件与全部既有测试文件零改动
acceptance:
  - app/modules/daemon/tests 定向子集全绿且零测试文件修改，uv run ruff check app 通过（D-006 硬验收）
  - openapi.json 拆分前后零 diff
  - 新子模块全部 ≤800 行，类壳与 __init__ ≤2500 行
  - 在途排除的 protocol.py、runtime/service.py、ws_hub.py、lease/context.py 及既有测试文件 git diff 为空
verify:
  - cd backend && uv run ruff check app
  - cd backend && uv run pytest app/modules/daemon/tests -q --no-cov -n auto
  - cd backend && uv run python scripts/dump_openapi.py && git diff --exit-code openapi.json
  - cd backend && wc -l app/modules/daemon/router/*.py app/modules/daemon/session/service/*.py app/modules/daemon/group/service/*.py app/modules/daemon/run_sync/service/*.py
constraints:
  - 只读验收任务，禁止借机修代码或修测试，问题回对应拆分任务修
  - 禁止跑全量测试，仅跑 daemon/tests 定向子集（CLAUDE.md 规则 0，全量留给 CI）
  - 本门不通过则阻断 Wave3 启动（FR-03 顺序门控语义）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
