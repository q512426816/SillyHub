---
author: qinyi
created_at: 2026-08-17 08:52:32
change: 2026-08-17-spec-file-incremental-sync
project: multi-repo
---

# 模块影响分析 — 2026-08-17-spec-file-incremental-sync

> author: qinyi
> created_at: 2026-08-17 08:52:32

## 影响面总览

跨仓变更（main + sillyspec），复用 daemon 已验证的增量同步协议到 CLI 直跑场景。backend 新增两个端点（清单读取 + ops 应用），CLI 新增增量同步模块并接入四件套同步后。影响 2 仓共 13 个文件。

## 受影响模块清单

### main 仓

| 模块 | 文件数 | 影响 | 回归方式 |
|---|---|---|---|
| platform_sync | 3 | router.py 新增两个 /api/changes/-/spec-* 端点、schema.py 新增 3 个 schema、service.py 新增两个 wrapper | 模块内 test_spec_sync.py + 现有 tests |
| spec_workspace | 1 | service.py 新增 get_manifest() 方法读取 SpecFileManifest | 模块内 tests + spec_sync 间接验证 |
| openapi.json / api-types.ts | 2 | 后端 schema 改动后自动生成 | task-08 gen:types 验证 |

### sillyspec 仓

| 模块 | 文件数 | 影响 | 回归方式 |
|---|---|---|---|
| spec-sync（新增） | 1 | CLI 增量同步核心：读配置/walk/hash/diff/POST ops | task-09 单元测试 + task-10 CLI 集成 |
| sync | 1 | sync.js 成功路径追加 syncSpecTree() 调用 | task-07 + task-10 集成验证 |
| test | 1 | 新增 platform-spec-sync-incremental.test.mjs | task-09 自身 |

## 模块文档同步

task-10 收尾时更新：
- `.sillyspec/docs/multi-agent-platform/modules/platform_sync.md` 补「增量同步端点开放给 CLI」条目
- `.sillyspec/docs/multi-agent-platform/modules/sillyspec.md` 补「CLI 直跑增量同步」条目

## 不受影响

- daemon 模块：完全不动（复用其协议，不改造其实现）
- 四件套直推链路：保留独立（POST /documents），与文件树增量同步正交
- 前端全部文件：零改动（文件树 UI 已存在，只是内容源由 daemon 推送改为 CLI 推送）
- 数据库 schema/migration：零改动（SpecFileManifest 表已存在，仅新增读端点）
- 现有 tests：零改动（新增测试文件覆盖新能力）
