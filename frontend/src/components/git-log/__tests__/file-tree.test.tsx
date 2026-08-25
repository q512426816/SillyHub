/**
 * task-06：变更文件目录树测试。
 *
 * 覆盖（acceptance「文件树聚合断言」）：
 * 1. buildFileTree 平铺路径按 / 聚合成树：层级正确、目录在前文件在后排序；
 * 2. 目录节点 +x/-y 累加正确（子树求和）；binary 叶子标记保留；
 * 3. 叶子首次点击才发起 diff 请求（点击前零请求）——useGitLogDiff mock 断言；
 * 4. binary 叶子点击不发请求，直接提示「二进制文件」；
 * 5. parseUnifiedDiff：文件头跳过、@@ 行号计数、add/del/ctx 分类。
 *
 * 依据：tasks/task-06.md acceptance、design.md §5.4 / R-06。
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GitLogFileTree,
  buildFileTree,
  parseUnifiedDiff,
} from "@/components/git-log/file-tree";
import type { GitLogFileStatItem } from "@/lib/git-log";

// ── mock @/lib/git-log：只接管 useGitLogDiff（按需请求断言），其余实引 ────

const gitLogMock = vi.hoisted(() => ({
  useGitLogDiff: vi.fn(),
}));
vi.mock("@/lib/git-log", async () => {
  const actual = await vi.importActual<typeof import("@/lib/git-log")>(
    "@/lib/git-log",
  );
  return {
    ...actual,
    useGitLogDiff: gitLogMock.useGitLogDiff,
  };
});

const FILES: GitLogFileStatItem[] = [
  { path: "src/lib/a.ts", add: 10, del: 2, binary: false },
  { path: "src/b.ts", add: 1, del: 0, binary: false },
  { path: "README.md", add: 5, del: 5, binary: false },
  { path: "img/logo.png", add: 0, del: 0, binary: true },
];

const DIFF_TEXT = [
  "diff --git a/src/lib/a.ts b/src/lib/a.ts",
  "index 111..222 100644",
  "--- a/src/lib/a.ts",
  "+++ b/src/lib/a.ts",
  "@@ -1,3 +1,4 @@",
  " line1",
  "-old2",
  "+new2",
  "+new3",
  " line4",
].join("\n");

function diffQueryResult(overrides: Record<string, unknown> = {}) {
  return {
    data: { diff: DIFF_TEXT, truncated: false, binary: false },
    isPending: false,
    isError: false,
    error: null,
    ...overrides,
  };
}

beforeEach(() => {
  gitLogMock.useGitLogDiff.mockReset();
  gitLogMock.useGitLogDiff.mockReturnValue(diffQueryResult());
});

afterEach(() => {
  cleanup();
});

// ── 聚合纯函数 ─────────────────────────────────────────────────────────

describe("buildFileTree 路径聚合", () => {
  it("平铺路径按 / 聚合成层级树，目录在前、文件在后", () => {
    const tree = buildFileTree(FILES);
    // 根层：img / src（目录在前）→ README.md
    expect(tree.map((n) => n.name)).toEqual(["img", "src", "README.md"]);
    const src = tree.find((n) => n.path === "src")!;
    expect(src.children.map((n) => n.name)).toEqual(["lib", "b.ts"]);
    expect(src.children[0]!.children.map((n) => n.name)).toEqual(["a.ts"]);
  });

  it("目录节点 +x/-y 为子树求和（聚合值）", () => {
    const tree = buildFileTree(FILES);
    const src = tree.find((n) => n.path === "src")!;
    expect(src.add).toBe(11); // 10 + 1
    expect(src.del).toBe(2); // 2 + 0
    const lib = src.children.find((n) => n.path === "src/lib")!;
    expect(lib.add).toBe(10);
    expect(lib.del).toBe(2);
    const img = tree.find((n) => n.path === "img")!;
    expect(img.add).toBe(0);
    expect(img.del).toBe(0);
  });

  it("叶子保留单文件统计与原始项；binary 叶子标记保留", () => {
    const tree = buildFileTree(FILES);
    const a = tree
      .find((n) => n.path === "src")!
      .children.find((n) => n.path === "src/lib")!
      .children.find((n) => n.path === "src/lib/a.ts")!;
    expect(a.add).toBe(10);
    expect(a.del).toBe(2);
    expect(a.binary).toBe(false);
    expect(a.file?.path).toBe("src/lib/a.ts");

    const png = tree
      .find((n) => n.path === "img")!
      .children.find((n) => n.path === "img/logo.png")!;
    expect(png.binary).toBe(true);
    expect(png.children).toHaveLength(0);
  });

  it("输入乱序不影响输出（路径索引 + 出口统一排序）", () => {
    const tree = buildFileTree([...FILES].reverse());
    expect(tree.map((n) => n.name)).toEqual(["img", "src", "README.md"]);
    expect(tree.find((n) => n.path === "src")!.add).toBe(11);
  });
});

// ── unified diff 解析 ─────────────────────────────────────────────────

describe("parseUnifiedDiff", () => {
  it("跳过文件头、@@ 头重置行号、add/del/ctx 分类推进行号", () => {
    const lines = parseUnifiedDiff(DIFF_TEXT);
    // 文件头 4 行全部跳过
    expect(lines[0]!.kind).toBe("hunk");
    expect(lines).toHaveLength(6);
    expect(lines[1]).toEqual({ kind: "ctx", oldNo: 1, newNo: 1, text: "line1" });
    expect(lines[2]).toEqual({ kind: "del", oldNo: 2, newNo: null, text: "old2" });
    expect(lines[3]).toEqual({ kind: "add", oldNo: null, newNo: 2, text: "new2" });
    expect(lines[4]).toEqual({ kind: "add", oldNo: null, newNo: 3, text: "new3" });
    expect(lines[5]).toEqual({ kind: "ctx", oldNo: 3, newNo: 4, text: "line4" });
  });

  it("多 hunk 时第二个 @@ 头重置行号", () => {
    const lines = parseUnifiedDiff(
      "@@ -1,1 +1,1 @@\n ctx\n@@ -10,1 +20,1 @@\n+add",
    );
    expect(lines[2]).toEqual({ kind: "hunk", oldNo: null, newNo: null, text: "@@ -10,1 +20,1 @@" });
    expect(lines[3]).toEqual({ kind: "add", oldNo: null, newNo: 20, text: "add" });
  });
});

// ── 组件渲染与按需请求 ─────────────────────────────────────────────────

describe("GitLogFileTree 组件", () => {
  it("默认全展开：目录/叶子可见，聚合 +x/-y 显示", () => {
    render(
      <GitLogFileTree workspaceId="ws-1" sha="sha-full" files={FILES} />,
    );

    expect(screen.getByTestId("git-log-dir-src")).toHaveTextContent("+11");
    expect(screen.getByTestId("git-log-dir-src")).toHaveTextContent("-2");
    expect(screen.getByTestId("git-log-dir-src/lib")).toHaveTextContent("+10");
    expect(screen.getByTestId("git-log-file-src/lib/a.ts")).toBeInTheDocument();
    expect(screen.getByTestId("git-log-file-img/logo.png")).toHaveTextContent("二进制");
  });

  it("叶子首次点击才发起 diff 请求（点击前零请求）", async () => {
    render(
      <GitLogFileTree workspaceId="ws-1" sha="sha-full" files={FILES} />,
    );

    // 点击前零请求（FileDiff 未挂载）
    expect(gitLogMock.useGitLogDiff).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("git-log-file-src/lib/a.ts"));

    // 首次点击：按 (workspaceId, sha, path, enabled=true) 发起
    await waitFor(() => {
      expect(gitLogMock.useGitLogDiff).toHaveBeenCalledWith(
        "ws-1",
        "sha-full",
        "src/lib/a.ts",
        true,
      );
    });
    // diff 内容按行渲染（+ 行绿底语义类）
    await waitFor(() => {
      expect(screen.getByTestId("git-log-diff")).toBeInTheDocument();
    });
    expect(screen.getByText("new2")).toBeInTheDocument();
    expect(
      screen.getByText("new2").closest("[data-diff-kind]"),
    ).toHaveAttribute("data-diff-kind", "add");
    expect(screen.getByText("old2").closest("[data-diff-kind]")).toHaveAttribute(
      "data-diff-kind",
      "del",
    );

    // 再点一次折叠：diff 区块卸载
    fireEvent.click(screen.getByTestId("git-log-file-src/lib/a.ts"));
    await waitFor(() => {
      expect(screen.queryByTestId("git-log-diff")).not.toBeInTheDocument();
    });
  });

  it("binary 叶子点击不发请求，直接提示二进制", () => {
    render(
      <GitLogFileTree workspaceId="ws-1" sha="sha-full" files={FILES} />,
    );

    fireEvent.click(screen.getByTestId("git-log-file-img/logo.png"));

    expect(screen.getByText("二进制文件，不支持文本 diff")).toBeInTheDocument();
    const requestedPaths = gitLogMock.useGitLogDiff.mock.calls.map(
      (c) => c[2] as string,
    );
    expect(requestedPaths).not.toContain("img/logo.png");
    expect(gitLogMock.useGitLogDiff).not.toHaveBeenCalled();
  });

  it("truncated=true 时渲染截断提示条", () => {
    gitLogMock.useGitLogDiff.mockReturnValue(
      diffQueryResult({ data: { diff: DIFF_TEXT, truncated: true, binary: false } }),
    );
    render(
      <GitLogFileTree workspaceId="ws-1" sha="sha-full" files={FILES} />,
    );

    fireEvent.click(screen.getByTestId("git-log-file-src/b.ts"));

    expect(screen.getByText("diff 超过 64KB 上限，已截断显示")).toBeInTheDocument();
  });

  it("目录节点点击折叠/展开子层", () => {
    render(
      <GitLogFileTree workspaceId="ws-1" sha="sha-full" files={FILES} />,
    );

    fireEvent.click(screen.getByTestId("git-log-dir-src"));
    expect(
      screen.queryByTestId("git-log-file-src/b.ts"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("git-log-dir-src"));
    expect(screen.getByTestId("git-log-file-src/b.ts")).toBeInTheDocument();
  });
});
