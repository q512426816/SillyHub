---
author: qinyi
created_at: 2026-08-29 12:55:00
plan_level: full
change: 2026-08-29-change-delete-closure-and-spec-pull
---

# 实现计划（Plan）

## Spike 前置验证

无需 Spike：全部改动点已经三轮独立子代理源码级核实（file:line 落盘于 design.md），无未经验证的技术集成。

## Wave 划分规则

同 Wave 任务**不得共享任何源码文件**（execute 同 Wave 并行派发，共享文件会互相覆盖——round 1 审查 P0 修正）。文件归属核对：spec_workspace/service.py ∈ {task-02, task-05, task-08, task-06}；change/service.py+schema.py ∈ {task-03, task-11, task-06}；frontend changes 页面 ∈ {task-07, task-12}；sillyspec sync.js ∈ {task-13, task-14}——以上每组均分属不同 Wave。

## Wave 1（基础：migration）
- task-01

## Wave 2（镜像层拦截 + 上行拒收；依赖 W1）
- task-02
- task-04

## Wave 3（投影层定向删除 + 拉取端点；依赖 W2）
- task-03
- task-08

## Wave 4（quicklog 对账 + 活动投影后端 + 跨仓上报；依赖 W2）
- task-05
- task-11
- task-13

## Wave 5（删除入口后端 + 前端下载 + daemon 回归 + 活动徽标 + 跨仓 pull；依赖 W3/W4）
- task-06
- task-09
- task-10
- task-12
- task-14

## Wave 6（前端删除入口；依赖 W5）
- task-07

## Wave 7（收尾：文档同步与决策提炼；依赖 W1-W6）
- task-15

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | alembic migration 两列 + ORM 字段（spec_file_manifest.platform_deleted、quicklog_entries.hidden） | W1 | P0 | — | FR-04, FR-03b, D-006@v1 | 单 revision；提交前 alembic heads 单头检查（R-05） |
| task-02 | apply_ops 空目录清理 + platform_deleted 拦截（add/rename 拒绝、delete 幂等放行）+ `_write_spec_root` 落盘级前缀排除（B-2） | W2 | P0 | task-01 | FR-02, FR-04(通道1/2/3), D-006@v1 | 仅 ops 涉及目录，避 Windows bind mount 断崖（R-03）；前缀探测优先于逐路径（闭合 P2 边角） |
| task-03 | scoped 定向删除（R-08 收窄）+ 删除环与 `_apply_parsed` 对 deleted 行三点豁免（B-1）+ progress 联动删 + rename 限定 scope 集 + 红测改写 | W3 | P0 | task-01, task-02 | FR-01, FR-03a, D-005@v1, D-006@v1 | `_detect_renames` 包裹路径空判与 existing_by_key 取数按 R-11 细化；7 天占位保护保留 |
| task-04 | `_ensure_change_row` 双层拒收（行 deleted + manifest 兜底锚点，LIKE 转义）+ progress 409 code=change_deleted + CLI 墓碑 status='deleted' 写路径处理（仅置 location='deleted'；「触发镜像软删」接线归 task-06 的 soft_delete_change_dir，本任务不自造方法——round 2 复审 P1 修正） | W2 | P0 | task-01 | FR-04(通道4), D-005@v1, D-006@v1 | 旧 CLI 兼容：409 重试无害；兜底锚点 fixture 造 manifest 行测试 |
| task-05 | quicklog apply 期对账：镜像文件重解析 → 缺失 ql_id 置 hidden；merge_entries 过滤 hidden | W4 | P1 | task-01 | FR-03b | 仅重解析 quicklog/ 目录；软隐藏不硬删（可回滚） |
| task-06 | `soft_delete_change_dir`（同时承接 task-04 CLI 墓碑写路径的「触发镜像软删」接线）+ `DELETE /changes/{cid}` 端点（组合权限 CHANGE_ARCHIVE 或 owner）+ 服务顺序（镜像软删→progress 删→location='deleted'→change_events 审计）+ enrich 对 deleted 行前置过滤（含归档区 location='archive' 行同样可删）+ 权限矩阵测试 | W5 | P0 | task-02, task-04 | FR-05a/b/c, D-001@v1, D-002@v1 | base_version 直读 manifest 现值零冲突；行保留故审计不 CASCADE；enrich 前置过滤落本任务（change/service.py 与本任务同文件） |
| task-07 | 前端删除入口：DeleteChangeConfirm 组件（名称末段防呆）+ 列表操作列 + 详情页危险按钮 + 移动端同步 + deleteChange API + gen:types | W6 | P0 | task-06 | FR-05d | 照 admin/users DeleteConfirm 范式；原型 prototype-delete-and-pull.html 对照 |
| task-08 | `GET /changes/-/spec-bundle`（platform_sync，_write_auth 仅 shpsync，前置注册）+ 鉴权矩阵测试 + bundle `X-Spec-Version` 头 + tar 顶层 PLATFORM-BUNDLE.json（`spec_workspace/service.py` 的 build_bundle 改点） | W3 | P0 | — | FR-07, FR-08, D-005@v1 | 路由前置于 /changes/{name}（R-06）；build_bundle 改点显式纳入本任务文件集（round 1 审查 P1 修正） |
| task-09 | 前端「下载文档包」按钮：workspace-config-card + downloadSpecBundle（鉴权 blob 范式）+ 快照语义文案 | W5 | P1 | task-08 | FR-06, FR-08 | 对齐 D-009 blob 生命周期托管思路；不新增 Next route handler |
| task-10 | daemon 兼容回归：bundle 含 PLATFORM-BUNDLE.json 后 pullSpecBundle 解包兼容 + spec_version 判定不受影响 | W5 | P1 | task-08 | FR-08, NFR-03 | 集成冒烟：镜像 pull 路径跑通 |
| task-11 | backend 活动投影：ChangeSummary + last_pushed_at + enrich 既有 join 顺带取值 + 投影两态单测 + gen:types | W4 | P1 | — | FR-09, D-007@v1 | 零 migration 零新查询 |
| task-12 | frontend 活动徽标：真值表 f(current_step_status, 最后信号年龄) 三态 + ACTIVITY_STALE_MS + ISO_LIKE_RE 防御解析（畸形串回退）+ 详情页「最后信号」+ 测试 | W5 | P1 | task-11 | FR-09, D-007@v1 | waiting 归空闲；R-12 文案只陈述事实 |
| task-13 | 【跨仓 sillyspec】X1 墓碑上报（删除/归档 status='deleted'）+ X3 步骤开始上报 + X4 execute 任务边界 triggerSync | W4 | P1 | task-04 | FR-10, D-004@v1, D-007@v1 | 触点 src/run/shared.js、src/sync.js（载荷）、src/stages/execute.js；任务卡片 repo: sillyspec |
| task-14 | 【跨仓 sillyspec】X2 pullSpecBundle（GET /changes/-/spec-bundle 流式下载解压）+ 顶层命令注册（空目录或 --force 整树覆盖）+ 命令帮助文案明示快照语义 | W5 | P1 | task-08 | FR-07, FR-08, D-004@v1 | 触点 src/sync.js（现有 pull 仅进度六表）、src/index.js；与 task-13 分波（sync.js 归一）；任务卡片 repo: sillyspec |
| task-15 | 收尾：模块文档 + ROADMAP 补记 + 知识库决策提炼（D-001~D-007）+ docs/sillyspec 工具改进回执（X1-X4） | W7 | P1 | task-01~14 | 全部 | 归档前置 |

