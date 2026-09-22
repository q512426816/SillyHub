---
id: task-11
title: 'Module docs update (change-index entries in backend.md / sillyhub-daemon.md / frontend.md)'
title_zh: '模块文档更新（backend.md / sillyhub-daemon.md / frontend.md 追加变更索引条目）'
author: 'qinyi'
created_at: 2026-09-04 22:40:15
priority: P1
depends_on: ['task-01','task-02','task-03','task-04','task-05','task-06','task-07','task-08','task-09','task-10']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05]
decision_ids: [D-001@v1, D-002@v1, D-003@v1, D-004@v1]
allowed_paths:
  - .sillyspec/docs/multi-agent-platform/modules/backend.md
  - .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md
  - .sillyspec/docs/multi-agent-platform/modules/frontend.md
goal: >
  代码任务（task-01~10）完成后，按三份模块文档「变更索引」既有条目格式各追加一条
  本变更（2026-09-04-conflict-resolve-entry）条目，端点 / 心跳字段 / WS 指令 / 前端卡片
  一句话级摘要，保持模块文档与实现一致。
implementation:
  - backend.md 变更索引追加——两条 POST 端点（owner+平台管理员权限、change 白名单、离线 504）+ 心跳 sillyspec_command_result 两态落库与 register 恒清 + daemon_instances 新列与 alembic 迁移 + 机器视图 MachineSillySpecCommandResultRead 透出
  - sillyhub-daemon.md 变更索引追加——两条 WS 直连 case（不走 control-dispatcher）+ runResolve / runGhostCleanup 执行器（execFile 数组形参、sillyspec_command_timeout_sec 默认 120s、in-flight 串行忙拒）+ _lastCommandResult 10min 终态窗心跳携带（过期停发键不发显式 null）
  - frontend.md 变更索引追加——lib/daemon.ts 两触发函数 + gen:types 读模型 + platform-sync-section 卡片（冲突裁决 / ghost 清理 / 回显与 150s 恢复 / 权限）+ 总览卡 CLI 指引改跳转变更中心
  - 条目格式照各文档既有 change 条目（change 前缀 + 变更名 + 竖线分隔一句话摘要），追加位置跟随同文档最近 change 条目所在区（backend.md 与 sillyhub-daemon.md 在 MANUAL_NOTES_END 标记后、frontend.md 在变更索引区最新条目处）
acceptance:
  - 三份文档各新增恰好一条本变更条目，格式与既有条目一致（change 前缀 / 竖线分隔 / 一句话密度）
  - 条目内容与实际落地一致——backend 覆盖端点与心跳字段、daemon 覆盖 WS 指令与执行器、frontend 覆盖两函数与卡片
  - 除变更索引区外不改文档其它章节
verify:
  - 无自动化命令——目测三文档新增条目格式与既有条目一致
  - grep -c 2026-09-04-conflict-resolve-entry 三份模块文档各返回 1（各恰好一条）
constraints:
  - 只追加变更索引条目，不重写既有条目、不改架构描述章节（模块文档其它区留给 archive 阶段）
  - 不虚构未落地内容——摘要依据 task-01~10 实际实现与各 task verify 结果撰写
  - 不改本变更 tasks/ 下任何任务卡
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
