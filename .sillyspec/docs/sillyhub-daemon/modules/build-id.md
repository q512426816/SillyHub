---
schema_version: 1
doc_type: module-card
module_id: build-id
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 构建标识常量（build-id）

## 定位
构建标识常量，仅 1 行有效代码。`BUILD_ID = "7d0bfa03-20260818010001"`（内嵌主仓 commit 7d0bfa03 + 构建时间戳），由 `scripts/gen-build-id.mjs` 自动生成，头部注释明示 do not edit。

## 契约摘要
- 唯一导出：`BUILD_ID: string`。
- 消费方：hub-client（register/heartbeat 的 `daemon_build_id` 字段上报 backend，写入 daemon_instances.build_id）、daemon、preflight（自更新按 backend manifest 对齐 bundle 时比对）。
- 与 daemon-version 的分工：`DAEMON_VERSION` 是语义版本（npm 包版本），`BUILD_ID` 是 git SHA 维度的构建标识，两者在上报时成对携带。

## 关键逻辑
```text
BUILD_ID = "<主仓 commit 前 8 位>-<YYYYMMDDHHMMSS 时间戳>"
```

## 注意事项
- 生成物，禁止手改；发布/打包流程跑 `gen-build-id.mjs` 刷新。
- 值只用于可观测与版本对齐，不参与任何鉴权或身份判定（身份是 config.runtime_id）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
