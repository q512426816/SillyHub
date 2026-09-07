---
author: qinyi
created_at: 2026-09-07 13:40:00
---

# 需求规格（Requirements）— 2026-09-07-conflict-diff-compare

## 功能需求

- FR-01 冲突行「查看对比」入口：变更中心平台同步卡的每条未决冲突行提供「查看对比」按钮；机器离线时禁用并提示需机器在线。行上不再出现「保本地/取平台」按钮（裁决入口收进弹窗，D-002@v1）。
- FR-02 对比弹窗（spec 树类）：antd Modal 展示——顶部双方最后更新时间条（较旧一侧橙色方向性提示）；左栏冲突文件清单（徽章：修改/仅本地/仅平台/相同；默认只看差异可切全部；本变更目录排序在前、archive 沉底；头部展示「涉及 N 个文件，其中归档 M 个」）；右栏左右分栏 diff（左本地右平台，删除行红、新增行绿，语义 token）；二进制/截断文件显示占位提示。
- FR-03 对比弹窗（进度类）：关键信息对比表（对比项/本地/平台三列，字段白名单：当前阶段/阶段标签/步骤进度/最近活跃/ql_id/ghost 标记），差异行橙色高亮；不展示原始 JSON（D-003@v1）。
- FR-04 弹窗内裁决：底部「保本地」（primary）/「取平台」（danger）按钮，复用现有 resolve 通道与 STRATEGY_TEXT 二次确认；下发成功关闭弹窗，结果回显走既有 sillyspec_command_result 链路。
- FR-05 quick 条目 ql 编号标题：冲突行标题对 quick 类显示「【ql-编号】快速修复」+ 灰色小字原始 ID；ql_id 由 daemon 读本地 guard.json 的 quicklogId 经心跳补报；缺失时兜底显示原始 ID。工作区总览卡只读冲突清单同步该标题规则。
- FR-06 权限一致性：compare 端点与裁决端点同权限（机器所有者/平台管理员，越权 404）；无权限用户行上不渲染「查看对比」，冲突清单保持只读可见（Grill B1 统一）。

## 非功能需求

- FR-07 体积护栏：daemon RPC 腿单文件 256KB / 路径 300 / 聚合 4MB（低于 WS 帧 16MB 默认上限）；REST 响应 2MB / 单文件 diff 5000 行；截断处均有显式标记（truncated/diff_truncated/response_truncated/local_truncated）。
- FR-08 路径安全：daemon 侧 realpath 落点必须在 spec 根内；backend 侧读 spec_root 逐路径 containment 校验（拒 `..`，落点在 spec_root 内），半可信端回报路径不直接拼读。
- FR-09 性能与体验：compare RPC 显式 15s 超时；弹窗打开即 loading、失败可重试；本地时间标注「取自文件修改时间，仅辅助参考」。
- FR-10 类型同步硬规则：后端 schema 变更后同变更内跑 `pnpm gen:types` 提交 api-types.ts + openapi.json（CLAUDE.md:36）。

## 验收标准

- 3 条存量冲突行均只显示「查看对比」，quick 行标题按 ql 规则兜底显示原 ID（存量 guard.json 已清，D-004 已知限制）。
- 打开 spec 树冲突弹窗可见文件清单与左右 diff 高亮；打开进度冲突弹窗可见关键信息对比表。
- 弹窗内点「保本地/取平台」经二次确认后下发成功并关闭弹窗。
- 无权限用户（非机器所有者非管理员）看不到「查看对比」按钮，直接调 compare 端点返回 404。
- backend/daemon/frontend 三端新增与适配测试全绿（仅跑本变更相关测试，全量留 CI）。
