// lib/__tests__/session-mention-sources.test.tsx
// task-04（2026-08-26-session-input-mention）：useMentionSources 联想数据 hooks 单测。
//
// 覆盖（对齐 task 卡 implementation + acceptance）：
//   1. workspaceId 非空：@ 两路查询挂载即拉取（listChanges 带 location=active +
//      pageSize=100；listQuicklogEntries 带 page_size=100），atEnabled=true。
//   2. placeholder 过滤：default 伪 change_key 与 placeholder=true 快速修复条目
//      不出现在返回列表（对齐会话列表关联筛选惯例）。
//   3. workspaceId 为空（""/null/undefined）：listChanges/listQuicklogEntries 零调用
//      （@ 联想禁用而非抛错），atEnabled=false，changes/quicklogs 兜底空数组；
//      技能源经 usePlatformSkillsManifest 委托，与 workspace 无关照常可用。
//   4. staleTime 5 分钟：changes/quicklogs 缓存键 staleTime=300000，且数据到位后
//      rerender 不重发请求（输入过程零网络请求）；技能源 staleTime 由
//      usePlatformSkillsManifest 内部设置（staleTime 已 5 分钟，委托既有 hook，
//      此处不重复断言其内部配置）。
//   5. 缓存键走 queryKeys.mentionSources 工厂（query cache 中可按工厂键找到查询）。
//
// 模式照搬 use-daemon-machines.test.ts（renderHook + waitFor +
// QueryClientProvider retry:false/gcTime:0）。mock 策略：
//   - listChanges/listQuicklogEntries：整模块覆写为 vi.fn（被测 hook 外部引用，
//     覆写即生效；use-daemon-machines 先例同款）；
//   - usePlatformSkillsManifest：mock 依赖 hook 本身——spread importOriginal
//     覆写 getPlatformSkillsManifest 无效（原 hook 闭包引用原函数，真实 fetch
//     会发网络请求），依赖 hook 的内部装配属 custom-skills 既有职责不在本卡范围。
// 不 mock 被测 hook 自身。
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import type { ReactNode } from "react";

vi.mock("@/lib/custom-skills", () => ({
  usePlatformSkillsManifest: vi.fn(),
}));
vi.mock("@/lib/changes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/changes")>()),
  listChanges: vi.fn(),
}));
vi.mock("@/lib/quicklog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/quicklog")>()),
  listQuicklogEntries: vi.fn(),
}));
import { usePlatformSkillsManifest } from "@/lib/custom-skills";
import { listChanges, type ChangeList } from "@/lib/changes";
import { listQuicklogEntries, type QuicklogEntryList } from "@/lib/quicklog";
import { useMentionSources } from "../session-mention-sources";
import { queryKeys } from "../query-keys";

const manifestHookMock = vi.mocked(usePlatformSkillsManifest);
const changesMock = vi.mocked(listChanges);
const quicklogMock = vi.mocked(listQuicklogEntries);

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, refetchInterval: false } },
  });
}
function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

/** 单条变更摘要（缺省字段 as 兜底，仅联想消费的 change_key/title 需真实）。 */
function change(change_key: string, title: string | null) {
  return {
    id: `id-${change_key}`,
    change_key,
    title,
    status: "active",
    location: "worktree",
    change_type: null,
    affected_components: [],
    owner_id: null,
    updated_at: "2026-08-26T00:00:00Z",
  } as unknown as ChangeList["items"][number];
}

/** 单条快速修复（placeholder 过滤断言用）。 */
function quicklog(ql_id: string, placeholder: boolean) {
  return {
    ql_id,
    title: `标题-${ql_id}`,
    status: "completed",
    placeholder,
    author_raw: "qinyi",
  } as unknown as QuicklogEntryList["items"][number];
}

/** manifest 委托 hook 的固定返回（仅消费 manifest 字段，对齐被测 hook 用法）。 */
const MANIFEST_RESULT = {
  manifest: {
    version: "v1",
    files: [],
    skills: [
      { name: "sillyspec-archive", description: "归档已验证完成的变更", file_count: 3 },
      { name: "sillyspec-status", description: "查看当前工作状态", file_count: 2 },
    ],
  },
  isLoading: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
};

function mockAllReady() {
  manifestHookMock.mockReturnValue(MANIFEST_RESULT);
  changesMock.mockResolvedValue({
    items: [
      change("2026-08-26-session-input-mention", "会话输入联想"),
      change("default", null), // CLI 伪 change_key，应被过滤
    ],
    total: 2,
  } as unknown as ChangeList);
  quicklogMock.mockResolvedValue({
    items: [
      quicklog("ql-20260826-013", false),
      quicklog("ql-20260826-014", true), // placeholder 占位条目，应被过滤
    ],
    total: 2,
  } as unknown as QuicklogEntryList);
}

