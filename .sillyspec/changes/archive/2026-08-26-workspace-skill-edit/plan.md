---
author: qinyi
created_at: 2026-08-26 19:35:00
plan_level: full
---

# 实现计划（Plan）

## Spike 前置验证

无独立 Spike。两个 grill 存疑已在设计层收敛：`{path:path}` 有先例（daemon/router.py:3375）；rmtree symlink 防护收敛为 task-01 实现要求（删除前 lstat 拒绝非普通文件/目录条目）。

## 前置条件（执行门）

**先合并 2026-08-26-workspace-mcp-edit 回 main，再重建本变更 worktree**（base 含 MCP 改动）——两变更同文件 4 个（skills_view_service.py / router.py / workspace-skills-view.ts / api-types.ts），不先合并必冲突（design §10 Grill 登记）。执行顺序：用户确认 → MCP worktree 合并 → main 前进 → 删本变更旧 worktree 重建 → execute。

## Wave 1（并行，无依赖）
- task-01

## Wave 2（依赖前序 Wave）
- task-02

## Wave 3（依赖前序 Wave）
- task-03
- task-04

## Wave 4（依赖前序 Wave）
- task-05

## Wave 5（依赖前序 Wave）
- task-06

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 后端 skills 写路径 service | W1 | P0 | — | FR-01, FR-02, FR-03, FR-05 / D-003@v1, D-004@v1, D-006@v1 | 5 方法（create/delete skill + read/write/delete file）+ 路径安全 helper（resolve+commonpath+段白名单+两层限制）+ pydantic 模型 + AppError 族（中文）+ rmtree symlink 防护 + 手工审计 |
| task-02 | 后端 5 REST 端点 | W2 | P0 | task-01 | FR-01, FR-02 | router 装配（POST/DELETE skills、GET/PUT/DELETE files/{path:path}），WorkspaceWriter 权限 |
| task-03 | 后端全分支测试 | W3 | P0 | task-02 | FR-01, FR-02, FR-03, FR-05 | test_skills_edit.py：CRUD 全分支/路径穿越变体（../、绝对、盘符、..\）/白名单/二进制 415/超限 413/SKILL.md 409/审计/中文文案 |
| task-04 | 前端类型重生成 | W3 | P0 | task-02 | FR-01, FR-02 | gen:types（先 tsc 探针）+ 提交 api-types.ts/openapi.json |
| task-05 | 前端数据层 | W4 | P1 | task-04 | FR-01, FR-02 | 5 fetch + hooks + queryKeys（workspaceSkillsView 既有 + workspaceSkillFile 新增；写后失效两者） |
| task-06 | 页面双栏改造与测试 | W5 | P0 | task-05 | FR-01, FR-02 / D-002@v1 | 左栏 skill 列表+文件树+新建/删除按钮，右栏编辑器+未保存标记+保存/重置；新建对话框；删除二次确认；提示文案（生效时机/约束）；更新既有只读断言+新增交互用例 |

## 关键路径
task-01 → task-02 → task-04 → task-05 → task-06（串行主线）；task-03 与 Wave 2 并行

## 全局验收标准
1. workspace 模块与前端全量测试绿（local.yaml 子模块命令）
2. GET skills 列表响应与现状同构（brownfield 零回归：既有列表/空态用例不改动仍绿）
3. 端到端冒烟：新建 skill → 编辑 SKILL.md → 新建辅助文件 → 删除文件 → 删除 skill 全链路（测试内断言 specDir 文件真实落盘/清理）
4. 安全约束全部有专项用例（穿越变体/白名单/415/413/409）
5. 错误文案中文；审计行落库且不含文件内容

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-02, task-06 | CRUD 全流程用例 |
| D-002@v1 | task-06 | 双栏交互+对话框用例 |
| D-003@v1 | task-01, task-03 | 安全专项用例矩阵 |
| D-004@v1 | task-01 | service 直读直写实现 |
| D-005@v1 | task-06 | 生效提示文案 |
| D-006@v1 | task-01, task-03 | 审计用例 |
