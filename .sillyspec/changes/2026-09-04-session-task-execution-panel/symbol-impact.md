# 符号影响面报告

> tasks.md 内容指纹（生成时）: 4c0fbd59c4d2588b——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更——新增 SQLModel 类 AgentSessionTask（全新类，无既有调用点）；Alembic 迁移为新增文件。不改任何既有类构造参数/接口/DTO/方法签名。
- task-02: 无签名级变更——新增 Pydantic DTO AgentSessionTaskRead 与新 GET 路由（新增符号）；schema.py/router.py 既有类与端点签名零改动。
- task-03: 无签名级变更——新增模块 agent_task_store.py（新函数 upsert_agent_task）；notify_agent_task_status 端点函数签名不变，仅函数体内追加 upsert 调用（try/except 旁路）。
- task-04: 无签名级变更——纯新增测试文件 test_agent_session_tasks.py。
- task-05: 符号搬移（等值）——applyAgentTaskStatusEvent 定义从 session-panel.tsx 移至 agent-task-store.ts；签名与语义零变化。受影响调用点 2 处（grep 全仓验证）：①session-panel.tsx 内部消费（自身文件内，在范围）；②__tests__/agent-task-card-lifecycle.test.tsx:35 直接 `import { applyAgentTaskStatusEvent } from "@/components/daemon/session-panel"`——经 session-panel.tsx 保留 re-export（export-from）保持 import 路径有效，不改测试一行。两处均在任务范围/受 re-export 保护。
- task-06: 无签名级变更——新增 hook useSessionTasks（新文件）与 lib/daemon.ts 新增导出函数 listSessionTasks（新增方法，非既有方法签名改动）。
- task-07: 无签名级变更——新增组件 TaskExecutionPanel（新文件）；复用的 agent-task-card/bash-progress-card/team-task-block 以现有 props 契约消费，不改其签名。
- task-08: 无签名级变更——session-panel.tsx 内部新增挂载与 SSE 分发回调追加 applyEvent 调用；既有组件 props/函数签名零改动。
- task-09: 无签名级变更——api-types.ts/openapi.json 为生成产物，只追加 AgentSessionTaskRead 等新类型，不改既有类型定义。
- task-10: 无签名级变更——纯新增测试文件（面板/hook 用例）；既有测试文件零改动（agent-task-card-lifecycle.test.tsx 仅被运行不被修改）。
