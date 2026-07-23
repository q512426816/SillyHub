---
author: qinyi
created_at: 2026-07-23 16:26:00
change: 2026-07-23-backend-permission-perf
scale: large
---

# 设计文档（Design）— 权限缓存熔断降级

## 1. 背景

rbac-permission-cache 变更为 `has_permission` 和 PPM `data_scope` 热路径添加了 Redis 缓存。每次缓存读写都通过 `redis.asyncio.get/set` 与 Redis 通信，当 Redis 不可用（测试环境无 Redis、生产 Redis 偶发抖动）时，`socket_connect_timeout=3` 和 `socket_timeout=3` 导致每次缓存操作等待 ~3s 才抛异常降级。

实测：一个简单的 `is_super_admin` 调用在无 Redis 环境下耗时 **6,030ms**（其中 SQL 仅 **1.3ms**），**99.98% 的时间在空等连接超时**。全量 2890 测试中，调用缓存层越多的测试（权限/数据范围/成员管理）耗时越明显，单个测试 6~76s。

当前缓存降级范式（try/except 静默吞错）只处理了"出错后不影响业务"，但未处理"出错前白等 3s×N"的问题。

## 2. 设计目标

- G1:Redis 不可用时，缓存读/写在**毫秒级**降级回 DB，不等待连接超时。
- G2:Redis 恢复后，缓存层自动恢复正常（不需要人工干预或重启）。
- G3:熔断逻辑只影响缓存层自身，不影响 Redis 客户端的其他用途（publish/订阅/广播等）。
- G4:测试环境无 Redis 时，permission_cache 快速跳过，不再拖慢测试。
- G5:熔断阈值可配，默认即安全。

## 3. 非目标

- N1:不引入 redis-py 之外的新依赖（熔断器用内置状态机实现，无 circuitbreaker/circuitpy 等第三方包）。
- N2:不改变 auth_deps 调用链（熔断是 permission_cache 内部实现细节，对 rbac.py/data_scope.py 无感）。
- N3:不改共享 redis 客户端(`app/core/redis.py`)——publish/健康检查等路径不受熔断影响。
- N4:不做分布式熔断（熔断状态是进程级内存变量，单实例足够；多实例各自为政，无状态同步需求）。
- N5:不修改 `invalidate_all_permissions`（失效路径不走熔断——时效性是安全事件，应每次都尝试 Redis）。
- N6:不处理"熔断+写后立即读"的缓存一致性（熔断断开时不写缓存，也不读缓存，一致性自然无问题）。

## 4. 总体方案

方案 A（已选）：进程内熔断状态机 + 配置驱动。

### 4.1 熔断器开关位置

熔断检查点插入 `get_cached_permissions`、`set_cached_permissions`、`get_cached_ppm_scope`、`set_cached_ppm_scope` 四个函数的 **入口**（try 块之前）：

```
def _/_operation_():
    if _is_open():        # ← 熔断检查，断开则直接返回 None（miss）
        return None
    try:
        ...redis 操作...
        _record_success() # 成功后可能关闭熔断器（半开后试探成功）
    except Exception:
        _record_failure() # 连续失败计数，达标则断开
        ...降级逻辑...
```

### 4.2 熔断状态机

```
                    +--------------------------+
                    |                          |
                    v                          |
          +-------+         +--------+         |
          | CLOSED | 失败≥N |  OPEN  | 超时≥M  | (半开试探 1 次)
          | (正常) |------->| (断开) |--------+
          +-------+         +--------+          |
                    ^          |                |
                    |  试探成功 |                |
                    |          v                |
                    |      +----------+         |
                    +------| HALF_OPEN |         |
                           | (半开试探)|         |
                           +----------+         |
                                |  试探失败       |
                                +---------------+
```

- **CLOSED（闭合，默认）**：正常读写 Redis。每次失败计数 +1；成功清空失败计数。
- **OPEN（断开）**：所有读返回 None（miss），写直接跳过。不碰 Redis。达到 cooldown_seconds 后转为 HALF_OPEN。
- **HALF_OPEN（半开，试探）**：允许 1 次试探操作。成功 → 恢复 CLOSED；失败 → 重回 OPEN，cooldown 重置。

### 4.3 配置项

| 配置字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `permission_cache_breaker_threshold` | int | 5 | 连续失败次数，达到后熔断(ge=0;0=禁用熔断器) |
| `permission_cache_breaker_cooldown` | int | 30 | 熔断保持 OPEN 的秒数(ge=0;0=不自动恢复,半开试探不会触发,需重启进程) |

加在 `config.py` 的 `auth_*` 配置段。

### 4.4 熔断状态是模块级变量

在 `permission_cache.py` 顶部：

```python
import time
_BreakerState = {
    "failure_count": 0,
    "state": "CLOSED",         # CLOSED | OPEN | HALF_OPEN
    "open_at": 0.0,           # time.monotonic() 进入 OPEN 的时刻
}
```

