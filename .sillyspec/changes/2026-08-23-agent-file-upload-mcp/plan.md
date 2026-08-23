---
author: qinyi
created_at: 2026-08-23 09:30:15
plan_level: full
change: 2026-08-23-agent-file-upload-mcp
---

# 实现计划（Plan）：Agent 文件上传 MCP

## Spike 前置验证（如需要）

| Spike | 验证内容 | 不通过后果 |
|---|---|---|
| spike-01 | claude CLI 批任务形态下 `--mcp-config <tmpfile>` 与现有参数（--allowedTools/--permission-mode/-p 等）共存；.mcp.json per-server env `${VAR}` 展开是否可用（R-03 / D-009@v2 加固项） | task-07 回退 `~/.claude.json` 项目级配置方案，需回 design.md 补 R-03 备选展开（v3） |

> spike-01 在 task-07 开工前执行（Wave 5 前置），验证脚本/结论记录进 task-07 TaskCard。

## Wave 1（并行，无依赖）
- task-01
- task-04

## Wave 2（依赖 Wave 1）
- task-02

## Wave 3（依赖 Wave 2；task-03 消费 task-01 DTO 与 task-02 解析链，独立成波防同波依赖冲突）
- task-03

## Wave 4（依赖 Wave 3；daemon/frontend 两侧并行，无共享文件）
- task-05
- task-08
- task-09

## Wave 5（依赖 Wave 4；spike-01 前置）
- task-06
- task-07

