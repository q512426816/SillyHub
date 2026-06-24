---
author: qinyi
created_at: 2026-06-24 13:25:00
---

# 模块影响分析:2026-06-24-concurrent-refresh-revoke

> 真实文件来源:commit `e802499b`(本次修复)。注:HEAD 已前进到 `289cad33`(别的会话的 daemon runtime-lock 变更,不属本次),故 git diff HEAD~1 指向 daemon 文件;本分析以本次修复 commit e802499b + design §6 声明为准。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| backend/auth | 逻辑变更 + 数据结构变更 | `app/modules/auth/service.py`、`app/modules/auth/model.py`、`tests/modules/auth/test_refresh_grace_window.py` | refresh 加 60s grace window(`_consume_refresh_token` 三元返回+grace 判定、新增 `_mark_session_rotated`/`_find_revoked_session`、refresh is_grace 分支、logout 三元解包);`Session` 加 `rotated_at` 字段 | false |
| backend/core | 配置变更 | `app/core/config.py`、`app/core/tests/test_config_auth.py` | 新增 `auth_refresh_grace_seconds=60`(ge=0 le=600)、`auth_access_ttl_minutes` 默认 15→30 | false |
| backend/migrations | 新增 | `migrations/versions/202606241000_add_session_rotated_at.py` | `sessions` 加 `rotated_at TIMESTAMP WITH TIME ZONE NULL`(down_revision=202607240900) | false |
| frontend/lib-api | 调用关系变更 + 逻辑变更 | `src/lib/api.ts` | 401 分支收口到 `ensureFreshAccessToken()` 单飞锁,删除内联 fetch refresh,保留 isAuthEndpoint 防递归 + x-auth-retry | false |
| frontend/lib-auth | 逻辑变更 | `src/lib/auth.ts` | `refreshTokens()` 复用同一单飞 inflight,签名不变 | false |
| frontend/lib-ppm | 逻辑变更 | `src/lib/ppm/export.ts` | 401 分支收口到 `ensureFreshAccessToken()` 单飞锁 | false |
| frontend/components-shared | 逻辑变更 | `src/components/app-shell.tsx` | 新增主动刷新 useEffect(每分钟校验 exp,剩余<1/3 TTL 调 ensureFreshAccessToken) | false |
| frontend/lib-token-refresh | **新增模块** | `src/lib/token-refresh.ts`、`src/lib/__tests__/token-refresh.test.ts` | 单飞锁 `ensureFreshAccessToken()` + `decodeJwtExp()` + 模块级 inflight | **true**(新模块,`_module-map.yaml` 未列,下次 scan 需补) |
| frontend/test-utils | 新增测试 | `src/lib/__tests__/token-refresh.test.ts` | 单飞(CALLS=1)/decodeJwtExp/api 401 走单飞/isAuthEndpoint 防递归 9 用例 | false |
| frontend/stores-session | 调用关系变更(间接) | (无直接改动) | 新增 lib-token-refresh 依赖 useSession.getState(refreshToken/hydrated/setTokens),store 本身未改 | false |

## 未匹配文件

| 文件 | 原因 | 建议 |
|------|------|------|
| `frontend/src/lib/token-refresh.ts` | `_module-map.yaml`(frontend)未列 `lib-token-refresh` 模块(本次新增) | 下次 `sillyspec run scan` 应自动识别并补入 `_module-map.yaml`,生成 `modules/lib-token-refresh.md` 模块卡片 |

## 三重交叉验证

- **声明范围**(design §6 文件变更清单):config.py / model.py / migration / service.py / token-refresh.ts / api.ts / ppm-export.ts / auth.ts / app-shell.tsx + 测试 — 与实现一致 ✅
- **任务范围**(tasks.md / plan.md):task-01~10 文件路径 — 与实现一致 ✅
- **真实变更**(commit e802499b 文件):12 个源码文件 + 16 变更文档 + 1 docs/sillyspec — 以此为准 ✅

三重一致,无遗漏。
