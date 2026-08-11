---
author: WhaleFall
created_at: 2026-08-07 14:11:27
---

# 提案书（Proposal）

## 动机
interactive 会话 `/model` 等 inject 偶发空白轮次（重新进入才显示），用户体验受损。ql-20260807-003 诊断根因：inject 在 daemon session create 完成前到，被 daemon 静默丢弃。

## 关键问题（现有方案为何不够）
1. daemon `_routeSessionControl`（daemon.ts:2609）session 不存在直接 `return` 丢 inject（不重试不反馈），inject 静默丢失，用户看到空白轮次
2. backend `inject_session`（session/service.py:592）只查 DB `status=='active'`（不查 daemon ready），无法拦 create 中的 inject
3. backend `create_session` commit DB active 后 wake daemon（`notify_interactive_dispatch` fire 不等 create），inject 可能在 daemon `_startInteractiveSession`（spawn claude 秒级）完成前到

## 变更范围
- daemon create 完成（fresh `_startInteractiveSession` + recover `restoreAndReconnect`）上报 backend session ready（HTTP POST）
- backend 内存 ready set + per-session `asyncio.Event`（模块级单例）
- backend `inject_session` 等 ready event（超时 30s fallback 仍发 SESSION_INJECT，兼容旧 daemon）

## 不在范围内（显式清单）
- DB `daemon_ready` migration（内存够，单 backend；daemon 重启 recover 重建）
- `create_session` 改 RPC await daemon create（方案 C，大改 lease 领取机制，超范围）
- 前端改动（backend inject 等，前端无感；超时错误走前端现有错误处理）
- daemon SESSION_INJECT 重试（方案 B daemon 侧兜底，hacky）
- create_session 首 prompt（走 execPayload，不经 inject_session，不受影响）
