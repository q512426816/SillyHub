# 模块影响分析（Module Impact）— 会话附件（图片多模态 + 文件落盘）

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| daemon | 修改 | 新 session_attachment 端点（上传/读取/删除）+ inject 扩展（attachment_ids/多模态门控 D-9/组装下发 D-4/标记行）+ 草稿清理 cron；sillyhub-daemon/src/protocol.ts SESSION_INJECT payload 扩展、daemon.ts/claude-sdk-driver.ts 块数组改造、hub-client 附件下载 |
| agent | 修改 | agent_run_logs user_input 标记行写入（inject 组装处）；AgentRun 链路无结构变更 |
| models | 修改 | 新 SessionAttachment 表 + llm_providers.multimodal 列（Alembic 迁移） |
| llm_provider | 修改 | multimodal 三态字段（schema/表单/读取链）；Read DTO 加 multimodal |
| storage | 依赖变更 | 附件经既有 StorageBackend（put/get_stream/head）存 MinIO；模块本体不改 |
| frontend_app | 修改 | /sessions 输入栏附件流（session-input-bar.tsx）、历史回显标记解析（turn-timeline）、api-types 重生成 |
| auth | 依赖变更 | 附件端点复用既有 TaskRunAgentUser 归属校验模式；模块本体不改 |

## 未匹配文件

无（全部改动文件已映射到上述模块）。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/daemon.md` | 更新 daemon 模块卡（附件端点/inject 扩展/协议扩展） | done |
| `modules/agent.md` | 更新 agent 模块卡（user_input 标记行） | done |
| `modules/models.md` | 更新 models 模块卡（SessionAttachment/multimodal 列） | done |
| `modules/llm_provider.md` | 更新 llm_provider 模块卡（multimodal 字段） | done |
| `modules/storage.md` | 无变化（仅复用既有接口） | skipped |
| `modules/frontend_app.md` | 更新 frontend_app 模块卡（附件 UI/回显） | done |
| `_module-map.yaml` | 无变化（未增删模块，session_attachment 并入 daemon 模块路径） | skipped |
