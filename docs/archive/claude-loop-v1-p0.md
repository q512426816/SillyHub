# V1 P0 收尾 Loop 指令

## 已完成
task-01 / task-02 / task-03 / task-04a 全部通过。
auth + RBAC 已就绪：get_current_user、require_permission、Permission enum。
后端 65 tests passed，前端 lint / typecheck / build 全绿。

注意：这里的 task-04 指 scan docs，不是已完成的 task-04a。

## V1 P0 剩余任务
主线：task-04 scan docs → task-05 change → task-06 task 看板
支线：task-09 git identity → task-10 worktree

执行顺序：
1. 主线优先。
2. task-04 和 task-09 互不依赖，但先做 task-04。
3. 每完成一个 task 并通过验收后，再进入下一个 task。
4. 不要跨 task 并行推进。

## 每轮开始先做
1. 查看 git status / 当前 diff。
2. 阅读或更新进度文件：
   2026-05-25-multi-agent-platform-bootstrap-v2/.loop-progress.md
3. 确认当前正在推进哪个 task、已完成哪些 AC、还有哪些未完成。
4. 如果发现上轮中断，优先从中断点恢复，不要重复实现已完成内容。

## 每个 task 的执行节奏
1. 读 spec：
   2026-05-25-multi-agent-platform-bootstrap-v2/tasks/task-XX.md
   以及对应 references/
2. 对照已有 workspace / component 模块，确认代码风格和结构。
3. 后端：建 model + schema + service + router。
4. 新路由必须接入 auth 鉴权：
   Depends(get_current_user)
   require_permission(...)
5. 写测试和 fixtures。
6. 后端改完必须跑：
   ruff
   mypy
   pytest
7. 如需新表，补 Alembic migration。
8. 前端：实现页面、组件、接口调用和基础交互。
9. 前端改完必须跑：
   pnpm typecheck
   pnpm lint
   pnpm build
10. 对照该 task 的 AC 逐项确认。
11. 更新 .loop-progress.md，记录：
   - 当前 task
   - 已完成 AC
   - 通过的测试
   - 剩余问题
   - 下一步

## 全局规则
- 每轮只推进一个明确步骤，不跨步。
- 不要为了通过测试而删除或弱化有效测试。
- 不要绕过 RBAC / auth / 权限校验。
- 不要猜测 spec 未说明的关键业务规则。
- 遇到阻塞：依赖缺失、环境问题、spec 明显冲突、权限模型不明确，立即停下来报告，不要继续猜测实现。
- 代码风格对齐已有模块，优先参考 workspace / component。
- 每完成一个 task，必须简报：
  - 完成了哪些 AC
  - 新增/修改了哪些核心文件
  - 跑了哪些测试
  - 是否还有风险

## 验收
全部 V1 P0 task 完成后做一次总验：
1. docker compose up -d --build
2. 确认所有容器健康
3. 后端完整测试通过
4. 前端 typecheck / lint / build 通过
5. 逐页面验证功能可用

全部验收通过后，停止 loop，并输出最终总结。
