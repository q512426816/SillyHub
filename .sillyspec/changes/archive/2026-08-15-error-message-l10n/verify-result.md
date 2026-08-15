---
author: qinyi
created_at: 2026-08-15T14:25:00+08:00
change: 2026-08-15-error-message-l10n
---

# 验证报告

## 结论

PASS WITH NOTES

核心目标达成；3 处 f-string 动态串漏网（守护测试文档化盲区）+ ssrf clone 链路范围决策待重评，记为后续 quick 收口，不阻断归档。

## 任务完成度

- task-01~10 全部完成（plan checkbox 全勾，10 个 task review.json 全 pass）。
- 8 Wave 实改约 250 处文案 + 73 处测试断言同步 + 守护测试（80 用例）。
- 执行中合理扩围 18 文件（测试断言同步/QA 修复/范围修正）已回补 design §7 清单并通过 apply 对账。

## 设计一致性

- FR-01 范围覆盖：design §7 清单源文件纯字面量英文清零（独立重扫证实；残留均为 design §2 不做清单的机器接口——daemon 内部 RPC 76 处/mcp tools+sse/platform_sync/core 启动期，及 snake_code 机器码经 members_router 翻译层转中文）。
- FR-02 技术信息：12+ 处抽查 UUID/ID 全部进 details，多项增补（git_gateway 加 branch/timeout_seconds、agent 加 workspace_id）。
- FR-03 契约零变更：git show 57c08833 --stat 零 frontend/openapi/migration 改动；异常类 -/+ 对称；唯一 code 变化是 design §4.4 明示的 dict detail 预存缺陷修复（users_service 3 处 409/422 走 AppError 通道，xfail 测试转真断言）。
- FR-04 机器接口未动：daemon 子包/mcp tools+server+sse/platform_sync diff 为空。
- FR-06 守护测试：PENDING 空、glob 含 *router*.py、ALLOWED_ENGLISH 5 条带理由、死代码已删、snake_code/f-string 豁免文档化。

## 探针结果

不适用（纯文案变更，无运行时探针）。

## 测试结果

- backend 全量 4378 passed / 0 failed（execute 期，非 daemon 3535 + daemon 843）。
- verify 期复跑抽样：守护测试 80 passed；ppm 496 passed（基线严格一致，已上线模块零回归）+ tests/modules/ppm 12 passed；git_gateway 88 passed；auth 168 passed 2 xfailed（预存 RED 标记）；change dispatch 52 passed。
- ruff check/format + mypy 全过。

## 变更风险等级

低。纯 message 字符串改写，无逻辑/schema/契约变化；ppm 已上线模块全量回归一致。

## Notes（后续 quick 收口清单）

1. tool_gateway/policy_router.py:164-167 delete_policy 404 英文 f-string（settings 页可达，漏网）。
2. agent/coordinator.py Run-not-found 族 7 处英文 f-string（经 agent/router 404 直达前端）。
3. worktree/git_runner.py:57 git 超时 f-string（经 WorktreeAcquireFailed 503 直达前端）；连带重评 ssrf.py UnsafeRepoUrl 5 条在 clone 链路（400 直达前端）的范围决策。
4. P3：design §7 多列了 tests/modules/change/test_dispatch.py（实测本无英文断言，不改是正确的）。
