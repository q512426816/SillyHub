---
id: task-02
title: 'backend delete_change 收敛环自动下发（终 commit 后 fire-and-forget+绑定机器查询）'
title_zh: 'backend delete_change 收敛环自动下发（终 commit 后 fire-and-forget+绑定机器查询）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-09 11:58:09
priority: P0
depends_on: ['task-01']
blocks: [task-04]
requirement_ids: [FR-03]
decision_ids: [D-001@v1]
expects_from: 'task-01: ws_hub.send_sillyspec_tombstone_cleanup(instance_id, change, workspace_id)'
allowed_paths:
  - backend/app/modules/change/service.py
  - backend/app/modules/change/tests/test_delete_change.py
target_files:
  - backend/app/modules/change/service.py
  - backend/app/modules/change/tests/test_delete_change.py
goal: >
  平台删除变更时向绑定数据源机器自动下发收敛指令（FR-03 删除环自动下发场景）——堵住「平台删了、
  本机留着」的复发源头。指令下发是收敛的主动通道，前端按钮（task-04）是离线兜底通道。
implementation:
  - backend/app/modules/change/service.py:334 delete_change 在主事务**最终 commit 之后**（349/423 双 commit 结构取 423 终 commit 后——Grill P2 钉死，防指令先于事务提交到达）追加下发段
  - 查询该 workspace 绑定的数据源机器：按 workspace 成员绑定（daemon_id）取目标 instance（复用现有 binding 模型查询，execute 时按实际模型实现，设计只锁语义）
  - 调 task-01 的 ws_hub.send_sillyspec_tombstone_cleanup(instance_id, change_key, workspace_id)；**fire-and-forget 失败（含离线/无绑定机器）仅 structlog 记日志，不阻塞删除流程、不抛错**
  - backend/app/modules/change/tests/test_delete_change.py 扩展：删除成功且机器在线→WS 消息发出（change+workspace_id 断言）；机器离线→删除仍成功（指令失败仅日志）；无绑定机器→跳过下发
acceptance:
  - 删除变更后（有在线绑定机器）daemon 收到 daemon:sillyspec_tombstone_cleanup（payload change+workspace_id）
  - WS 发送失败/机器离线/无绑定机器三种情况删除流程均正常完成（HTTP 语义不变）
  - 下发发生在主事务终 commit 之后（测试可用发送时序断言或事务可见性验证）
verify:
  - cd backend && uv run pytest app/modules/change/tests/test_delete_change.py -q --no-cov
constraints:
  - 不阻塞删除主流程（失败仅日志）——这是 design 兼容策略钉死语义
  - 不在本 task 改 daemon/前端（跨 task 边界）
  - 下发时点=终 commit 后，不得提前
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
