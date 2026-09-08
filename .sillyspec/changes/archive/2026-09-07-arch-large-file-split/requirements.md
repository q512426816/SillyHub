---
author: qinyi
created_at: 2026-09-07 08:32:48
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 开发者 | 平台维护者，拆分的直接受益人（可维护性）与执行人 |
| 在途变更执行者 | conflict-resolve-entry 等并行变更的作者，依赖导入兼容层不被拆分破坏 |
| CI | 全量测试与类型/lint 检查的最终守护方 |

## 功能需求

### FR-01: 拆分范围限定
覆盖决策：D-001@v1

Given 三端会话域 8 个大文件与在途变更 8 个排除文件并存
When 执行拆分
Then 只触碰清单内 8 个目标文件及其新拆出子模块；daemon.ts、hub-client.ts、config.ts、protocol.ts、sillyspec-manager.ts、backend protocol.py / runtime/service.py / ws_hub.py / lease/context.py 零改动（git diff 为空）

### FR-02: 三端兼容层——导入与 mock 零破坏
覆盖决策：D-004@v1, D-006@v1

Given 现有 62 个 session-manager 引用方、23 个 task-runner 引用方、140 条 `@/lib/daemon` import（133 文件）、55 处 `vi.mock('@/lib/daemon')`、session-panel 7 个导出符号的消费方
When 完成三端拆包（Python 同名包 / TS 瘦 facade / bundler 目录化）
Then 全部现有 import 语句、vi.mock 路径与模块形状原样工作；session-panel/index.tsx 再导出 7 符号（SessionPanel、SessionPanelProps、SessionPreContext、BashProgressState、applyBashStatusEvent、appendBashChunk、applyAgentTaskStatusEvent）

Given backend 现有 157 处 `patch("app.modules.daemon.<mod>.<sym>")` 字符串目标（session.service 69 / run_sync.service 45 / group.service 33 / router 10）
When 方法体下沉到子模块
When 子模块对被 patch 符号经原模块命名空间延迟解析（D-007 规则）
Then 全部 patch 目标在拆分后仍可拦截，既有测试零修改通过

### FR-03: 3 Wave 顺序交付
覆盖决策：D-003@v1

Given 三端拆分互不依赖
When 推进执行
Then 按 Wave 1 daemon → Wave 2 backend → Wave 3 frontend 顺序；每 Wave 结束该端定向测试全绿后才进入下一 Wave；不建 MASTER、不拆子变更

### FR-04: 行数达标
覆盖决策：D-005@v3

Given 8 个目标文件当前行数（5438/3426/7176/5468/4844/4055/6620/4090）
When 拆分完成
Then 新拆出子模块 ≤800 行；原文件保留核心编排 ≤2500 行；两项显式豁免：session-panel-page.tsx ≤3000、session-panel-dialog.tsx ≤2000（R-03 闭包状态回归风险优先）

### FR-05: 轻重构白名单 6 项
覆盖决策：D-002@v1, D-005@v3

Given 白名单外禁止顺手改（Non-Goals 4+ 项成文）
When 执行轻重构
Then 只完成：① daemon payload-utils 统一鸭子读取器；② event-wire 收敛平行转换；③ backend 后台任务 mixin；④ Redis publish helper 统一；⑤ 附件管线收敛；⑥ dialogResult 提取收敛——每项独立提交并带定向测试；白名单外零额外行为改动

### FR-06: 行为零变化验收
覆盖决策：D-006@v1, D-007@v1

Given 现有测试套件（daemon 62+23 相关、backend daemon/tests 约 70 相关、frontend components/daemon/__tests__ 58 个）
When 拆分完成
Then 全部相关测试文件内容不变且通过；daemon/backend/frontend 各端类型检查与 lint 通过；backend openapi.json 拆分前后零 diff

## 非功能需求

- 兼容性：跨 Windows/Linux/macOS（纯代码搬移，无平台特定逻辑引入）；Node ESM 子包 import 一律带 `.js` 扩展名
- 可回退：每 Wave 每任务独立 git 提交可单独 revert；兼容层使回退不影响消费方
- 可测试：每方法簇搬移后立即跑定向测试；轻重构每项带新增定向测试文件（不改既有测试）

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | 拆分范围 8 文件 + 在途排除清单 |
| D-002@v1 | FR-05 | 拆分+轻重构策略与白名单边界 |
| D-003@v1 | FR-03 | 单变更 3 Wave 交付 |
| D-004@v1 | FR-02 | 方案 A 目录化拆包+兼容层 |
| D-005@v3 | FR-04, FR-05 | 粒度目标（≤800/≤2500/双豁免）与白名单 6 项（v1/v2 已被取代） |
| D-006@v1 | FR-02, FR-06 | 现有测试零修改硬验收 |
| D-007@v1 | FR-02, FR-06 | monkeypatch 命名空间延迟解析规则 |

无未覆盖决策，无剩余风险决策。
