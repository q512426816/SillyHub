---
author: qinyi
created_at: 2026-08-31 08:24:54

plan_level: full
---

# 实现计划（Plan）：机器列表 sillyspec 版本显示与远程升级

## Wave 1（并行，无依赖）
- task-01
- task-02
- task-04

## Wave 2（依赖 Wave 1）
- task-03
- task-05

## Wave 3（依赖 Wave 2 的 task-03）
- task-06

## Wave 4（依赖 Wave 3）
- task-07

## Wave 5（依赖全部）
- task-08

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | backend 协议与 WS 通道 + backend 契约测试 | W1 | P0 | — | NFR-01, D-001@v1 | protocol.py 常量 + ws_hub.send_sillyspec_update + backend test_protocol_session_contract.py EXPECTED map（无总数断言，安全；TS 镜像测试随 task-05——其断言的 protocol.ts 常量在 task-05 才有，W1 时序倒置，Plan Review PL-01） |
| task-02 | backend DB 与落库语义 | W1 | P0 | — | FR-05, D-002@v1 | model 3 列 + alembic 迁移 + register/heartbeat DTO + RuntimeService 落库（register 无条件写/心跳非 None 覆盖/update 无键清除）+ 落库语义单测（test_machine_sillyspec.py 落库部分，AC-3） |
| task-03 | backend 端点与机器读视图 | W2 | P0 | task-01, task-02 | FR-02, FR-01 | POST /machines/{id}/sillyspec-update + _build_machine_read 显式组装 + MachineSillySpecUpdateRead + DaemonMachineRead 字段 + 端点测试 |
| task-04 | daemon sillyspec-manager 模块 | W1 | P0 | — | FR-03, FR-04 | 探测缓存/升级执行/状态机（in-flight/deferred 30s/终态 10min）+ preflight 导出复用 + 单测 |
| task-05 | daemon 接线 | W2 | P0 | task-04 | FR-04, FR-05, NFR-01 | config 字段 + protocol.ts + _sillyspecLoop + hub-client 可选参 + daemon.ts 心跳/注册/case + 心跳 body 单测 + TS 契约镜像测试（EXPECTED map + 字面量断言 + MSG 计数 21→22，PL-01）+ config.test.ts DEFAULT_CONFIG 键表 29→30（PL-02） |
| task-06 | 前端 API 层 | W3 | P0 | task-03 | NFR-03 | pnpm gen:types（api-types.ts + openapi.json）+ lib/daemon.ts triggerMachineSillySpecUpdate |
| task-07 | 前端机器卡 UI | W4 | P0 | task-06 | FR-01, FR-02, FR-03 | 徽标三形态/按钮 5 态/横幅四态 + page handler + 组件测试（对照原型 8 场景） |
| task-08 | 回归收口 | W5 | P0 | task-01…task-07 | 全部 | daemon 套件 + backend daemon 模块测试 + frontend 组件测试全绿；tsc/ruff/mypy/format 0 错 |

## 关键路径
task-02 → task-03 → task-06 → task-07 → task-08（backend 落库 → 端点/视图 → 类型再生 → UI → 回归）

## 全局验收标准
1. daemon 相关测试套件、backend daemon 模块测试、frontend machine-card 组件测试全部通过；tsc / ruff / mypy / format 0 错。
2. 契约双侧镜像：backend `test_protocol_session_contract.py` 与 TS `protocol-session-contract.test.ts` 均含 `daemon:sillyspec_update` 字面量断言。
3. 心跳/register 落库语义分支单测覆盖（register 含 null 直写、心跳缺省/null 保留、update 无键清除）——对应 D-002@v1。
4. （brownfield）旧 daemon/旧 backend 组合不破坏：心跳多带字段被忽略、缺省字段不误清除（FR-05 测试体现）。
5. 集成敏感（integration-critical 判级）：真实集成冒烟——本地起 daemon + backend，验证注册报文带版本、心跳落库、sillyspec-update 端点触发 daemon 日志出现升级执行、机器列表 API 返回 3 新字段（verify 阶段留证据）。
6. 前端机器卡三形态/按钮 5 态/横幅四态与 prototype-machine-sillyspec.html 8 场景一致。

## 覆盖矩阵（如存在 decisions.md）
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-02, task-03, task-04, task-05 | AC-2（协议字面量双侧）、AC-5（WS 触发链路） |
| D-002@v1 | task-02 | AC-3（落库语义分支单测） |
| FR-01 | task-03, task-07 | 机器卡徽标三形态（AC-6） |
| FR-02 | task-03, task-06, task-07 | 端点 504/禁用态/高亮（AC-5、AC-6） |
| FR-03 | task-04, task-05, task-07 | 横幅四态 + 版本刷新（AC-6） |
| FR-04 | task-04, task-05 | 自动循环 + 忙推迟单测（AC-1） |
| FR-05 | task-02, task-05 | AC-3、AC-4 |
| NFR-01 | task-01, task-05 | AC-2 |
| NFR-02 | task-04 | runWithTreeKill 复用（实现内约束） |
| NFR-03 | task-06 | AC-1（gen:types 产物提交） |
