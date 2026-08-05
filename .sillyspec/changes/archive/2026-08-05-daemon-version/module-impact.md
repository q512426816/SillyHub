---
author: WhaleFall
created_at: 2026-08-04 13:40:00
---

# 模块影响分析（Module Impact）— daemon 版本可见与构建号自动注入

## 变更范围
daemon 上报的版本字段（daemon_version/daemon_build_id）在 backend runtime 读端可见（6 端点 JOIN 修复）+ 构建号 BUILD_ID 每次 build 自动注入（gen-build-id.mjs，dev/prod 同源）。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| daemon | 逻辑变更 | backend/app/modules/daemon/runtime/service.py | list_runtimes 等 5 处加 JOIN DaemonInstance，返回 (runtime, instance) tuple（照搬 list_runtimes_page） | false |
| daemon | 逻辑变更 | backend/app/modules/daemon/router.py | 6 个 runtime 端点调 _runtime_read 填充 daemon_version/daemon_build_id + list-leases/instances 调用点同步 | false |
| daemon | 调用关系变更 | backend/app/modules/daemon/service.py | facade DaemonService 注解同步 task-07 tuple 签名（运行时转发不变） | false |
| daemon | 新增（测试） | backend/app/modules/daemon/tests/test_runtime_version_visibility.py | 8 用例验证 6 端点 daemon_version 非 null + 旧 daemon NULL 兼容 | false |
| daemon（sillyhub-daemon 本体） | 配置/构建变更 | sillyhub-daemon/scripts/gen-build-id.mjs（新）、scripts/build-bundle.sh、package.json | gen-build-id.mjs 跨平台生成 BUILD_ID（git-sha+ts，无注解格式兼容 backend 正则）；package.json prebuild+postinstall；build-bundle.sh 改调 gen（源头单一） | true |
| daemon（sillyhub-daemon 本体） | 新增（测试） | sillyhub-daemon/tests/gen-build-id.test.ts、tests/daemon-report-smoke.test.ts | gen 输出正则回归（守护 self-update）+ daemon 上报冒烟（BUILD_ID 非空 + register/heartbeat body） | true |

> needs_review=true 说明：sillyhub-daemon/scripts/、tests/、package.json 不在 `_module-map.yaml` daemon 模块 paths `sillyhub-daemon/src/**` 的严格 glob 内，但语义上属 daemon 本体（构建脚本 + 测试），归 daemon 模块；建议后续 scan 把 daemon paths 扩为 `sillyhub-daemon/**`（含 scripts/tests/package.json）。

## 未匹配文件
无（9 个 git diff 文件全部归 daemon 模块；sillyhub-daemon 非 src 文件语义归 daemon 本体，标 needs_review=true 待 scan 扩 paths）。

## 三重交叉验证
- **声明范围**（design §6 文件清单）：gen-build-id.mjs / build-bundle.sh / package.json / .gitignore / build-id.ts / runtime service.py / router.py / facade service.py / 3 测试。
- **任务范围**（plan.md + tasks/task-01~11）：task-01~11 覆盖全部。
- **真实变更**（git diff HEAD~1）：9 文件（上述矩阵；.gitignore 无改动因 task-02 验证已脱版控、build-id.ts 被 .gitignore 不进 git）。
- **以 git diff 为准**：9 文件全匹配，声明/任务一致。

## 不变项（归档备注）
- daemon 上报逻辑（hub-client.ts）：不变（已正确上报 DAEMON_VERSION + BUILD_ID）。
- 前端 /runtimes（C-002）：不变（已用 machines 端点显示版本）。
- 语义版本 0.1.0（package.json）：不变（手动管理大版本）。
- daemon 生命周期（register/heartbeat/session/lease）：不变。
