---
id: task-04
title: 'Deploy: pgvector image + upgrade notes'
title_zh: '部署（镜像替换 + 升级说明）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 21:45:00
priority: P0
depends_on: ["task-01"]
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-008@v1]
allowed_paths:
  - deploy/docker-compose.yml
  - deploy/docker-compose.dev.yml
target_files:
  - deploy/docker-compose.yml
  - deploy/docker-compose.dev.yml
expects_from:
  task-01:
    - contract: pgvector_migration
      needs: [fail_closed_raise, dialect_guard]
goal: >
  生产与 dev 栈的 PG 镜像换 pgvector/pgvector:pg16；升级顺序与验证 SQL 落 design Phase 4 部署节。
implementation:
  - deploy/docker-compose.yml 与 deploy/docker-compose.dev.yml：image postgres:16-alpine → pgvector/pgvector:pg16（其余卷/端口/环境变量不动）
  - design.md Phase 4 部署节核验补全：升级顺序（换镜像重启 PG→alembic upgrade head→重启 backend→首查建库一次）+ 生产验证 SQL
  - 迁移 fail-closed 文案核验：extension 不可用时 raise 文案含镜像修复指引
acceptance:
  - 两 compose 镜像已换且 diff 仅 image 行；部署节含升级顺序与验证 SQL；fail-closed 文案在
verify:
  - grep -n pgvector deploy/docker-compose.yml deploy/docker-compose.dev.yml
constraints:
  - MUST NOT 动卷/端口/其余服务定义
  - dev 与生产 compose MUST 同步
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
