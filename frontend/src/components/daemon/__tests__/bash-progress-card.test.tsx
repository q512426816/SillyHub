// task-07（2026-08-24-platform-session-feedback-fix / FR-01）：BashProgressCard 单测。
//
// 覆盖：
//   1. running 态显示 spinner、不显示退出码；
//   2. completed/failed 显示退出码徽标与 elapsed；
//   3. 命令行可复制（mock navigator.clipboard）；
//   4. stdout/stderr 按到达顺序累加、channel 标签正确；
//   5. 超长输出默认折叠，展开/收起按钮工作；
//   6. is_final=true 的 chunk 到达后停止 spinner。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { BashProgressCard, type BashChunkItem } from "@/components/daemon/bash-progress-card";

const writeTextMock = vi.fn();
Object.assign(navigator, {
  clipboard: { writeText: writeTextMock },
});

function makeChunks(count: number, channel: "stdout" | "stderr" = "stdout"): BashChunkItem[] {
  return Array.from({ length: count }, (_, i) => ({
    channel,
    content: `line-${i}\n`,
  }));
}

describe("BashProgressCard", () => {
  beforeEach(() => {
    writeTextMock.mockReset();
  });

  it("running 态显示 spinner，不显示退出码", () => {
    render(<BashProgressCard command="npm test" status="running" />);
    expect(document.querySelector(".animate-spin")).not.toBeNull();
    expect(screen.queryByText(/exit/)).toBeNull();
    expect(screen.getByTestId("bash-progress-card")).toHaveAttribute("data-status", "running");
  });

  it("completed 显示 exit code 与 elapsed", () => {
    render(
      <BashProgressCard
        command="npm test"
        status="completed"
        exitCode={0}
        elapsedMs={12345}
      />,
    );
    expect(screen.getByText("exit 0")).toBeInTheDocument();
    expect(screen.getByText(/elapsed 00:12\.3/)).toBeInTheDocument();
    expect(document.querySelector(".animate-spin")).toBeNull();
  });

  it("failed 显示非零 exit code", () => {
    render(
      <BashProgressCard
        command="npm run build"
        status="failed"
        exitCode={1}
        elapsedMs={5600}
      />,
    );
    expect(screen.getByText("exit 1")).toBeInTheDocument();
  });

  it("点击复制按钮写入命令到剪贴板", async () => {
    writeTextMock.mockResolvedValueOnce(undefined);
    render(<BashProgressCard command="pnpm gen:types" status="running" />);

    fireEvent.click(screen.getByRole("button", { name: "复制命令" }));
    await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith("pnpm gen:types"));
  });

  it("stdout/stderr 按到达顺序累加并分区着色", () => {
    const chunks: BashChunkItem[] = [
      { channel: "stdout", content: "a\n" },
      { channel: "stderr", content: "err-1\n" },
      { channel: "stdout", content: "b\n" },
    ];
    render(
      <BashProgressCard command="sh script.sh" status="running" chunks={chunks} />,
    );
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
    expect(screen.getByText("err-1")).toBeInTheDocument();
    expect(screen.getByText("stderr")).toBeInTheDocument();
  });

  it("输出超过阈值默认折叠，点击展开显示全部", () => {
    const chunks = makeChunks(30, "stdout");
    render(
      <BashProgressCard command="cat log" status="completed" chunks={chunks} />,
    );
    expect(screen.getByRole("button", { name: /展开全部/ })).toBeInTheDocument();
    expect(screen.getByText("…")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /展开全部/ }));
    expect(screen.getByRole("button", { name: /收起/ })).toBeInTheDocument();
    expect(screen.queryByText("…")).toBeNull();
  });

  it("is_final=true 的 chunk 到达后停止 spinner", () => {
    const { rerender } = render(
      <BashProgressCard
        command="npm test"
        status="running"
        chunks={[{ channel: "stdout", content: "running…", is_final: false }]}
      />,
    );
    expect(document.querySelector(".animate-spin")).not.toBeNull();

    rerender(
      <BashProgressCard
        command="npm test"
        status="running"
        chunks={[
          { channel: "stdout", content: "running…", is_final: false },
          { channel: "stdout", content: "done", is_final: true },
        ]}
      />,
    );
    expect(document.querySelector(".animate-spin")).toBeNull();
  });
});