beforeEach(() => {
  manifestHookMock.mockReset();
  changesMock.mockReset();
  quicklogMock.mockReset();
});

describe("useMentionSources 数据聚合", () => {
  it("workspaceId 非空：三路拉取 + placeholder 过滤 + atEnabled=true", async () => {
    mockAllReady();
    const { result } = renderHook(() => useMentionSources("ws-1"), {
      wrapper: wrapper(makeClient()),
    });

    await waitFor(() =>
      expect(
        result.current.skills.length +
          result.current.changes.length +
          result.current.quicklogs.length,
      ).toBe(4),
    );

    // 技能源：委托 usePlatformSkillsManifest，manifest skills 透传
    //（仅 name/description/file_count，不涉 invoke_name）
    expect(manifestHookMock).toHaveBeenCalled();
    expect(result.current.skills.map((s) => s.name)).toEqual([
      "sillyspec-archive",
      "sillyspec-status",
    ]);
    // 变更源：default 伪 change_key 被过滤，真实条目保留
    expect(result.current.changes.map((c) => c.change_key)).toEqual([
      "2026-08-26-session-input-mention",
    ]);
    // 快速修复源：placeholder 条目被过滤
    expect(result.current.quicklogs.map((q) => q.ql_id)).toEqual([
      "ql-20260826-013",
    ]);
    expect(result.current.atEnabled).toBe(true);
    // 变更源带 location=active（活跃未归档，对齐关联筛选惯例）
    expect(changesMock).toHaveBeenCalledWith("ws-1", {
      location: "active",
      pageSize: 100,
    });
    expect(quicklogMock).toHaveBeenCalledWith("ws-1", { page_size: 100 });
  });

  it("数据未到位时兜底空数组（不抛错）", () => {
    manifestHookMock.mockReturnValue({
      manifest: null,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    changesMock.mockReturnValue(new Promise(() => {})); // 永不 resolve
    quicklogMock.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useMentionSources("ws-1"), {
      wrapper: wrapper(makeClient()),
    });
    expect(result.current.skills).toEqual([]);
    expect(result.current.changes).toEqual([]);
    expect(result.current.quicklogs).toEqual([]);
  });
});

describe("useMentionSources workspaceId 为空（@ 联想禁用）", () => {
  it.each(["", null, undefined])("workspaceId=%p：@ 数据源零请求且 atEnabled=false", (wid) => {
    mockAllReady();
    const { result } = renderHook(() => useMentionSources(wid), {
      wrapper: wrapper(makeClient()),
    });

    // 技能源经委托照常供数（/ 联想与 workspace 无关），证明 hook 正常运转非假绿
    expect(result.current.skills.length).toBe(2);
    expect(changesMock).not.toHaveBeenCalled();
    expect(quicklogMock).not.toHaveBeenCalled();
    expect(result.current.atEnabled).toBe(false);
    expect(result.current.changes).toEqual([]);
    expect(result.current.quicklogs).toEqual([]);
  });
});

describe("useMentionSources 缓存与 staleTime", () => {
  it("changes/quicklogs 走 queryKeys.mentionSources 工厂键，staleTime 5 分钟", async () => {
    mockAllReady();
    const client = makeClient();
    const { result, rerender } = renderHook(() => useMentionSources("ws-1"), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.changes.length).toBe(1));

    const changesQuery = client
      .getQueryCache()
      .find({ queryKey: queryKeys.mentionSources.changes("ws-1") });
    const quicklogsQuery = client
      .getQueryCache()
      .find({ queryKey: queryKeys.mentionSources.quicklogs("ws-1") });
    expect(changesQuery).toBeDefined();
    expect(quicklogsQuery).toBeDefined();
    // @ 两路查询 staleTime 均为 5 分钟（manifest 一路由既有 hook 内部设置）。
    // Query.options 公共类型不含 staleTime（归 QueryObserver 侧），运行时在
    // options 上透传，断言取值需窄化 cast。
    const changesOpts = changesQuery?.options as unknown as { staleTime?: number };
    const quicklogsOpts = quicklogsQuery?.options as unknown as { staleTime?: number };
    expect(changesOpts.staleTime).toBe(5 * 60_000);
    expect(quicklogsOpts.staleTime).toBe(5 * 60_000);

    // staleTime 窗口内 rerender 不重发请求（输入过程零网络请求）
    rerender();
    rerender();
    expect(changesMock).toHaveBeenCalledTimes(1);
    expect(quicklogMock).toHaveBeenCalledTimes(1);
  });
});
