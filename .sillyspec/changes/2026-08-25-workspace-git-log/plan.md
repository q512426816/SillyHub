---
author: qinyi
created_at: 2026-08-25 21:28:10
plan_level: full
change: 2026-08-25-workspace-git-log
---

# 实现计划（Plan）— 工作区 Git 日志视图（类 IDEA Git Log）

## Spike 前置验证

不需要。技术不确定性已在 brainstorm 阶段消除：Gitea lane 算法已定移植方案（D-004）、daemon execFile argv 无注入面已核实（Grill CC-09）、RPC 平名通道形态已对齐 explorer（D-006）。

## Wave 1（并行，无依赖）
- task-01
- task-02
- task-03

## Wave 2（依赖 Wave 1）
- task-04

## Wave 3（依赖 Wave 2）
- task-05

## Wave 4（依赖 Wave 3）
- task-06

## Wave 5（依赖 Wave 4）
- task-07

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | daemon host-fs 四只读方法（git_log/git_refs/git_show/git_diff_file）+ daemon.ts 平名注册 + 解析边界单测 | W1 | P0 | — | FR-01, FR-05, FR-07, D-002@v1, D-003@v1, D-006@v1 | %x00/%x1e 解析、peeled 回退、空态结构、64KB 截断、binary 检测；只读 argv；vitest |
| task-02 | backend git_log 模块骨架（router/service/schema + main.py 挂载） | W1 | P0 | — | FR-05, FR-07, D-002@v1 | 权限门控 WORKSPACE_READ、模块本地 AppError 错误族（404/403/502/504/422）、Pydantic schema（§7.4 契约含 git_mode 两态/branches[]/seq 全局序）、超时常量 |
| task-03 | graph_layout lane 计算器（纯函数）+ 七类拓扑单测 | W1 | P0 | — | FR-01, FR-06, D-004@v1 | Gitea 算法移植：有序活跃槽 + 最左空闲 + 回收；确定性；窗口截取；lookahead 退化（边不绘制 lane 不变） |
| task-04 | backend service 数据链路完整化 + router 集成测试 | W2 | P0 | task-01, task-02, task-03 | FR-01, FR-04, FR-05, FR-06, FR-07, D-005@v1, D-006@v1 | MemberBindingResolver 直连平名 RPC、probe 两态映射（unknown→502）、refs 合并（HEAD/tag peeled）、branch/author 过滤透传、skip/limit/lookahead 分页、参数校验（sha/branch/author/path）；mock daemon RPC 七分支集成测试 |
| task-05 | pnpm gen:types 再生成 + 前端 lib/git-log.ts hooks | W3 | P0 | task-04 | FR-01, FR-04, FR-06 | api-types + openapi.json 提交；queryKey（skip/limit/branch/author）+ useQuery hooks + 详情/diff 两个按需 hook |
| task-06 | 前端页面与组件（TABS 注册/page 骨架/虚拟列表/泳道 SVG/详情 Drawer/文件树）+ 组件测试 | W4 | P0 | task-05 | FR-01, FR-02, FR-03, FR-04, FR-06, D-001@v1, D-005@v1 | react-virtual + SVG 视口重绘；文件树 /聚合 +x/-y；diff 展开按需加载；空态卡 + 三降级卡；中文文案 |
| task-07 | 主题合规与整链路验收 | W5 | P1 | task-06 | FR-08, D-001@v1 | 三主题（blue/ai-native/dark）对照 FRONTEND_PAGE_STYLE §12 清单；≥8 泳道辨识度留证；真机全链路手测记录（列表/翻页连续/过滤/详情/diff/空态/离线） |

## 关键路径

task-01/02/03 → task-04 → task-05 → task-06 → task-07（W1 三任务并行后全串行，最短交付周期由 task-04→07 链决定）

## 全局验收标准

1. backend pytest（git_log 模块全部用例 + 既有套件无回归）、daemon vitest、frontend vitest 全绿；local.yaml 命令（test_strategy=module，按 git diff 命中模块执行）
2. 集成冒烟（integration-critical 判级要求）：真实 daemon + 真实 git 仓库跑通「列表 → 详情 → diff」全链路；翻页泳道 lane 连续一致；非 git 工作区空态卡；daemon 停机 502
3. brownfield 兼容：不改动任何既有端点/表结构/页面行为；`pnpm gen:types` 无其他模块类型漂移
4. `frontend/src/lib/api-types.ts` + `backend/openapi.json` 随变更提交（CLAUDE.md 规则 21）

## 覆盖矩阵（如存在 decisions.md）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-03, task-06, task-07 | graph_layout 单测 / 自研 SVG 组件 / 三主题对照记录 |
| D-002@v1 | task-01, task-02, task-04 | daemon RPC 方法 + backend 新模块 + 直连链路集成测试 |
| D-003@v1 | task-01, task-02 | 只读子命令白名单 + 无 DB 写入（模块无 model/迁移） |
| D-004@v1 | task-03, task-04 | 七类拓扑单测（含窗口一致性与 lookahead 退化）+ 分页集成测试 |
| D-005@v1 | task-04, task-06 | author/branch 过滤透传 + 文件树聚合 + 虚拟滚动/按需 diff |
| D-006@v1 | task-01, task-02, task-04, task-06 | 平名注册 / git_mode 两态 / 退化行为测试 / branches[] 下拉 + 作者文本输入 |
| FR-01 | task-01, task-03, task-04, task-06 | 列表泳道渲染 + refs 标注 |
| FR-02 | task-06 | 文件目录树组件测试 |
| FR-03 | task-01, task-06 | diff RPC 截断/binary 单测 + Drawer 展示 |
| FR-04 | task-04, task-05, task-06 | 过滤参数链路 + queryKey 缓存 + 工具栏 |
| FR-05 | task-01, task-02, task-04, task-06 | 空态/错误映射集成测试 + 前端降级卡 |
| FR-06 | task-03, task-04, task-05, task-06 | 分页一致性 + 虚拟滚动 + 视口重绘 |
| FR-07 | task-01, task-02, task-04 | 参数校验单测/集成测试（422 拒绝面） |
| FR-08 | task-06, task-07 | 主题 token 消费 + 三主题对照清单 |
