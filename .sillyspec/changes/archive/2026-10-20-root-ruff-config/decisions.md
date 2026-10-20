---
author: flow-machine-draft
created_at: 2026-10-20T00:28:26.299Z
---
# 决策记录（Decisions）— 2026-10-20-root-ruff-config

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：格式化 `check-assertion-surfaces.py`（pre-commit assertion-surfaces 闸门脚本）与 `scan-drift-check.py`（local.yaml scan:check 命令）——若重排意外破坏行为会卡全仓提交。缓解：ruff format 是纯空白/换行重排（无 token 变换），交付前闸门实跑 + test_scan_drift_check 用例回归 + diff 逐行核对仅空白类变化。 试过但放弃的方案：① 只改钩子建议文案按路径分流——治标：钩子仍按 88 裁根级文件，与任何手动 backend-cwd format 依旧不一致，且文案分支逻辑要进 pre-commit config 维护；② 根 ruff.toml 配齐 backend 全套 lint select——放弃：会瞬间扩大根级存量 lint 面（UP/SIM/N 等规则对存量 scripts 文件的未知违规），本变更范围膨胀，与「修行宽拉锯」的目标无关；③ 升级 ruff 至支持项目级多配置合并的版本——放弃：工具链版本变更影响面远大于本缺口，且 0.15.14 双入口数值同源后已无矛盾。
