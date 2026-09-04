---
plan_level: full
---

# 实现计划（Plan）：PI 交互式 Provider 接入（档C 首战）

## Wave 1（并行，无依赖——归一化器与能力表基座）
- task-01
- task-04

## Wave 2（依赖 W1——driver 核心）
- task-02

## Wave 3（依赖 W2——driver 高级语义，与 task-02 同文件必须串行）
- task-03

## Wave 4（依赖 W2/W3——可选性与实证）
- task-05
- task-06

## Wave 5（依赖 W4——收口）
- task-07

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | PiEventNormalizer+fixture 用例 | W1 | P0 | — | FR-02 | pi-events.ts 纯函数（rpc 事件→AgentEvent v2）+真实事件 fixture（pi -p --mode json 采样脱敏）+每型用例+usage 映射+未知降级+zod 校验 |
| task-04 | caps 三端 pi 键+注册+装配 | W1 | P0 | — | FR-04, FR-03 | providers.ts 条目（family=pi_json/capsOf）+三端镜像+EXPECTED_PROVIDERS 补 pi+cli.ts 装配行+detector minVersion '0.81.0'；caps 初值：resume/multimodal/thinking/model_select=true，mcp/edit_patch/permission_dialog/subagent=false；provider-registry.test.ts 用例 1/3/5 补 pi（键集合断言/实例化）；backend 对齐测试 EXPECTED_PROVIDERS 补 pi |
| task-02 | PiRpcDriver 核心 | W2 | P0 | task-01 | FR-01 | pi-rpc-driver.ts：rpc 子进程 spawn（pi.cmd shim 解析）+LF 严格分帧器+命令收发（id 关联 pending）+InteractiveDriver 契约（handle/provider E5）+get_state 握手 |
| task-03 | Driver 高级语义 | W3 | P0 | task-02 | FR-01 | inject 三模式（prompt/steer/follow_up+images）+session_started 合成+agent_settled 收敛→onTurnResult+extension_ui_request 自动取消+resume（--session-id/switch_session）+interrupt（abort）+crash 会话级 fail+streaming 状态判定（rpc-client.ts 参照） |
| task-05 | 前端引擎白名单+可选性测试 | W4 | P1 | task-04 | FR-04 | sessions/pre-session-picker.tsx+runtime-session-helpers.tsx 加 pi；选择器渲染测试 |
| task-06 | subagent 实证 | W4 | P1 | task-02, task-03 | FR-03 | examples 扩展定位/vendor 或包内路径解析→真实跑一次子代理→事件归属形状实测：可落 parent 三列则 caps.subagent 翻 true（三端同步+守护测试过），否则如实 false+报告记录 |
| task-07 | 冒烟收口+案例锚 | W5 | P0 | task-03, task-05 | FR-05 | 真实 PI 会话全链路冒烟（§8+创建/工具/partial/usage/inject/interrupt/resume/双轨落库）+onboarding §5 档C 案例锚（12 步勾选+task-06 subagent 结论落锚，W3 先行保证时序）+顺修档B 盲区（EXPECTED_PROVIDERS 断言必改/装配行与白名单未列，按实质不拘步骤号） |

## 关键路径
task-01 → task-02 → task-03 → task-07（归一化器→driver 核心→高级语义→冒烟收口）

## 全局验收标准
1. 相关模块测试全绿（daemon vitest interactive 家族+provider-registry/caps 对齐；frontend 白名单用例；仅跑本变更相关，全量留 CI）
2. 真实 PI 会话冒烟清单全过（FR-05），claude/codex 零回归
3. caps 三端一致且与实测相符（守护测试+EXPECTED_PROVIDERS 含 pi）
4. 档C 12 步勾选记录进 onboarding；subagent 结论（true/false）如实落锚

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-02, task-03 | rpc 长驻全命令面+收敛语义 |
| D-002@v1 | task-04, task-06 | caps 三态+subagent 实证翻值纪律 |
| FR-01 | task-02, task-03 | driver 契约测试+冒烟 |
| FR-02 | task-01 | 归一化器用例 |
| FR-03 | task-04, task-06 | caps 表+实证 |
| FR-04 | task-04, task-05 | 注册/装配/白名单/对齐测试 |
| FR-05 | task-07 | 冒烟记录+案例锚 |
