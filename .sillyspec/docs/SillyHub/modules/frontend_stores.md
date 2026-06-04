---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# frontend_stores
> 最后更新：2026-06-01
> 最近变更：scan（初始生成）
> 模块路径：frontend/src/stores/**

## 职责

Frontend Stores 模块管理前端全局客户端状态。当前仅包含 session store，负责认证状态（用户信息、token）的持久化和跨组件共享。

## 当前设计

### 文件清单

| 文件 | 导出 | 说明 |
|------|------|------|
| `session.ts` | `useSession`, `SessionUser`, `SessionTokens` | 客户端会话状态管理 |

### Session Store 详情

使用 Zustand + persist 中间件实现，将状态持久化到 `localStorage`（key: `multi-agent-platform.session`）。

**State 结构：**

```typescript
interface SessionState extends SessionTokens {
  hydrated: boolean;           // persist rehydration 是否完成
  user: SessionUser | null;    // 当前用户信息

  setUser(user): void;         // 设置用户信息
  setTokens(tokens): void;     // 设置 access/refresh token
  clear(): void;               // 清空全部状态（登出）
  markHydrated(): void;        // 标记 rehydration 完成
}

interface SessionUser {
  id: string;
  email: string;
  displayName: string;
}

interface SessionTokens {
  accessToken: string | null;
  refreshToken: string | null;
}
```

**持久化策略：**
- 使用 `zustand/middleware` 的 `persist` 中间件
- storage key: `multi-agent-platform.session`
- version: 1
- `partialize`: 持久化 `hydrated`, `user`, `accessToken`, `refreshToken`
- `onRehydrateStorage`: rehydrate 完成后自动调用 `markHydrated()`

## 对外接口

| 导出 | 类型 | 说明 |
|------|------|------|
| `useSession` | Zustand hook | 获取/修改 session 状态 |
| `SessionUser` | interface | 用户信息类型 |
| `SessionTokens` | interface | Token 对类型 |

## 关键数据流

```
页面加载
  → Zustand persist 从 localStorage 恢复状态
  → onRehydrateStorage → state.markHydrated()
  → hydrated = true

登录成功
  → auth.login() → 获取 token
  → useSession.setTokens({ accessToken, refreshToken })
  → useSession.setUser({ id, email, displayName })

登出
  → auth.logout() → 后端 invalidate
  → useSession.clear() → 清空 user + tokens

Dashboard 布局守卫
  → 检查 useSession.hydrated && useSession.accessToken
  → 未认证 → redirect /login
```

## 设计决策

| 决策 | 原因 |
|------|------|
| Zustand + persist | 轻量级状态管理，支持 localStorage 持久化 |
| `hydrated` 标志 | persist rehydration 是异步的，需要标志位避免闪烁 |
| `clear()` 清空所有字段 | 登出时确保不残留敏感数据 |
| persist key 带 namespace | 避免与其他应用的 localStorage 冲突 |
| actions 内嵌 state | Zustand 标准 pattern，无需额外 reducer |

## 依赖关系

- **内部依赖**：无（独立状态层）
- **外部依赖**：`zustand`, `zustand/middleware`
- **被依赖模块**：`@/lib/api.ts`（读取 accessToken）, `@/lib/auth.ts`（调用 setTokens/setUser/clear）, `frontend/src/app/(dashboard)/layout.tsx`（认证守卫）, 部分业务组件

## 注意事项

- `accessToken` 存储在 localStorage 中，存在 XSS 风险。生产环境应考虑 HttpOnly Cookie 方案
- `hydrated` 也被持久化，但实际 rehydration 完成由 `onRehydrateStorage` 回调控制
- 目前只有一个 store，随着功能增长可能需要添加更多 store（如 workspace 上下文 store）

## 变更索引

| 日期 | 变更 | 摘要 |
|------|------|------|
