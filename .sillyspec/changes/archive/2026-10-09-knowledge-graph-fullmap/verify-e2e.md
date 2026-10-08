---
author: qinyi
created_at: 2026-10-09 01:45:00
---
# 端到端验收记录 — 2026-10-09-knowledge-graph-fullmap（task-07）

> 本地栈：worktree 代码重建镜像（backend/frontend）+ worktree dist 隔离 daemon + npm link 最新 CLI。
> 截图：`e2e-screenshots/01~02`。

## 实测项

| # | 检查项 | 方法 | 结果 |
|---|---|---|---|
| 1 | dump 全链（browser→backend→daemon→CLI→真图） | curl --compressed 打 dump 端点 | **available=true，nodes 5855 / edges 10464 / stats.nodes 一致** |
| 2 | gzip 压缩（R-04） | 传输字节 vs 原始 JSON | **原始 2249KB → 传输 275KB（8.2×）**；既有端点无压缩头（单测反例钉） |
| 3 | WS 大帧（R-01） | daemon 回包经 WS 单帧 | **~2.2MB < uvicorn 16MB 上限（8× 余量）**，无断裂 |
| 4 | 全图星空渲染（D-002） | 浏览器截图（截图 01） | **星系式聚类分布+疏密对比（原型同款视觉）；「全图」胶囊激活；统计卡 5855/10464+四计数与后端一致；mode-chip「全图 5855 节点 · 静态」** |
| 5 | 点节点下钻（D-001） | 画布点击大簇节点（截图 02） | **切「查询切片」+ neighbors 查询发起（FR-auto-frontend-011 一跳切片力场）+ 胶囊/chip/右栏详情全联动** |
| 6 | 执行时序 | dump 端点耗时 | 3.5s（含 CLI 全图解析+布局+压缩） |
| 7 | 分层测试 | 仓内各端 | daemon 25 / backend 19 / frontend 169 / CLI 11 全绿；mypy/tsc/lint/typecheck 零错 |

## 接线缝隙修复（执行期发现）

daemon.ts 注册层漏透传 layout 旗标（task-02 allowed_paths 未含 daemon.ts——2026-10-08 时它在 task-01 名下）→ dump 恒 validation_rejected。已补一行接线（worktree 提交，review 声明有据越界），修复后全链通。

## 降级链说明

旧 CLI（无 dump）回退链（胶囊隐藏+回退 orphans）由 backend 单测（cli_feature_missing:dump→upgrade_required）+ 前端页面测试（mock upgrade_required 场景）双钉；浏览器级模拟依赖旧 CLI 环境未在此实测（无旧版 CLI 可装），按测试钉结论采信。

## 结论

七项全过；两项设计裁决（默认全图+星空效果）在真实环境兑现。
