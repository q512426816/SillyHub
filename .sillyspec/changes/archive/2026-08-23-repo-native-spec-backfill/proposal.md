---
author: qinyi
created_at: 2026-08-23 21:25:00
---

# 提案（Proposal）— 修复 repo-native 工作区 spec 回灌断链

## 动机

repo-native 工作区（源项目 `.sillyspec` 为真理源，daemon 建 junction 缓存指回源项目）的本地 agent 会话产出无法到达平台变更中心。根因是三边叠加：

1. backend `build_scan_bundle` 对所有策略无条件注入 `--spec-root` 等平台参数（`context_builder.py:420`），与 stage 派发的 `platform-managed` 门禁（`service.py:1358`）不对称；
2. CLI 因平台指针进入平台模式后禁用内置 sync（`run/shared.js:534-536`），指针/接管声明一旦落盘即长期锁死本地模式（`run/command.js:309-359`，声明还 fail-closed）；
3. daemon 回灌仅三触发点（tar 会话结束 / 手动按钮 / pull 前回灌），repo-native junction 永不 pull、本地会话无 lease 无结束钩子。

实测：`2026-08-23-agent-log-conversation-view`（本地 ZCode 会话 20:51-20:53 产出）未出现在平台变更中心，服务器镜像最后同步时间早于变更产生。

## 方案概要

双管修复（D-001@v1）：backend scan 注入加 strategy 门禁（repo-native 走本地模板：无平台参数、无 init）+ CLI 指针生命周期加 realpath 回环判定（四消费点：指针恢复/写入/平台模式门禁收敛/接管声明降级）。仅 repo-native 行为改变（D-002@v1），daemon 零改动（D-003@v1），repo-mirrored 的 scan/stage 差异保留（D-004@v1）。

## 成功标准

1. repo-native 工作区 scan prompt 不含平台参数与 init 步骤；本地 agent 会话跑 sillyspec 后，变更四件套/进度自动出现在平台变更中心（CLI 内置 sync 通道）。
2. CLI 对自指指针（junction 回环）免疫：不写入、不恢复、不禁用 sync、陈旧声明不阻断本地模式。
3. platform-managed / repo-mirrored 的 scan bundle 输出与现状逐字节一致（回归断言）。

## 不在范围内（Non-Goals）

- daemon 侧代码改动与第四回灌触发点（D-003@v1，后续变更）。
- stage 派发门禁调整（D-004@v1，repo-mirrored 的 scan/stage 差异保留）。
- repo-native 源项目 `.sillyspec` 缺失时 daemon 降级 repo-mirrored 的分歧治理（仅风险登记）。
- 已中毒项目批量清理工具（本次仅本仓库现场清理；其它项目靠 CLI realpath 免疫自动失效）。

## 影响范围

- 本仓库：`backend/app/modules/agent/context_builder.py` + `tests/test_context_builder.py`（2 文件）。
- 工具仓 sillyspec（/Users/qinyi/Desktop/sillyspec，独立提交+发版 3.27.3）：`src/run/shared.js`、`src/run/command.js`、`src/init.js`、`src/doctor-diagnostics.js`、test/、package.json（6 处）。
- 前端/daemon/schema：零改动。