## 关键路径

task-01 → task-02 → task-03 → task-06 → task-07 → task-15（migration → 镜像拦截 → 定向删除 → 删除端点 → 前端入口 → 收尾，决定最短交付周期）

## 全局验收标准

1. 相关模块单测全绿（change/spec_workspace/platform_sync backend 三模块 + frontend changes 线；遵守 CLAUDE.md 规则 0 只跑相关测试，全量留 CI）。
2. 集成冒烟（risk_level=integration-critical）：裸删→spec-sync→自动收敛全链路无手动 reparse；平台删除→另一成员 CLI 推 add→被拒；daemon 全量回退→文件不落盘不复活；bundle 含 PLATFORM-BUNDLE.json 时 daemon pull 兼容。
3. brownfield 兼容：未删除任何变更时行为与现状一致（reparse 语义、列表、同步链路零回归）；旧版 CLI（无 X1-X4）下 FR-01~FR-05/FR-09 启发式仍成立。
4. OpenAPI/gen:types 同步提交（api-types.ts + openapi.json，前端与 daemon 各一份类型不落后）。

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-06 | 权限矩阵测试（owner / 非 owner+CHANGE_ARCHIVE / 无权限 403） |
| D-002@v1 | task-06, task-07 | location='deleted' 三 tab 不显示（enrich 前置过滤）+ change_events[delete] 留痕 |
| D-003@v1 | 全局（Wave 结构） | plan.md 七 Wave 分组（含共享文件分组规则） |
| D-004@v1 | task-13, task-14 | 跨仓任务卡片 repo: sillyspec（local.yaml repos 已注册） |
| D-005@v1 | task-02, task-03, task-04 | scoped 双断言红测 + 四通道拦截测试 |
| D-006@v1 | task-02, task-03, task-04 | B-1 三点豁免测试 + B-2 落盘排除测试 |
| D-007@v1 | task-11, task-12, task-13 | 投影两态 + 徽标真值表测试 + X3/X4 验收 |
| FR-01 | task-03 | 裸删→spec-sync→自动收敛集成 |
| FR-02 | task-02 | 空目录 rmdir 断言 |
| FR-03 | task-03, task-05 | progress 无残留 + quicklog hidden 断言 |
| FR-04 | task-02, task-04, task-06 | 四通道各一条拦截测试 |
| FR-05 | task-06, task-07 | 权限矩阵 + 弹层防呆交互测试 |
| FR-06 | task-09 | blob 下载集成（mock）+ 解压结构断言 |
| FR-07 | task-08, task-14 | 鉴权矩阵 + CLI pull 验收（跨仓） |
| FR-08 | task-08, task-09, task-10, task-14 | 响应头/tar 内容断言 + UI/CLI 快照文案 + daemon 回归 |
| FR-09 | task-11, task-12 | 投影两态 + 徽标三态（含畸形串） |
| FR-10 | task-13 | 跨仓流程验收（步骤开始后徽标进行中） |
| FR-11 | —（否定性需求：心跳不实现，协议预留） | design §8.3 + §15 Non-Goals；验收=不引入任何心跳代码 |
