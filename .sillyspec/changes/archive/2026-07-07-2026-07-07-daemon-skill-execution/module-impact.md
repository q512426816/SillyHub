---
author: qinyi
created_at: 2026-07-07 22:05:00
---

# 模块影响分析 — 2026-07-07-daemon-skill-execution

> 数据源：`git diff --name-only 299d13ce..cda5e329`（baseline → HEAD，6 commit，21 文件）。
> 三重交叉验证：声明范围（design §6 文件清单）≈ 任务范围（plan.md 文件覆盖映射）≈ 真实变更（git diff）。以 git diff 为准。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| backend | 数据结构变更 | `app/modules/agent/base.py` | AgentSpecBundle 新增 `stage_meta: dict[str,str]\|None` 可选字段（D-007，向后兼容） | false |
| backend | 逻辑变更 | `app/modules/agent/context_builder.py` | `build_stage_bundle` 构造 5 字段 StageDispatchMeta 填入 bundle.stage_meta | false |
| backend | 接口变更 | `app/modules/agent/schema.py` | ExecutionContextResponse 新增 `stage_meta` + `stage_dispatch` 字段（daemon 消费） | false |
| backend | 逻辑变更 | `app/modules/agent/router.py` | stage run：claude_md 留空（D-005）+ prompt 改 skill 调用指令 + 透传 stage_meta/stage_dispatch | false |
| backend | 新增 | `app/modules/agent/skills_bundle_service.py` | 平台 skills 打包（stdlib tarfile+hashlib）：build_skills_manifest / build_skills_bundle | false |
| backend | 接口变更 | `app/modules/daemon/router.py` | 新增 `GET /api/daemon/skills/latest/{manifest,bundle}` 端点（+ import io） | false |
| backend | 配置变更 | `app/core/config.py` | Settings 新增 `skills_bundle_dir` 字段（默认 /app/.claude/skills） | false |
| backend | 配置变更 | `Dockerfile` | COPY --from=skills .claude/skills/ /app/.claude/skills/（server-local 容器自带 skills，task-07） | false |
| backend | 测试 | `app/modules/agent/tests/test_execution_context.py` | stage run 断言更新（claude_md="" + skill prompt + stage_meta） | false |
| backend | 测试 | `app/modules/daemon/tests/test_skills_bundle.py` | 新增 5 测试（manifest/bundle/sha256/404，patch service 模块 get_settings 修隔离） | false |
| backend | 测试 | `tests/modules/agent/test_stage_dispatch.py` | 加 stage_meta 5 字段断言 | false |
| sillyhub-daemon | 逻辑变更 | `src/task-runner.ts` | 删写 CLAUDE.md（D-005）+ stage_meta duck typing 读 + STAGE_META env 注入 + buildSkillPrompt（stage_dispatch 空 prompt 时构造 skill 指令）+ detectSkillInvoked 兜底检测（NFR-01） | false |
| sillyhub-daemon | 数据结构变更 | `src/types.ts` | LeaseCtx + ExecutionContextPayload 新增 `stage_meta` / `stage_dispatch`（snake_case 与 backend 一致） | false |
| sillyhub-daemon | 调用关系变更 | `src/daemon.ts` | start() 启动钩子调 syncSkills（try/catch 不阻塞）+ execution-context payload 归一化透传 stage_meta/stage_dispatch（2 处） | false |
| sillyhub-daemon | 新增 | `src/skill-manager.ts` | 平台 skills 同步（syncSkills：manifest 比对+bundle 拉取+sha256+gunzip/tar 解压含路径穿越防护）+ workspace 自定义 skills 同步（syncWorkspaceSkills：命名隔离 .claude/skills/workspace/） | false |
| sillyhub-daemon | 新增 | `src/mcp-config.ts` | MCP 配置合并（平台+workspace）+ 白名单过滤 + 临时 .mcp.json 注入（D-003/NFR-03） | false |
| sillyhub-daemon | 测试 | `tests/execution-context.test.ts` | case3/4 改 D-005 不写 CLAUDE.md + 3 新 stage_meta 注入测试 + 修字符串字面量 | false |
| sillyhub-daemon | 测试 | `tests/skill-manager.test.ts` | 18 测试（平台同步 4 路径 + workspace 同步 5 路径 + 工具函数） | false |
| sillyhub-daemon | 测试 | `tests/mcp-config.test.ts` | 10 测试（合并/白名单/注入 4 路径） | false |
| sillyhub-daemon | 测试 | `tests/task-runner-skill-detect.test.ts` | 10 测试（detectSkillInvoked 失败标记/skill 痕迹/灰区/非 stage 零回归 + buildSkillPrompt） | false |
| deploy | 配置变更 | `docker-compose.yml` | backend additional_contexts 加 `skills: ../`（Dockerfile COPY --from=skills 的源） | false |

## 未匹配文件

无。21 个变更文件全部匹配到 `_module-map.yaml` 已注册模块（backend `backend/**` / sillyhub-daemon `sillyhub-daemon/**` / deploy `deploy/**`）。

## 影响摘要

- **backend**（11 文件）：stage 投递重构核心（stage_meta 数据结构 + 投递逻辑改 skill 调用）+ skills bundle 分发端点 + Dockerfile COPY skills。接口变更 2 处（schema 加字段 + 新端点），均向后兼容。
- **sillyhub-daemon**（9 文件）：task-runner 删 CLAUDE.md + stage_meta 注入 + 兜底检测，新建 skill-manager（平台+workspace 同步）+ mcp-config（合并白名单），daemon.ts 启动钩子 + payload 归一化。
- **deploy**（1 文件）：docker-compose additional_contexts 加 skills 源。

**跨模块契约**：
- backend `GET /api/daemon/skills/latest/{manifest,bundle}` ↔ sillyhub-daemon `skill-manager.fetchRemoteManifest/fetchSkillsBundle`（字段/路径对齐）
- backend `ExecutionContextResponse.stage_meta/stage_dispatch` ↔ sillyhub-daemon `LeaseCtx.stage_meta/stage_dispatch`（snake_case 透传）

所有影响类型确定，无 needs_review=true 项。
