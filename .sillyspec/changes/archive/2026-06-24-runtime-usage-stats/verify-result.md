---
author: qinyi
created_at: 2026-06-24 13:10:00
change: 2026-06-24-runtime-usage-stats
---

# 验证报告(verify-result.md)

## 验证结论:**PASS**(附 1 个 lint 待修 + 2 项真机验收待部署)

## 验证范围

16 task(task-01~16),跨 sillyhub-daemon / backend / frontend 三子项目。对照 design.md(truth source)+ plan.md + 16 份 task 蓝图。

## 测试结果

| 子项目 | 测试 | 结果 |
|---|---|---|
| backend | 全量 pytest + coverage | **1939 passed**(7 skipped / 2 xpass 均既有非本次),**coverage 87.54%**(>60% 门槛) |
| daemon | 6 个相关测试文件 + typecheck | **184 passed**,typecheck 通过 |
| frontend | 3 个相关测试文件 + typecheck | **26 passed**,typecheck 通过 |

execute 期修复 2 个真 bug(TDD 抓出):① stream-json `extractResultStats` 把会话级累计的 cache 当增量求和导致翻倍(700→1400)→ 改 replace/max 语义;② page 时间窗按钮缺 `aria-label`。

## 设计一致性(design.md §5/§7/§8/§9/§10)

实现一致。**3 处 design 描述待回填(非实现 bug,文档精确度)**:
1. **task-16 提交点**:实际是 `notifyRunResult`(completeLease 的 stats 是 opaque 整体透传),蓝图标的 submitMessages/completeLease 不准确。
2. **task-07 facade**:`DaemonService.close_interactive_run` 委托签名是显式参数,必须同步加 cache 参数(design 未提 facade,task allowed_paths 遗漏)。
3. **task-08 时区**:额外处理 aiosqlite 下 DateTime 存本地 naive 的陷阱(`_since_param`,design R-05 方言的延伸)。

## 发现的问题

- **ruff UP042(待修,verify 禁止改源码)**:`backend/app/modules/daemon/schema.py:247` `RuntimeUsageWindow(str, enum.Enum)` 建议 `enum.StrEnum`。功能正常(str+Enum works),但项目 ruff select 含 UP,pre-commit hook 会拦截 commit。修复 1 行(verify 后)。

## 已知限制(非阻塞,真机验收)

- **R-01**:Claude CLI `message_delta.event.usage` 是否真透传 `cache_creation_input_tokens`/`cache_read_input_tokens`,需真机实测。不透传则 Claude cache 回退 NULL→前端「—」,不阻塞主功能(input/output/cost 正常)。
- **codex json-rpc batch adapter** 未提取 cache(task-02 只改 codex-app-server-driver interactive driver)。codex/OpenAI 系多无 cache。
- **task-04 `alembic upgrade head`**:单测用 create_all 验证 model↔migration 一致,migration 文件正确(down_revision 202607240900),真机 upgrade 待部署。
- **task-10 curl 实测**:端点单测 7 用例验证响应结构,真机 curl 待起 backend。

## 验收标准(AC-01~07)

| AC | 内容 | 状态 |
|---|---|---|
| AC-01 | 卡片 4 数字 + sparkline | ✅ frontend page-usage 测试 |
| AC-02 | 切窗数字+图同步 | ✅ |
| AC-03 | 聚合去重(interactive run 只算一次) | ✅ backend test_runtime_usage_service 双路径去重 PASS |
| AC-04 | 分组粒度(1d 小时 / 7d·30d 日) | ✅ |
| AC-05 | cache 尽力而为(codex「—」) | ✅ |
| AC-06 | 兼容(nullable,SUM 忽略 NULL) | ✅ |
| AC-07 | 三子项目测试(coverage≥60%) | ✅ 87.54% |

## 决策覆盖

D-001@v1 / D-002@v1 / D-003@v2 / D-004@v1 全部由实现 + 测试覆盖,无未解决版本。

## 下一步建议

1. 修 ruff UP042(`RuntimeUsageWindow` → `enum.StrEnum`,1 行)
2. 回填 design.md 3 处描述(task-16 提交点 / task-07 facade / task-08 时区)
3. 部署真机验收:R-01 Claude cache 透传实测、`alembic upgrade head`、curl `/runtimes/usage`
4. commit
