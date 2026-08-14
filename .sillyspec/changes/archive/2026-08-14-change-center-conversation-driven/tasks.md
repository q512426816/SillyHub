---
author: qinyi
created_at: 2026-08-14 15:12:45
---

# 任务清单（Tasks）— 变更中心会话驱动化

> 粗粒度任务分解（plan 阶段细拆为 Wave/Task 并排依赖；编号与 design §5 Phase / requirements FR 对应）。

## 后端

- T-01 daemon 增量同步标注：`spec-sync.ts` 计算 change_dirs（含归档前缀）+ `hub-client.ts` `postSpecSyncIncremental` 签名/body 加字段【FR-01a】
- T-02 backend 接收标注：`SpecIncrementalSyncRequest` 加 `change_dirs`（缺省 []）+ `apply_ops` 事务外触发 scoped reparse（无标注路径检测兜底、归档命中走全量）【FR-01a/b/d】
- T-03 scoped reparse：`ChangeService.reparse(scope)` + `parser.py` 按 key 过滤 + **零删除守卫**【FR-01c】
- T-04 变更-会话绑定：`ChangeSessionLink` 模型 + migration + reparse created 时按 §8 查询写 link（失败不阻断）【FR-02】
- T-05 审批语义改造：review 四方法删派发 + 阶段推进时 upsert platform_change_progress 收敛投影【FR-05c】
- T-06 审批-会话注入：审批四端点加 `notify_session`，后端服务身份注入绑定会话，响应带 `notified_session/notify_error`【FR-05d】
- T-07 MCP `submit_stage_review` docstring/返回契约同步【FR-05f】
- T-08 agent-sessions 端点扩展：加 `include_ended` 返回完整列表【FR-03c】
- T-09 删除 change_writer create/proxy-create/execute/documents 端点 + 引用清理【FR-04b】
- T-10 后端测试：T-02/03/04/05/06/08/09 各配套 pytest（重点：零删除、双兜底路径、投影收敛、注入三类降级、端点删除回归）

## 前端

- T-11 工作区会话页：workspace-tabs 加 tab + `sessions/page.tsx` + 抽 `WorkspaceSessionSection`（复用 InteractiveSessionPanel）【FR-03a/b】
- T-12 去表单：列表页删按钮/CTA + 空态引导会话 + 删 create-change 页 + lib/changes.ts 清理【FR-04a/b】
- T-13 详情页退化：删执行控制（含 quick 分支）state/handler/UI【FR-05a/b】
- T-14 审批卡改造：绑定会话只读展示 + 单端点调用 + 三类降级提示【FR-05e】
- T-15 `pnpm gen:types`（backend schema 改动后）+ 前端 vitest（T-11/12/13/14 覆盖）

## 收尾

- T-16 模块文档同步：change / spec_workspace / agent / mcp_gateway / change_writer / daemon / frontend + `_module-map.yaml`【FR-06b】
- T-17 与在途 `2026-08-13-spec-sync-visibility` 的合并基线核对（design §1：不回退其改动，postSpecSync/apply_ops 功能共存）

## 依赖关系（供 plan 参考）

- T-02→T-01（契约两端）；T-03→T-02；T-04 依赖 T-03；T-06 依赖 T-04/T-05；T-11 依赖 T-08；T-12 后端部分依赖 T-09；T-14 依赖 T-06/T-04；T-15 贯穿；T-16/T-17 收尾。
