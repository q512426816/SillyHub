---
plan_level: full
execution_mode: main  # dispatch=子代理派发（判据见执行模式声明；缺省 main 直写——R7/R8 对撞实证）
---

# 实现计划（Plan）

## Spike 前置验证
无 Spike——技术不确定性已在 brainstorm 前置实测消解（2026-10-15 两轮协议探测：信封/方法面/事件流/配置注入全链路跑通，证据锚见 decisions.md D-005 evidence）。

## Wave 1（并行，无依赖）
- task-01
- task-02
- task-06

## Wave 2（依赖 Wave 1）
- task-03
- task-07

## Wave 3（依赖 Wave 2）
- task-04

## Wave 4（依赖 Wave 3）
- task-05

## Wave 5（依赖 Wave 4）
- task-08

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | daemon 探测与版本门（fallbackPaths/execNode 扩展 + protocol='ndjson' + MIN_VERSIONS） | W1 | P0 | — | FR-01, D-001@v1, D-004@v1 | agent-detector.ts + version.ts + 探测单测 |
| task-02 | ZCode 私有协议信封层（NDJSON strict 四分支 + 服务端请求分发器） | W1 | P0 | — | FR-02, FR-04, D-005@v1, D-007@v1 | NEW:adapters/zcode-envelope.ts + 单测 |
| task-03 | 事件归一化器（stream.chunk 双通道/工具生命周期/usage/turn 边界/模型目录） | W2 | P0 | task-02 | FR-02, D-005@v1 | NEW:interactive/zcode-events.ts + 实测序列单测 |
| task-04 | app-server 驱动（就绪门/create-send-stop-close/代答桥/结构化错误） | W3 | P0 | task-02, task-03 | FR-02, FR-03, FR-04, FR-08, D-005@v1 | NEW:interactive/zcode-app-server-driver.ts + 驱动单测 |
| task-05 | 注册与模型路由（zcode-settings.ts + providers.ts 注册 + 类型联合加宽 + caps 镜像刷新） | W4 | P0 | task-04 | FR-05, FR-06, D-002@v1, D-003@v1 | 含 gen-provider-caps.mjs 三端镜像 |
| task-06 | backend 枚举 + gen:types 双义务（InteractiveProviderLiteral 加 "zcode"） | W1 | P0 | — | FR-02 | schema.py + api-types.ts + openapi.json 双端重生成 |
| task-07 | frontend 单聊引擎选项（SESSION_ENGINE_OPTIONS 加 zcode + 快照） | W2 | P1 | task-06 | FR-07 | session-list-panel.tsx |
| task-08 | 端到端冒烟（创建/对话流式/打断/审批/路由注入/stdin EOF 记录） | W5 | P0 | task-01, task-04, task-05, task-06, task-07 | 成功标准收口 | 本机实测 + CI 无引擎 skip 留痕 |

## 关键路径
task-02 → task-03 → task-04 → task-05 → task-08（驱动核心线，决定最短交付周期）

## 全局硬约束（从 design.md 逐字抄录，绑定所有 task）
- 零新增 npm 依赖（G 约束，D-005）；禁止改动 sillyhub-daemon/src/adapters/json-rpc.ts（codex 在用，D-007）
- 禁止触碰 backend/app/modules/daemon/group/service/messages.py（群附件门控归 dsh 变更，代码不重叠）
- Windows/Linux/macOS 三平台兼容（.cjs 经 process.execPath、路径分隔符、fallbackPaths 平台变量展开）
- apiKey 明文落 per-session provider_config.json（与 codex auth.json 同级安全姿势；per-session 目录随现有清理管线销毁；zcode 会话库机器共享不随平台清理——D-002）
- 握手/协议失败 → 结构化 error + 会话 failed，不重试不降级（D-004）
- 版本门警告不硬拒：MIN_VERSIONS `zcode: (0,16,9)`，低于输出与四引擎同格式警告
- caps 十六键按 design 接口定义定值（dialog='native'、steering=false、sessionFork='none' 等），gen:types 双义务（frontend + sillyhub-daemon api-types 同变更内提交，CLAUDE.md 规则 21）
- UI 与文档默认中文（引擎显示名/标签）

## 全局验收标准
1. 聚焦测试全绿：daemon（zcode-envelope/zcode-events/zcode-app-server-driver/探测/注册表守护）+ backend（Literal 校验）+ frontend（快照）——仅跑本变更相关测试，全量留给 CI
2. 现有引擎行为零回归：探测/注册为增量条目，但既有守护测试的精确断言须同步更新并全绿——task-01 认领 agent-detector.test.ts 计数/键表断言（toHaveLength(12) 等 → 13），task-05 认领 provider-registry.test.ts 注册表键集断言（['claude','codex','cursor','pi'] → 加 'zcode'）；批量层 sixProtocols 断言经核不受影响
3. 端到端冒烟（装有 ZCode Desktop 的本机）：创建 zcode 单聊 → 一轮对话（text/thought token 流式 + 工具事件落库渲染）→ 打断 → 审批代答三态 → LlmProvider 注入路由生效；stdin EOF 退出行为记录（R-05）
4. 与 dsh 变更文件级不重叠（messages.py 不动；共同文件为增量条目）

## 覆盖矩阵（如存在 decisions.md）
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01 | 探测单测（三段式 + execNode + fallbackPaths） |
| D-002@v1 | task-05, task-08 | perSessionDir 隔离 + 冒烟观察会话库共享行为 |
| D-003@v1 | task-05, task-08 | provider_config.json 写入器单测 + 冒烟路由生效 |
| D-004@v1 | task-01, task-04 | MIN_VERSIONS 单测 + 驱动握手失败结构化错误单测 |
| D-005@v1 | task-02, task-03, task-04 | 信封/事件/驱动三件套单测 |
| D-006@v1 | （rejected 登记） | 无 FR 覆盖需求，背景性引用 |
| D-007@v1 | task-02 | 信封层独立文件 + json-rpc.ts 零改动（git diff 验证） |
