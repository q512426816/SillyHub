---
author: flow-machine-draft
created_at: 2026-10-28T00:28:38.914Z
---
# 决策记录（Decisions）— 2026-10-28-reparse-trigger-tests-realign

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：若 60629d2bb 实为回归（测试才是对的），本变更会把回归固化为契约——已用四点证据排除（docstring 决策落痕、-S 唯一引入、新契约测试全过含归档翻转端到端、生产实证 OOM 治理动机）；且归档区 delete 的行删除能力由 scoped 覆盖（test_archive_scoped_reparse.py 锁定翻转），旧「全量」口径无独有能力。放弃方案：改实现回旧口径——直接违背 D-004/D-007 的 OOM 治理目标（全量重扫是内存峰值主源），否决。