不使用类/单例，4 个读写函数共享同一个状态。**线程安全**：所有 permission_cache 调用已经在 FastAPI 的 async event loop 中，单线程无竞争（Redis 连接池本身也是线程安全的）。

### 4.5 不影响 invalidate_all_permissions

`invalidate_all_permissions` 不走熔断。原因：失效是安全事件，即使 Redis 正在抖动也应尽量执行（try/except 已有降级）。且失效只在权限变更时调用，频率极低，等 ~3s 可接受。

### 4.6 测试策略

- 在 `test_permission_cache.py` 新增熔断器测试：
  - 正常读写后失败计数为 0
  - 连续失败达到阈值后熔断打开，后续读直接返回 None
  - cooldown 后 HALF_OPEN 试探，成功则恢复
  - threshold=0 时熔断器禁用
- 熔断器测试不依赖外部 Redis（用 mock 或直接操作熔断状态变量验证状态机逻辑）

## 5. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/core/config.py` | 新增 `permission_cache_breaker_threshold` 和 `permission_cache_breaker_cooldown` 配置项 |
| 修改 | `backend/app/core/permission_cache.py` | 新增熔断器状态机，4 个读写函数入口插入熔断检查，加模块级熔断状态变量 |
| 修改 | `backend/tests/modules/test_permission_cache.py` | 新增熔断器单元测试 |

## 6. 接口定义

### 新增内部函数（permission_cache.py 内部使用，不导出）

```python
def _breaker_is_open() -> bool:
    """返回熔断器是否断开（OPEN）。CLOSED/半开试探成功=返回 False；OPEN=返回 True。
    内部状态转换也在此完成：OPEN → HALF_OPEN（超时后首次调用时触发）。"""

def _record_failure() -> None:
    """记录一次失败。达标后切换 OPEN。
    参数 threshold=0 → 不操作（禁用熔断）。"""

def _record_success() -> None:
    """记录一次成功。仅在 HALF_OPEN 时恢复 CLOSED；CLOSED 时清空失败计数。"""
```

### 配置项（config.py）

```python
permission_cache_breaker_threshold: int = Field(5, ge=0, le=100)
permission_cache_breaker_cooldown: int = Field(30, ge=0, le=3600)
```

### 现有接口无签名变化

`get_cached_permissions`/`set_cached_permissions`/`get_cached_ppm_scope`/`set_cached_ppm_scope`/`invalidate_all_permissions` 签名不变，熔断是其内部实现细节。

## 7. 数据模型

无变更。

## 8. 兼容策略

- 低于默认阈值（仅 1 次失败）不触熔断，行为与升级前完全一致。
- threshold=0 可显式禁用熔断器。
- 熔断只影响缓存层是否被调用，不影响业务逻辑输出。

## 9. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 熔断状态是进程级内存变量，多 worker 进程各自独立熔断 | P2 | 受控设计：单一进程已覆盖测试/单实例部署场景。多 worker 各自熔断不互相影响正确性（每个进程各自判断 Redis 可用性）|
| R-02 | 生产 Redis 真实抖动：熔断期间大量请求直接查 DB 造成 DB 压力 | P1 | 熔断 cooldown 默认 30s，DB 能扛短暂峰值；若持续抖动，threshold/cooldown 可调低/调高。熔断器退化为"兜底"，非正常流量路径 |
| R-03 | 半开后 Redis 刚恢复但第一个试探请求又因瞬时错误失败，重回 OPEN | P2 | HALF_OPEN 只容忍 1 次失败。生产如果有持续瞬时错误，熔断器自然保持 OPEN，不会反复开关。此阈值可调 |

## 10. 决策追踪

| ID | 内容 | 覆盖章节 | 状态 |
|---|---|---|---|
| D-001@v1 | 问题归属：慢根因是 permission_cache 等待 Redis 连接超时（非 N+1），用户决定并入本变更做通用熔断降级 | §1 背景、§4 总体方案 | accepted |
| D-002@v1 | 熔断仅作用于 permission_cache 内部的 4 个读写函数，不影响 invalidate_all_permissions | §4.5 | accepted |
| D-003@v1 | threshold=0 禁用熔断器（排障用途），也可在测试环境关闭熔断做精确缓存测试 | §4.3 | accepted |

## 11. 自审

- ✅ 背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记：全部齐全
- ✅ 不涉及 session/lease/daemon/lifecycle，无需生命周期契约表
- ✅ decision.md 引用完全覆盖当前版本 D-xxx@v1 三个决策
- ✅ scale 标注为 large（跨 config.py/permission_cache.py/测试文件，含状态机，≥3 文件）
- ⚠️ 自审存疑：decisions.md 尚未写入，需在建文件后同步
