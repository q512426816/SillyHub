---
plan_level: full
---

# 实现计划（Plan）：模型思考级别选择（v2 全量）

## Spike 前置验证（如需要）

| Spike | 验证内容 | 不通过后果 |
|---|---|---|
| spike-01 | codex 真机 thread/settings/update {reasoningEffort} 形状+turn/start 顶层字段 | task-04 codex 切换报不支持（多会话场景不用 config.toml 降级）；创建设置走 config.toml 仅单会话场景 |
| spike-02 | claude SDK applyFlagSettings+supportedModels 真机直调 | 档位查询降级 init 响应缓存/静态五档；切换降级 caps=false |

> 两 spike 并入 task-07（R-01/R-02/R-03 降级路径完备）。

## Wave 1
- task-01

## Wave 2（依赖 Wave 1；task-05 依赖 task-01 的 caps @generated）
- task-02
- task-05

## Wave 3（依赖 Wave 2）
- task-03
- task-06

## Wave 4（依赖 Wave 3）
- task-04

## Wave 5（依赖 Wave 4）
- task-07

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | caps 第 13 键+codex thinking 翻值 | W1 | P0 | — | FR-01 | 八步样板+codex 表翻值（声明对齐） |
| task-05 | backend 全链+两端点 | W2 | P0 | task-01 | FR-03/04/05 | schema 三 DTO+create 形参+placement+lease+_ENDPOINT_ORDER+GET/POST 端点+服务（照 compact.py）+**gen:types（P1-2）**+测试 |
| task-02 | 共享词表+映射矩阵 | W2 | P0 | task-01 | FR-02 | thinking-levels.ts 七档+矩阵+校验+单测 |
| task-06 | 前端双控件 | W3 | P0 | task-01, task-05 | FR-06 | 两 API+创建下拉静态镜像+会话切换控件+门控+vitest |
| task-03 | daemon 契约+守卫+RPC handler+全链透传 | W3 | P0 | task-02 | FR-02/03 | driver 可选两方法+StartOptions.thinkingLevel+session-manager 子模块+daemon.ts 两 handler+execPayload 归一化+测试 |
| task-04 | 三 driver 实现 | W4 | P0 | task-03 | FR-03/04/05 | pi 双命令+启动时序；claude m.value+model 传参+applyFlagSettings；codex 双方法+turn params+pending 通道 |
| task-07 | 文档+真机三引擎 | W5 | P0 | task-04, task-05, task-06 | FR-07 | onboarding+spike-01/02+pi 双命令实证+QUICKLOG |

## 关键路径

task-01 → task-02 → task-03 → task-04 → task-07（daemon 契约链最重）

## 全局验收标准

1. caps 三端一致+守护绿+幂等+codex thinking 翻值守护同步
2. backend：两端点三校验/创建全链到达 driver（断链已修）/DTO/pytest 绿
3. daemon：映射矩阵单测（七档×三引擎+降级）/三 driver mock/守卫/RPC handler/typecheck
4. frontend：四分支 vitest+tsc+eslint
5. 真机：三引擎各创建选档+查询+切档回执（QUICKLOG）
6. brownfield：旧 daemon/cursor/不支持档/既有链零回归
7. 集成：RPC 全链测试+真机

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | 全任务 | 验收 1-7 |
| D-002@v1 | task-02/03/04/05/06 | 验收 2/3/4/7 |
