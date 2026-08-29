---
id: task-08
title: 'gen-types-sync-and-four-path-integration-regression'
title_zh: '三端 gen:types 收口 + 集成回归四路径'
author: 'qinyi'
created_at: 2026-08-29 15:04:03
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05]
decision_ids: [D-004@v1, D-006@v1]
allowed_paths:
  - backend/openapi.json
  - sillyhub-daemon/src/api-types.ts
  - frontend/src/lib/api-types.ts
  - sillyhub-daemon/tests/integration/selfupdate-scenarios.test.ts
goal: >
  三端类型生成物收口（openapi 再导出+双端 gen:types 幂等）并以四路径集成用例
  （忙推迟/终检回推迟/磁盘直启/pending 可见性闭环）端到端锁定 SELF_UPDATE 安全层语义。
implementation:
  - backend openapi 再导出（既有 dump_openapi.py 惯例）→ sillyhub-daemon 与 frontend 各跑 pnpm gen:types（产物幂等无手改，三生成文件一并入卡）
  - 新增 tests/integration/selfupdate-scenarios.test.ts（node 环境全 fake 编排，目录已存在）四路径用例
  - 路径一 忙到升级：fake session status running → SELF_UPDATE 触发推迟+pending 写入 → 30s 定时器（fake timers）→ 转空闲重探走下载链到 respawn 断言
  - 路径二 终检回推迟：fake runDaemonSelfUpdate resolve 后注入新忙 → stop 前终检拦下 → 回推迟路径且未 stop
  - 路径三 磁盘直启：fake onDiskChange 触发 → disk_change 分流不经 runDaemonSelfUpdate（零调用断言）直接 stop+respawn 到盘上版本
  - 路径四 pending 可见性闭环：pending 写入 → 心跳 body 携带字段 → clearPendingUpdate 后心跳不含字段
  - 对照 module-impact.md 更新结果表核对回填
acceptance:
  - 四路径集成用例全绿（推迟重探执行链/终检不打断/直启零下载/心跳字段闭环各有断言）
  - 三生成文件重跑 gen:types 哈希不变（幂等），git status 无 diff 残留
  - module-impact 更新结果表核对完成
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/integration/selfupdate-scenarios.test.ts
  - git status 检查 backend/openapi.json 与两 api-types.ts 已更新且再跑 gen:types 无 diff
constraints:
  - 遵守 CLAUDE.md 规则 0 禁全量测试，仅跑本变更相关用例，全量留 CI
  - gen:types 前确认前端 node_modules 健康（tsc --version 可跑，半坏先 install --force）
  - 生成文件禁手改；fake timers/注入模式合规不真实等待
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
