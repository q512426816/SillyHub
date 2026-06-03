---
author: qinyi
created_at: 2026-06-02T16:21:37
id: task-08
title: 前端单测 — AgentRunStreamClient 重连/去重/状态
priority: P1
estimated_hours: 2
depends_on: [task-05]
blocks: []
allowed_paths:
  - frontend/src/lib/__tests__/agent-stream.test.ts
---

# task-08: 前端单测 — AgentRunStreamClient 重连/去重/状态

## 修改文件
- `frontend/src/lib/__tests__/agent-stream.test.ts` — 新建

## 实现要求
1. Mock `EventSource` 构造函数
2. Mock `getAgentRunLogs` 返回回填数据
3. Mock `useSession.getState` 返回 token
4. 测试以下场景：
   - 连接状态转换：disconnected → connecting → connected
   - 消息去重：相同 log_id 事件只发送一次
   - 断线重连：onerror 后触发回填 + 重建 ES
   - 最大重试：5 次失败后 status = error
   - disconnect 后不重连
   - done 事件触发回调并关闭连接
   - 回填日志和 SSE 推送重叠时去重

## 接口定义

测试框架：**Vitest**（本项目使用 vitest，非 Jest）

```typescript
import { describe, it, expect, vi, beforeEach, afterEach, vi } from "vitest";
```

测试结构：
```typescript
// Mock EventSource
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  listeners: Map<string, Function[]> = new Map();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: Function) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), cb]);
  }
  close() { /* mark closed */ }

  // Helpers for tests
  simulateMessage(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
  simulateDone() {
    const cbs = this.listeners.get("done") || [];
    cbs.forEach(cb => cb({ data: "{}" }));
  }
  simulateError() {
    this.onerror?.();
  }
}
```

## 测试用例清单

### AC-01: 连接状态转换
- `client.connect(token)` 后 status 依次为 `connecting` → `connected`
- 初始 status 为 `disconnected`
- `onStatusChange` 回调依次收到 disconnected → connecting → connected

### AC-02: 消息去重
- 发送两个相同 `log_id` 的 SSE 事件
- `onMessage` 回调只被调用 1 次
- `log_id` 为 null 的事件不参与去重，直接发送

### AC-03: 断线重连 — 回填 + 重建 ES
- 触发 `onerror`
- 验证调用 `getAgentRunLogs(workspaceId, runId, { after: lastLogId })` 回填
- 验证回填日志通过 `onMessage` 发送（去重后）
- 验证创建新的 EventSource 实例（带新 token）

### AC-04: 最大重试 5 次
- 连续触发 `onerror` 5 次
- 每次重连间隔指数退避（1s, 2s, 4s, 8s, 16s）
- 第 5 次失败后 status = `error`
- 不再尝试重连

### AC-05: disconnect 后不重连
- 调用 `client.disconnect()`
- 触发 `onerror` 不应触发重连逻辑
- status 为 `disconnected`

### AC-06: done 事件
- EventSource 收到 `done` 命名事件
- `onDone` 回调被调用
- EventSource 被关闭

### AC-07: 回填 + SSE 重叠去重
- 回填返回 log_id: [10, 20, 30]
- SSE 推送 log_id: [20, 30, 40]
- `onMessage` 收到 log_id 10, 20, 30, 40 各一次（去重后）

## Mock 策略

```typescript
// 1. Mock EventSource 全局构造函数
vi.stubGlobal("EventSource", MockEventSource);

// 2. Mock getAgentRunLogs
vi.mock("@/lib/agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent")>();
  return {
    ...actual,
    getAgentRunLogs: vi.fn().mockResolvedValue([]),
  };
});

// 3. Mock useSession.getState 返回 token
vi.mock("@/stores/session", () => ({
  useSession: {
    getState: vi.fn().mockReturnValue({ accessToken: "test-token" }),
  },
}));

// 4. Mock getApiBaseUrl
vi.mock("@/lib/api", () => ({
  getApiBaseUrl: vi.fn().mockReturnValue("http://localhost:8000"),
}));
```

## 边界处理
- Mock 必须清理（`beforeEach` 重置 `MockEventSource.instances`）
- 定时器用 `vi.useFakeTimers()` 控制指数退避
- 异步操作用 `await` / `vi.runAllTimersAsync()` 包裹
- `log_id` 为 null 的事件不参与去重，直接发送
- 不实际发起 HTTP 请求
- `afterEach` 调用 `vi.useRealTimers()` 恢复定时器

## Vitest 注意事项
- 使用 `vi.useFakeTimers()` 而非 `jest.useFakeTimers()`
- 使用 `vi.runAllTimersAsync()` 等待异步定时器完成
- 使用 `vi.fn()` 而非 `jest.fn()`
- 使用 `vi.mock()` 而非 `jest.mock()`
- 使用 `vi.stubGlobal()` 注入全局 Mock

## 非目标
- 不测试 `streamAgentRunLogs`（旧函数）
- 不测试 page.tsx 组件（集成测试范畴）
- 不测试后端

## 参考
- `AgentRunStreamClient` 在 `frontend/src/lib/agent-stream.ts`（task-05 新建）
- 现有测试样例：`frontend/src/lib/__tests__/agent.test.ts`、`frontend/src/lib/__tests__/api.test.ts`
- 前端测试框架：Vitest + @testing-library/react
- vitest 配置：`frontend/vitest.config.ts`

## TDD 步骤
1. 写 MockEventSource 和测试框架搭建
2. 写连接状态测试 → 确认失败（task-05 未实现前）
3. 等待 task-05 实现完成
4. 确认连接状态测试通过
5. 补充去重测试
6. 补充重连测试
7. 补充边界场景测试

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | connect → status 转换 | disconnected → connecting → connected |
| AC-02 | 重复 log_id 事件 | onMessage 只调用 1 次 |
| AC-03 | onerror 触发 | 调用 getAgentRunLogs 回填 + 重建 ES |
| AC-04 | 5 次重连失败 | status = error |
| AC-05 | disconnect() | 不触发重连 |
| AC-06 | done 事件 | onDone 回调触发，ES close |
| AC-07 | 回填 + SSE 重叠 | log_id 去重正确 |
