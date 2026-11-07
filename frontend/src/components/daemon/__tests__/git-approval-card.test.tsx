/**
 * GitApprovalCard 组件测试（2026-11-06-session-git-approval task-13）。
 *
 * 覆盖（= 卡 acceptance）：
 *   1. commit 态三分流渲染（已暂存/未暂存/未跟踪目录树 + 四色徽标 + 增删统计 + 预填勾选）；
 *   2. 勾选交互（文件勾/目录级勾选/计数联动）与 msg 编辑；
 *   3. 提交流：respondSessionPermission('allow', dialog_result{approve, message, selectedFiles})
 *      成功后 onResolved 触发（父级移卡——R-11 清卡路径的组件面）；失败可重试；
 *   4. 拒绝流：快捷原因 chips + 确认拒绝（deny + reject dialog_result）；
 *   5. push 态：remoteTarget/保护分支警示/ahead 按条明细展开文件明细（D-014/D-015）；
 *   6. 畸形 payload 兜底不崩；minimized 渲染 null。
 *
 * 手法对齐 ask-user-dialog-card.test.tsx（vi.mock session store + testing-library）；
 * respondSessionPermission / apiFetch 全 mock（零网络）。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { GitApprovalCard } from "@/components/daemon/git-approval-card";
import type { SessionPermissionRequest } from "@/lib/daemon";

vi.mock("@/stores/session", () => ({
  useSession: { getState: () => ({ accessToken: "test-token" }) },
}));

// 两工厂内定义实例（vi.mock 提升后引用顶层变量会 ReferenceError），再 import 取引用。
vi.mock("@/lib/daemon/sessions", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/daemon/sessions")>();
  return { ...orig, respondSessionPermission: vi.fn(async () => {}) };
});
import { respondSessionPermission } from "@/lib/daemon/sessions";
const respondMock = vi.mocked(respondSessionPermission);

vi.mock("@/lib/api", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...orig,
    apiFetch: vi.fn(async () => ({
      git_mode: "git",
      diff: "@@ -1 +1 @@\n-a\n+b",
      truncated: false,
      binary: false,
    })),
  };
});
import { apiFetch } from "@/lib/api";
const apiFetchMock = vi.mocked(apiFetch);

function makeRequest(payload: Record<string, unknown>): SessionPermissionRequest {
  return {
    session_id: "sess-1",
    run_id: "run-1",
    request_id: "req-1",
    tool_name: "Bash",
    input: { command: "git commit -m x" },
    dialog_kind: "git_approval",
    dialog_payload: payload,
  };
}

const COMMIT_PAYLOAD = {
  operation: "commit",
  command: 'git commit -m "feat: x"',
  worktree: "C:/repo",
  branch: "main",
  message: "feat: x",
  files: [
    { path: "backend/app/service.py", status: "modified", staged: true, addLines: 38, delLines: 4 },
    { path: "backend/app/other.py", status: "modified", staged: true, addLines: 2, delLines: 0 },
    { path: "frontend/src/app.tsx", status: "modified", staged: false, addLines: 10, delLines: 2 },
    { path: "docs/notes.md", status: "untracked", staged: false, addLines: 5, delLines: 0 },
  ],
  defaultSelected: ["backend/app/service.py", "backend/app/other.py"],
};

const PUSH_PAYLOAD = {
  operation: "push",
  command: "sillyspec push",
  worktree: "C:/repo",
  branch: "main",
  message: "",
  remoteTarget: "origin/main",
  runner: "sillyspec",
  protectedBranch: true,
  aheadCount: 2,
  aheadCommits: [
    {
      sha: "fff0001",
      subject: "feat: first",
      author: "qinyi",
      date: "2026-11-06",
      files: [
        { path: "backend/a.py", status: "modified", addLines: 20, delLines: 1 },
        { path: "new/b.tsx", status: "added", addLines: 8, delLines: 0 },
      ],
    },
    { sha: "fff0002", subject: "feat: second", author: "qinyi", date: "2026-11-06", files: [] },
  ],
  files: [],
  defaultSelected: [],
};

beforeEach(() => {
  respondMock.mockReset();
  respondMock.mockResolvedValue(undefined);
  apiFetchMock.mockClear();
});

describe("GitApprovalCard · commit 态", () => {
  it("三分组目录树渲染（已暂存/未暂存/未跟踪）+ 四色徽标 + 增删统计 + 预填勾选计数", () => {
    render(<GitApprovalCard request={makeRequest(COMMIT_PAYLOAD)} />);
    expect(screen.getByText("已暂存")).toBeInTheDocument();
    expect(screen.getByText("(2)")).toBeInTheDocument();
    expect(screen.getByText("未暂存改动")).toBeInTheDocument();
    // 「未跟踪」兼作分组标题与文件状态徽标（getAllBy 断言存在）。
    expect(screen.getAllByText("未跟踪").length).toBeGreaterThan(0);
    // 文件行 basename + 增删统计（目录树形态：父路径由层级表达）。
    expect(screen.getByText("service.py")).toBeInTheDocument();
    // 增删统计在文件行与目录聚合行重复出现（getAllBy 断言存在）。
    expect(screen.getAllByText("+38").length).toBeGreaterThan(0);
    expect(screen.getAllByText("-4").length).toBeGreaterThan(1);
    // 预填勾选 2 个（defaultSelected）。
    expect(screen.getByText("提交文件范围（勾选 2 个）")).toBeInTheDocument();
    expect(screen.getByTestId("git-approval-approve")).toHaveTextContent("提交 2 个文件");
  });

  it("文件勾选切换与按钮计数联动；目录级勾选批量增减", () => {
    render(<GitApprovalCard request={makeRequest(COMMIT_PAYLOAD)} />);
    // 取消一个文件勾选 → 计数 1。
    const fileLabel = screen.getByTestId("git-approval-file-backend/app/service.py");
    const cb = fileLabel.querySelector("input[type=checkbox]") as HTMLInputElement;
    fireEvent.click(cb);
    expect(screen.getByText("提交文件范围（勾选 1 个）")).toBeInTheDocument();
    // 目录级勾选（backend/ 目录行）勾上子树全部（service+other）→ 计数 2。
    const dirToggle = screen.getAllByTitle(/目录级勾选/)[0] as HTMLInputElement;
    fireEvent.click(dirToggle);
    expect(screen.getByText("提交文件范围（勾选 2 个）")).toBeInTheDocument();
  });

  it("msg 编辑生效并随提交流提交（respondSessionPermission allow + dialog_result）", async () => {
    const onResolved = vi.fn();
    render(<GitApprovalCard request={makeRequest(COMMIT_PAYLOAD)} onResolved={onResolved} />);
    const msg = screen.getByTestId("git-approval-msg-input") as HTMLTextAreaElement;
    fireEvent.change(msg, { target: { value: "用户改写 msg" } });
    fireEvent.click(screen.getByTestId("git-approval-approve"));
    await waitFor(() => expect(respondMock).toHaveBeenCalledTimes(1));
    expect(respondMock).toHaveBeenCalledWith(
      "sess-1",
      "req-1",
      "allow",
      undefined,
      { action: "approve", message: "用户改写 msg", selectedFiles: ["backend/app/service.py", "backend/app/other.py"] },
    );
    // 成功后 onResolved 触发（父级移卡——R-11 清卡路径组件面）。
    expect(onResolved).toHaveBeenCalledWith("req-1", "allow");
  });

  it("提交失败 → 错误提示且可重试", async () => {
    respondMock.mockRejectedValueOnce(new Error("network down"));
    render(<GitApprovalCard request={makeRequest(COMMIT_PAYLOAD)} />);
    fireEvent.click(screen.getByTestId("git-approval-approve"));
    await waitFor(() => expect(screen.getByTestId("git-approval-error")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("git-approval-approve"));
    await waitFor(() => expect(respondMock).toHaveBeenCalledTimes(2));
  });

  it("单文件 diff 入口：点击调会话级端点并在弹窗渲染 DiffBody", async () => {
    render(<GitApprovalCard request={makeRequest(COMMIT_PAYLOAD)} />);
    fireEvent.click(screen.getAllByRole("button", { name: "查看改动" })[0]!);
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/daemon/sessions/sess-1/git-diff",
      // 树按字母序，首个 diff 入口是 other.py（断言调用形态而非顺序假设）。
      expect.objectContaining({ query: { path: expect.stringMatching(/^backend\/app\/(service|other)\.py$/) } }),
    );
  });
});

describe("GitApprovalCard · 拒绝流（D-007）", () => {
  it("快捷原因 chips + 确认拒绝（deny + reject dialog_result + reason）", async () => {
    const onResolved = vi.fn();
    render(<GitApprovalCard request={makeRequest(COMMIT_PAYLOAD)} onResolved={onResolved} />);
    fireEvent.click(screen.getByTestId("git-approval-reject"));
    fireEvent.click(screen.getByTestId("git-approval-reject-chip-先不提交"));
    fireEvent.click(screen.getByTestId("git-approval-reject-confirm"));
    await waitFor(() => expect(respondMock).toHaveBeenCalledTimes(1));
    expect(respondMock).toHaveBeenCalledWith(
      "sess-1",
      "req-1",
      "deny",
      undefined,
      { action: "reject", reason: "先不提交" },
    );
    expect(onResolved).toHaveBeenCalledWith("req-1", "deny");
  });

  it("返回确认卡可退出拒绝子态", () => {
    render(<GitApprovalCard request={makeRequest(COMMIT_PAYLOAD)} />);
    fireEvent.click(screen.getByTestId("git-approval-reject"));
    expect(screen.getByTestId("git-approval-reject-confirm")).toBeInTheDocument();
    fireEvent.click(screen.getByText("返回确认卡"));
    expect(screen.queryByTestId("git-approval-reject-confirm")).not.toBeInTheDocument();
  });
});

describe("GitApprovalCard · push 态（D-014/D-015/D-006）", () => {
  it("目标/保护分支警示/ahead 按条明细；单条展开文件明细（D-015 纯浏览）", async () => {
    render(<GitApprovalCard request={makeRequest(PUSH_PAYLOAD)} />);
    expect(screen.getByText("origin/main")).toBeInTheDocument();
    expect(screen.getByText("保护分支 · 推送影响远端主线")).toBeInTheDocument();
    expect(screen.getByText("将推送的提交")).toBeInTheDocument();
    expect(screen.getByText("feat: first")).toBeInTheDocument();
    // 展开首条 → 文件明细（basename + 增删）。
    fireEvent.click(screen.getByTestId("git-approval-ahead-fff0001").querySelector("button")!);
    await waitFor(() => expect(screen.getByText("a.py")).toBeInTheDocument());
    expect(screen.getByText("+20")).toBeInTheDocument();
    // sillyspec 压扁语义提示。
    expect(screen.getByText(/按变更段压扁本地提交再快进推送/)).toBeInTheDocument();
    // 确认推送按钮。
    expect(screen.getByTestId("git-approval-approve")).toHaveTextContent("确认推送");
  });

  it("确认推送：allow + approve（push 无 selectedFiles）", async () => {
    render(<GitApprovalCard request={makeRequest(PUSH_PAYLOAD)} />);
    fireEvent.click(screen.getByTestId("git-approval-approve"));
    await waitFor(() =>
      expect(respondMock).toHaveBeenCalledWith(
        "sess-1",
        "req-1",
        "allow",
        undefined,
        { action: "approve", message: "" },
      ),
    );
  });
});

describe("GitApprovalCard · 边界", () => {
  it("畸形 payload（缺 files/defaultSelected）兜底不崩（D-012 降级面）", () => {
    render(
      <GitApprovalCard
        request={makeRequest({ operation: "commit", command: "git commit -m x" })}
      />,
    );
    expect(screen.getByText(/无文件清单——采集降级态/)).toBeInTheDocument();
    // 空勾选禁用提交（防误提交）。
    expect(screen.getByTestId("git-approval-approve")).toBeDisabled();
  });

  it("collectError 提示条渲染", () => {
    render(
      <GitApprovalCard
        request={makeRequest({ ...COMMIT_PAYLOAD, files: [], defaultSelected: [], collectError: "工作区状态采集失败：boom" })}
      />,
    );
    expect(screen.getByText(/工作区状态采集失败：boom/)).toBeInTheDocument();
  });

  it("minimized 渲染 null（保持挂载契约，勾选态由父保留）", () => {
    const { container } = render(
      <GitApprovalCard request={makeRequest(COMMIT_PAYLOAD)} minimized />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
