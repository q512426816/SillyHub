---
author: qinyi
created_at: 2026-08-22 03:31:10
plan_level: full
scale: large
---

# 实现计划（Plan）— 会话内团队操作

## Spike 前置验证
| Spike | 验证内容 | 不通过后果 |
|---|---|---|
| spike-01 | R-04：claude-sdk-driver spawn mcp-server 子进程时 per-server env 透传（MCP_SESSION_ID 可达子进程并被 mcp-server.ts 读取） | task-10 切换 fallback 方案：5 工具参数显式带 session_id（design §10 R-04 已定），不推翻其它任务 |

## Wave 1（并行，无依赖）
- spike-01
- task-01
- task-07
- task-09

## Wave 2（依赖 Wave 1）
- task-02
- task-03
- task-04

## Wave 3（依赖 Wave 2）
- task-05
- task-10

## Wave 4（依赖 Wave 3）
- task-06

## Wave 5（依赖 Wave 4）
- task-08
- task-12

## Wave 6（依赖 Wave 5）
- task-11

## Wave 7（依赖 Wave 6）
- task-13

## Wave 8（依赖 Wave 7）
- task-14

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | backend 数据模型迁移（session_id 列+索引+活跃部分唯一索引） | W1 | P0 | — | FR-01, D-006@v1 | model.py + alembic |
| task-02 | derive_status 兼容扩展（awaiting_input+NULL 守卫）+矩阵全格测试 | W2 | P0 | task-01 | FR-08, D-009@v1, D-007@v2 | mission.py + tests（R-03 含存量组合） |
| task-03 | 会话团队触发/列表端点 + DTO + scope 冻结 + 409 | W2 | P0 | task-01 | FR-03, D-004@v1 | daemon/router.py + schema.py + orchestrator.py 预建入口 |
| task-04 | inject 主控轮双标记 + objective 占位回填 | W2 | P0 | task-01 | FR-01, D-009@v1 | session/service.py |
| task-05 | mcp_tools 会话定位 + dispatch_worker 懒建（并发守卫+补回填+422+默认预算） | W3 | P0 | task-02, task-03, task-04 | FR-04, FR-03 | mcp_tools.py |
| task-06 | converge 语义重定义（busy/独立置位）+ finalizer 锚点 | W4 | P0 | task-04, task-05 | FR-04, D-010@v1 | mcp_tools.py + finalizer.py（与 task-05 分 Wave 防同文件并行） |
| task-07 | 治理门/workers/成本查询 role!='orchestrator' 判别 | W1 | P1 | — | FR-01, FR-08, D-007@v2 | control.py |
| task-08 | patrol/schedule_loop 适配（awaiting_input 超时收敛+僵尸判定+redispatch no-op） | W5 | P1 | task-02, task-06 | FR-05, FR-08, D-008@v1 | patrol.py + orchestrator.py |
| task-09 | daemon 注入谓词（claude 且 stage∈{空,'orchestrator'}）+ 分身 stage 常量化 'mission_worker' | W1 | P0 | — | FR-02, D-002@v2, D-003@v1 | cli.ts + execution.py（stage 移 lease metadata） |
| task-10 | daemon MCP 会话上下文 + 工具改造（env MCP_SESSION_ID/X-Session-Id/参数可选化/描述重写） | W3 | P0 | spike-01, task-09 | FR-02, FR-04, D-002@v2 | mcp-config.ts + session-manager.ts + mcp-server.ts + hub-client.ts |
| task-11 | 前端触发入口（按钮+弹层+chip+/team+Codex 置灰+「用团队分析」改造+TeamTaskBlock 挂载） | W6 | P0 | task-03, task-12 | FR-03, FR-07, D-003@v1, D-004@v1 | session-panel.tsx + interactive-session-panel.tsx + team-trigger-popover.tsx |
| task-12 | 前端 TeamTaskBlock + 进度视图分身段块 + API client | W5 | P0 | task-03 | FR-07 | team-task-block.tsx + turn-segment-views.tsx + lib/daemon.ts |
| task-13 | 删除旧入口（mission-console/两路由/菜单/create+list client）+引用清理 | W7 | P1 | task-11 | FR-06, D-005@v1, D-011@v1 | 保留 getMission/cancelMission（team-progress 在用） |
| task-14 | 类型同步（frontend/daemon api-types + openapi.json）+ 模块文档更新收尾 | W8 | P1 | task-05, task-06, task-08, task-10, task-11, task-12, task-13 | 全 FR | pnpm gen:types；CLAUDE.md 规则 21 |

## 关键路径
task-01 → task-03 → task-12 → task-11 → task-13 → task-14（前端交付链，6 跳；backend 链 task-01 → task-04 → task-05 → task-06 → task-08 → task-14 等长，W5-W6 前后端可交错）

## 全局验收标准
1. backend agent+daemon 模块 pytest 全绿（local.yaml 子模块命令；agent 模块含既有 deselect 项）
2. frontend vitest + daemon vitest 全绿（daemon 按预存 flake 规避：主批并发 + 3 文件串行独跑）
3. derive_status 判据矩阵全格单测通过（主控轮×分身×converge×cancel×session_id NULL 全组合，含 complete_lease 自动收敛不回归）
4. 集成冒烟：Claude 会话触发→dispatch_worker 懒建→分身 run 创建→converge busy/置位→TeamTaskBlock 状态流转（verify 阶段实测）
5. 存量 external mission 链路（change 阶段执行/team-progress）不回归
6. 旧路由 404、菜单项消失、全仓 grep 无 dangling 引用
7. 未触发团队的普通会话行为不变

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-03, task-04, task-11, task-12 | FR-01/FR-07 GWT |
| D-002@v2 | task-09, task-10 | FR-02 GWT（分身排除） |
| D-003@v1 | task-09, task-11 | FR-02/FR-07 GWT（Codex 置灰） |
| D-004@v1 | task-03, task-05, task-11 | FR-03 GWT（预建+懒建） |
| D-005@v1 | task-13 | FR-06 GWT |
| D-006@v1 | task-01 | FR-01 GWT（列+索引） |
| D-007@v2 | task-07 | FR-08 GWT（治理门判别） |
| D-008@v1 | task-08 | FR-05 GWT |
| D-009@v1 | task-04, task-05 | FR-01/FR-04 GWT（双标记） |
| D-010@v1 | task-06 | FR-04 GWT（busy/置位） |
| D-011@v1 | task-13 | FR-06 GWT（保留 get/cancel） |

FR-01~FR-08 全部由任务总表"覆盖 FR/D"列映射；无 P0/P1 unresolved blocker。