## Wave 6（依赖全部）
- task-10

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | backend file 模块扩展：File 加 description 列 + DTO 扩字段（FileUploadResp/FileMetaResp 含 description、created_at）+ upload_file 增参 + alembic 迁移 | W1 | P0 | — | FR-06, D-006@v2 | file/model.py + schema.py + service.py + 新迁移；旧测试整 dict 断言同步更新 |
| task-04 | backend execution.py worker_tool_config 白名单模式追加整服务器名 mcp__sillyhub-file | W1 | P0 | — | FR-02, D-008@v1 | read_only/write 两分支（execution.py:91-110）；无白名单模式不动 |
| task-02 | backend file/service._can_access 扩 agent_session/agent_run 归属（解析链 + NULL deny）+ 单测 | W2 | P0 | task-01 | FR-04, D-004@v2 | 与 task-01 共享 service.py 故错波；AgentSession.workspace_id NULL deny；AgentRun 链 target_workspace_id ?? mission.workspace_id ?? task.workspace_id |
| task-03 | backend agent/file_artifacts.py 端点：POST multipart（鉴权/日志行/IntegrityError 重放防护/Redis publish）+ GET 列表（WORKSPACE_READ+锚定复核，复用 task-02 解析链）+ agent/router.py:905 挂载 + 端点测试 | W3 | P0 | task-01, task-02 | FR-01, FR-03, FR-05, D-007@v1, D-010@v1, D-011@v1 | 报错中文（l10n）；publish 复用 submit_run_input 同款模式（agent/service.py:842/:929，非 publish_submitted_messages）；失败降级记 WARNING |
| task-05 | daemon mcp-server.ts MCP_TOOLSET 双模式 + upload_file/list_uploaded_files（路径 resolve+前缀校验）+ hub-client multipart 方法 + mcp-config buildFileMcpServerConfig + 单测（**daemon 测试一律放 sillyhub-daemon/tests/，vitest include=tests/**/*.test.ts，src/ 下不收集**） | W4 | P0 | task-03 | FR-03, FR-07, D-005@v1 | orchestration 缺省零变化；MCP_ALLOWED_ROOT 缺失拒绝一切上传；FormData 不设手工 Content-Type |
| task-08 | frontend 聊天流 file 段：session-log-assembler 新段类型（classifySessionLog 入口重构传入 toolKind）+ file-message-card 组件（图片缩略图/通用卡片）+ turn-segment-views 渲染 + 测试 | W4 | P0 | task-03 | FR-01, D-001@v1, D-007@v1 | FileUpload 行不得再产生 tool_use 段（测试锚点）；旧/未知 tool_kind 忽略策略保持 |
| task-09 | frontend run 详情页「产出文件」区（GET /api/agent/file-artifacts?run_id=）+ 组件测试 | W4 | P1 | task-03 | FR-05, D-010@v1 | 复用 file-message-card；不复用 /api/file/list |
| task-06 | daemon 会话注入：cli.ts mainAgentMcpConfigProvider 并入 sillyhub-file + session-manager per-server env（MCP_SESSION_ID）扩展 + 单测（**测试放 sillyhub-daemon/tests/**） | W5 | P0 | task-05 | FR-02, D-002@v1, D-005@v1 | 与 task-07 无共享文件可同波；mcp_refs 过滤同语义（§9） |
| task-07 | daemon worker 注入：task-runner tmpdir 0600 临时 .mcp.json（per-server env 凭证、run 终删、启动清扫）+ stream-json buildArgs mcpConfigPath（仅 claude 分支）+ spike-01 + 单测（**测试放 sillyhub-daemon/tests/adapters/ 等，vitest include 内**） | W5 | P0 | task-04, task-05 | FR-02, FR-07, D-009@v2 | 不写 workDir；cursor 分支忽略；三平台路径兼容（win32/macOS/linux） |
| task-10 | gen:types 三端同步（backend/openapi.json + frontend/src/lib/api-types.ts + sillyhub-daemon/src/api-types.ts）+ 全量回归（pytest/vitest/lint）+ l10n 校验 | W6 | P0 | task-01~09 | FR-08 | gen:types 前确认 node_modules 健康；旧测试债顺手修不加新债 |

## 关键路径

task-01 → task-02 → task-03 → task-05 → task-07 → task-10（backend 数据模型 → 权限解析链 → 端点 → daemon 文件 MCP → worker 注入 → 同步回归，决定最短交付周期）

## 全局验收标准

1. 全部单测/组件测试通过（backend pytest、frontend vitest、daemon vitest），既有测试零回归
2. l10n 报错中文化测试通过（agent/file_artifacts.py 用户链路报错含 CJK）
3. gen:types 三端同步且 gen:types:check 无漂移（api-types.ts + openapi.json 一并提交）
4. 兼容性：MCP_TOOLSET 缺省=orchestration 行为零变化；codex/cursor 不注入；未注入场景旧链路零回归
5. 安全：路径逃逸用例（绝对路径/../出根）拒绝；MCP_ALLOWED_ROOT 缺失拒绝一切上传；tmpfile 0600 + run 终删 + 启动清扫有单测
6. 实时性：上传后日志行经 Redis publish 到达 SSE（集成冒烟）；publish 失败降级不阻断上传
7. 权限：WORKSPACE_READ 成员可下载 agent_session/agent_run 归属文件；无权 404；孤儿 run（解析链全空）deny

> 逐项核验结果由 verify 阶段写入 verify-result.md；task 级验收对照 TaskCard frontmatter acceptance 字段。

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-08 | file 段卡片渲染测试（图片/普通两形态） |
| D-002@v1 | task-06, task-07 | 会话/worker 注入单测 |
| D-003@v1 | task-05 | toolset=file 仅注册 2 工具断言 |
| D-004@v2 | task-02, task-03 | _can_access 解析链/NULL deny 单测 + GET 锚定复核测试 |
| D-005@v1 | task-05 | 同二进制双模式 + multipart 直传单测 |
| D-006@v2 | task-01 | 迁移 + DTO 扩字段 + 旧数据 NULL 兼容测试 |
| D-007@v1 | task-03, task-08 | 日志行落库/重放防护 + file 段映射测试 |
| D-008@v1 | task-04, task-07 | 白名单追加 + 仅 claude 分支单测 |
| D-009@v2 | task-07 | tmpfile 0600/清理/凭证 per-server env 单测 + spike-01 结论 |
| D-010@v1 | task-09 | run 页走新端点（不走 /api/file/list）测试 |
| D-011@v1 | task-03 | publish 实时扇出集成冒烟 + 降级路径测试 |
