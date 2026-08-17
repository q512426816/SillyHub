---
author: qinyi
created_at: 2026-08-17 08:52:32
---

# 任务蓝图（Tasks）— CLI 直跑 spec 文件增量同步

## 任务列表

- [ ] task-01：后端清单接口（GET /api/changes/spec-manifest）
- [ ] task-02：后端增量同步接口（POST /api/changes/spec-sync）
- [ ] task-03：后端 shpsync_ 鉴权通道与测试
- [ ] task-04：CLI spec-sync.js 增量 diff 模块
- [ ] task-05：CLI sync.js 接入 syncSpecTree()
- [ ] task-06：CLI 端到端测试
- [ ] task-07：verify 全量回归
- [ ] task-08：模块文档与归档

## Wave 划分

**Wave 1：后端接口 + 鉴权**
- task-01：新增 `GET /api/changes/spec-manifest` 端点、schema、service.get_manifest。
- task-02：新增 `POST /api/changes/spec-sync` 端点、schema、service.apply_spec_ops 包装。
- task-03：确认/补齐 shpsync_ 对新增端点的鉴权；新增 `backend/app/modules/platform_sync/tests/test_spec_sync.py` 覆盖清单、增量、冲突、鉴权。

**Wave 2：CLI 增量同步**
- task-04：新增 `sillyspec/src/spec-sync.js`，实现 walk/hash/diff/POST ops，无差异短路，冲突/失败静默。
- task-05：修改 `sillyspec/src/sync.js`，在 `sync()` 成功路径追加 `syncSpecTree()`。

**Wave 3：CLI 测试 + 回归**
- task-06：新增 `sillyspec/test/platform-spec-sync-incremental.test.mjs`：有差异时生成正确 ops、无差异短路、conflict 不阻塞。
- task-07：backend 全量 pytest + frontend vitest + CLI 测试套件回归。
- task-08：更新模块文档，归档。

## 依赖关系

```
Wave 1 (task-01~03) ──> Wave 2 (task-04~05) ──> Wave 3 (task-06~08)
```

## 验收标准

1. 本地跑 `sillyspec run quick --done` 后，平台变更文件树能自动更新（无需手动同步）。
2. 只修改一个 plan.md 时，同步请求只包含该文件 op。
3. 冲突场景下 CLI 提示但不报错，进度同步与四件套直推不受影响。
4. 老后端 404 时 CLI 静默跳过。
5. backend 新增端点测试、CLI 增量测试、既有回归测试全绿。
