---
id: task-06
title: 心跳窗口/attempt 上限可配 + 守护测试
title_zh: lease_heartbeat/claim_lease/start_lease 三处 60s 硬编码改读 config（lease_heartbeat_ttl_sec/lease_claim_window_sec 默认 300s）+ handle_lease_expiry attempt 上限读 config（lease_max_attempts 默认 3）+ 守护测试
author: qinyi
created_at: 2026-07-14 11:20:00
priority: P1
depends_on: [task-02]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-006@v1]
expects_from:
  task-02:
    - contract: GCSettings
      needs: [lease_heartbeat_ttl_sec, lease_claim_window_sec, lease_max_attempts]
allowed_paths:
  - backend/app/modules/daemon/lease/service.py
  - backend/app/modules/daemon/lease/tests/
---

# task-06 — 心跳窗口/attempt 上限可配 + 守护测试

## goal
把 lease/service.py 中三处 `timedelta(seconds=60)` 硬编码（`lease_heartbeat`:266 续期、`claim_lease`:187 claim 窗口、**`start_lease`:224 第三处，Grill P1-1 指出原 design 漏的**）改为读 `get_settings()`；把 `handle_lease_expiry`:779 的 `attempt >= 3` 硬编码改为读 `settings.lease_max_attempts`（默认 3）。放宽默认心跳窗口到 300s（单次网络抖动不误杀），全部可配回 60s，零回归兜底（design §7.3 / §7.5 heartbeat 行 / Wave 2，D-006@v1）。

## provides
```yaml
contract: LeaseService configurable windows
behavior: lease_heartbeat 续期 = now + settings.lease_heartbeat_ttl_sec（默认 300）
          claim_lease batch 窗口 = now + settings.lease_claim_window_sec（默认 300）
          start_lease batch 窗口 = now + settings.lease_claim_window_sec（默认 300）
          handle_lease_expiry attempt 上限 = settings.lease_max_attempts（默认 3）
```

## implementation
1. **读 config 入口**：三处 + attempt 上限统一经 `from app.core.config import get_settings` 读 `settings = get_settings()`（service.py 顶部 import，或方法内局部 import 避免循环——本文件已 import 同包 config 无环，顶部 import 即可）。
2. **`lease_heartbeat`（:271）**：`lease.lease_expires_at = now + timedelta(seconds=60)` → `timedelta(seconds=settings.lease_heartbeat_ttl_sec)`。
3. **`claim_lease`（:187）**：`if lease.kind != "interactive":` 分支内 `now + timedelta(seconds=60)` → `timedelta(seconds=settings.lease_claim_window_sec)`（claim→start 窗口，与 heartbeat 同语义但独立配置项，design §7.3 区分 lease_heartbeat_ttl_sec / lease_claim_window_sec）。
4. **`start_lease`（:224，Grill P1-1 第三处，勿漏）**：`if lease.kind != "interactive":` 分支内 `now + timedelta(seconds=60)` → `timedelta(seconds=settings.lease_claim_window_sec)`。**这是原 design 漏列的第三处**，必须改否则 start 后 running 期间心跳窗口仍是 60s（单次抖动即过期重派）。
5. **`handle_lease_expiry`（:779）**：`if attempt >= 3:` → `if attempt >= settings.lease_max_attempts:`（默认 3，可放宽到 5 等）。
6. **interactive lease 保持豁免**：claim_lease/start_lease 的 `if lease.kind != "interactive":` 守卫不动（NULL 永不过期，design §7.5 / D-005），只改 batch 分支的秒数来源。
7. **守护测试**（lease/tests/，新增或扩现有 test）：覆盖 acceptance 全部分支。

## 验收标准
- **三处读 config**：`lease_heartbeat` 续期后 `lease_expires_at - now ≈ settings.lease_heartbeat_ttl_sec`（默认 300s，非 60）；`claim_lease`/`start_lease` batch 分支窗口 ≈ `lease_claim_window_sec`（默认 300s）。
- **attempt 上限读 config**：设 `lease_max_attempts=2`，handle_lease_expiry 在 attempt=2 时即标 failed（不再硬等 3）；默认值 3 时行为同现状。
- **单次抖动不误杀**：默认窗口 300s 下，模拟 daemon 心跳间隔 200s（>旧 60s 窗口）→ lease 不过期（守护测试钉死，对应 design §1 病灶 6 / R-7）。
- **interactive 豁免不变**：claim_lease/start_lease 对 kind=interactive 的 lease 仍写 `lease_expires_at=NULL`（不受窗口配置影响）。
- **可配回 60s**：设 `lease_heartbeat_ttl_sec=60` → 行为等价现状（brownfield 兼容，design §9）。
- **零回归**：现有 lease/tests/ 单测全绿（仅改秒数来源 + 上限来源，逻辑分支不变）。

## verify
- `cd backend && pytest app/modules/daemon/lease/tests/ -q`（含新增守护测试，零回归）
- `cd backend && ruff check app/modules/daemon/lease/service.py`
- `cd backend && mypy app/modules/daemon/lease/service.py`
- 手动核对：grep `seconds=60` 在 service.py 应为 0 命中（三处全改完，防漏 start_lease 第三处）；grep `>= 3` 在 handle_lease_expiry 应改为读 config。

## constraints
- **start_lease:224 第三处勿漏**（Grill P1-1）：原 design §6 只列 lease_heartbeat + claim_lease 两处，代码 review 检出 start_lease:224 第三处 `timedelta(seconds=60)`（batch lease running 期间续期窗口），漏改则放宽配置只对 claim 生效、running 期间仍 60s 抖动即过期。
- **默认 300s 防抖动，可配回 60s**（design §7.3 / §9 / R-7）：默认放宽到 300s 是为容忍网络抖动（单次 >60s 不再误杀），但 lease_heartbeat_ttl_sec/lease_claim_window_sec 都是 env 可配，严格环境设 60 即退回现状行为（零回归兜底）。
- **不改 interactive NULL 语义**：claim_lease/start_lease 的 `if lease.kind != "interactive":` 守卫保留，interactive lease 永远 `lease_expires_at=NULL` 不受任何窗口配置影响（D-005 生命周期红线）。
- **attempt 上限默认 3 等价现状**：lease_max_attempts 默认 3，不改默认行为，仅让上限可调（用户场景想多给 batch lease 几次机会时放宽）。
- **config 字段来源 task-02**：消费 task-02 在 config.py 加的 `lease_heartbeat_ttl_sec`/`lease_claim_window_sec`/`lease_max_attempts`（§7.3），本任务不改 config.py（属 task-02 allowed_paths），只读不改。
---
