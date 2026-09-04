---
plan_level: full
---

# 实现计划（Plan）— 变更中心平台同步处理区（冲突裁决 + ghost 清理）

## Spike 前置验证

无 Spike——全部技术点在 design 阶段已锚定真实代码先例（WS 直发 router.py:1268-1302 / 状态机槽 sillyspec-manager.ts:250 / 两态落库 model.py:108-109 / CLI resolve 与 doctor 源码实证），无未验证集成。

## Wave 1（并行，无依赖——三端契约基础，互不共享文件）
- task-01
- task-03
- task-05

## Wave 2（依赖 Wave 1——同文件串行：router.py 接续 task-03、daemon.ts 接续 task-05）
- task-02
- task-06

## Wave 3（依赖 Wave 1+2——测试与前端类型）
- task-04
- task-07
- task-08

## Wave 4（依赖 task-08 类型——前端 UI 两任务不同文件可并行）
- task-09
- task-10

## Wave 5（收尾——模块文档，依赖全部代码任务）
- task-11

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | backend WS 消息契约 | W1 | P0 | — | FR-02, FR-03, D-001@v1 | protocol.py 两条 MSG 常量 + ws_hub.py send_sillyspec_resolve/send_sillyspec_ghost_cleanup |
| task-02 | backend REST 端点 | W2 | P0 | task-01, task-03 | FR-02, FR-03, FR-04, D-001@v1, D-003@v1 | 两端点（权限+归属+change 白名单+504），与 task-03 共享 router.py 故串行 |
| task-03 | backend 心跳结果链路 | W1 | P0 | — | FR-05, D-004@v1 | DTO + daemon_instances 新列 + 迁移 + heartbeat_daemon 两态落库/register 恒清 + 机器视图透出 |
| task-04 | backend 测试 | W3 | P0 | task-02, task-03 | FR-02~05 | 权限/白名单/504/两态落库/register 恒清用例（test_sillyspec_platform_commands.py） |
| task-05 | daemon 协议与分发 | W1 | P0 | — | FR-02, FR-03, D-001@v1 | protocol.ts 常量+payload 类型 + _handleWsMessage 两直连 case + in-flight 串行 |
| task-06 | daemon 命令执行与结果槽 | W2 | P0 | task-05 | FR-02, FR-03, FR-05, D-004@v1 | runResolve/runGhostCleanup + _lastCommandResult 10min 终态窗 + 心跳携带 + config 键；与 task-05 共享 daemon.ts 故串行 |
| task-07 | daemon 测试 | W3 | P0 | task-05, task-06 | FR-02, FR-03, FR-05 | case 分发/flag 映射/超时/忙拒/心跳携带与过期停发（不发显式 null） |
| task-08 | 前端 API 与类型 | W3 | P0 | task-02, task-03 | FR-02, FR-03, FR-05 | lib/daemon.ts 两函数 + pnpm gen:types 再生成 api-types.ts/openapi.json |
| task-09 | 前端平台同步卡片 | W4 | P0 | task-08 | FR-01, FR-02, FR-03, FR-04, FR-05, D-002@v1, D-003@v1 | platform-sync-section.tsx + 权限 hook + 桌面/移动挂载 + 回显/150s 恢复 |
| task-10 | 前端总览卡收口 | W4 | P1 | task-08 | FR-01 | changes-overview-card.tsx CLI 指引改跳转变更中心 |
| task-11 | 模块文档更新 | W5 | P1 | task-01~10 | 全 FR | backend.md / sillyhub-daemon.md / frontend.md 变更索引条目 |

## 关键路径
task-01 → task-02 → task-08 → task-09（backend 契约→端点→前端类型→卡片，最长路径）

## 全局验收标准
1. 三端相关测试通过：backend `uv run pytest app/modules/daemon -q --no-cov -n auto` 新增用例全绿零回归；sillyhub-daemon 新增测试文件全绿 + tsc 0；frontend 组件测试绿 + lint 0
2. 集成冒烟：契约三端对账（WS 消息常量 backend protocol.py ↔ daemon protocol.ts 字符串一致；心跳字段两态语义双端一致；前端 api-types 含新端点与新读模型）
3. brownfield 兼容：无绑定 workspace 卡片不渲染；旧 daemon 忽略新消息无副作用（default case warn 实证）；heartbeat 键不出现=置 NULL 与 sillyspec_status 现状一致
4. `pnpm gen:types` 产物（api-types.ts + backend/openapi.json）随变更提交，类型不落后后端
5. 验收结论由 verify 阶段写入 verify-result.md；task 级验收对照 TaskCard acceptance 字段

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-02, task-05, task-06 | WS 直发先例复刻 + fire-and-forget 无 ack + 心跳结果回传（design §5） |
| D-002@v1 | task-02, task-06, task-09 | 冲突裁决+ghost 清理同通道同权限；abort 不实现（design §3） |
| D-003@v1 | task-02, task-09 | backend `_get_owned_instance` 404 + 前端权限 hook + 活跃警示不硬禁 |
| D-004@v1 | task-03, task-04, task-06, task-07 | 两态落库/register 恒清/daemon 不发显式 null 各有测试锚定 |
| FR-01 | task-09 | 卡片渲染/隐藏两分支用例 |
| FR-02 | task-01, task-02, task-05, task-06, task-09 | 裁决全链路 + 弹窗 + 警示 |
| FR-03 | task-02, task-06, task-09 | doctor+sync 两步 + 禁用态 |
| FR-04 | task-02, task-09 | 权限双端 |
| FR-05 | task-03, task-04, task-06, task-07, task-09 | 回显/150s 恢复/忙拒 |
