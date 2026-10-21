// 轮级「文件变更卡」单测（形态原型组件，props only）。
//
// 覆盖：
//   1. 折叠态 = 一行头部（28px），无文件行；totals 由 files 现算；
//   2. 点头部展开 → 文件行（24px）、aria-expanded/aria-controls 联动；
//   3. shell 归因只在对应行出「命令行」徽标；
//   4. truncated → 头部「（部分）」、头部与行级 +/− 退化为 —（不假精确）；
//   5. sharedWorkspace → 提示行在折叠态也可见；
//   6. 行点击 / Enter / 空格 → onOpenFile(path)；
//   7. files 为空 → 零渲染；
//   8. 100 文件长列表：全部行渲染，列表容器限高内滚。
//   9. task-11：降级形态（degraded + capability="tool_only"）——「仅工具编辑」+ 说明行、
//      无文件行、头部不可展开、全树无「无改动」；
//  10. task-11：binary 行破折号；命令行归因行（edits=0）不出「改0次」；tool 行工具名提示。

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import {
  FileChangesCard,
  type ChangedFile,
} from "@/components/daemon/file-changes/file-changes-card";

function makeFile(index: number, overrides: Partial<ChangedFile> = {}): ChangedFile {
  return {
    path: `frontend/src/file-${index}.tsx`,
    adds: index,
    dels: index,
    edits: 1,
    source: "tool",
    ...overrides,
  };
}

const EIGHT_FILES: ChangedFile[] = [
  { path: "a.tsx", adds: 128, dels: 4, edits: 3, source: "tool" },
  { path: "b.tsx", adds: 46, dels: 2, edits: 2, source: "tool" },
  { path: "c.css", adds: 18, dels: 0, edits: 1, source: "tool" },
  { path: "d.tsx", adds: 24, dels: 0, edits: 1, source: "tool" },
  { path: "e.tsx", adds: 10, dels: 0, edits: 1, source: "tool" },
  { path: "f.spec.ts", adds: 4, dels: 0, edits: 1, source: "tool" },
  { path: "g.mjs", adds: 0, dels: 1, edits: 1, source: "tool" },
  { path: "package.json", adds: 0, dels: 1, edits: 1, source: "shell" },
];

describe("FileChangesCard", () => {
  it("折叠态只渲染 28px 头部一行，totals 由 files 求和", () => {
    render(<FileChangesCard files={EIGHT_FILES} turnNo={16} />);

    const header = screen.getByTestId("file-changes-header");
    expect(header.className).toContain("h-7");
    expect(screen.getByTestId("file-changes-card")).toHaveAttribute("data-expanded", "false");
    expect(screen.getByText("已编辑 8 个文件")).toBeInTheDocument();
    expect(screen.getByText("+230")).toBeInTheDocument();
    expect(screen.getByText("−8")).toBeInTheDocument();
    expect(screen.getByText("第 16 轮")).toBeInTheDocument();
    expect(screen.queryAllByTestId("file-changes-row")).toHaveLength(0);
  });

  it("点头部展开：行高 24px、逐文件 +/− 与「改N次」", () => {
    render(<FileChangesCard files={EIGHT_FILES} />);

    fireEvent.click(screen.getByTestId("file-changes-header"));

    expect(screen.getByTestId("file-changes-card")).toHaveAttribute("data-expanded", "true");
    expect(screen.getByTestId("file-changes-header")).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByTestId("file-changes-header").getAttribute("aria-controls"),
    ).toBe(screen.getByTestId("file-changes-list").id);

    const rows = screen.getAllByTestId("file-changes-row");
    expect(rows).toHaveLength(8);
    expect(rows[0]!.className).toContain("h-6");
    expect(rows[0]!.textContent).toContain("+128");
    expect(rows[0]!.textContent).toContain("−4");
    expect(rows[0]!.textContent).toContain("改3次");
  });

  it("shell 归因只在对应行出「命令行」徽标", () => {
    render(<FileChangesCard files={EIGHT_FILES} startExpanded />);

    expect(screen.getAllByText("命令行")).toHaveLength(1);
    const shellRow = screen.getByText("package.json").closest('[data-testid="file-changes-row"]');
    expect(shellRow).toHaveAttribute("data-source", "shell");
  });

  it("truncated：头部（部分）+ 行级统计退化为 —，不拿半截 numstat 充总数", () => {
    render(<FileChangesCard files={EIGHT_FILES.slice(0, 3)} truncated startExpanded />);

    expect(screen.getByText("（部分）")).toBeInTheDocument();
    // 头部不再出现任何 +/− 数字（快照只回了文件清单，行数未知）。
    expect(screen.getByTestId("file-changes-header").textContent).not.toContain("+");
    expect(screen.getByTestId("file-changes-header").textContent).not.toContain("−");
    expect(screen.getAllByTestId("file-changes-row")[0]!.textContent).toContain("—");
    // 计数仍可靠：文件数与编辑次数照常。
    expect(screen.getByText("已编辑 3 个文件")).toBeInTheDocument();
    expect(screen.getAllByTestId("file-changes-row")[0]!.textContent).toContain("改3次");
  });

  it("sharedWorkspace：折叠态即可见提示行", () => {
    render(<FileChangesCard files={EIGHT_FILES} sharedWorkspace />);

    expect(screen.getByText("共享工作区，可能含并行会话改动")).toBeInTheDocument();
    expect(screen.queryAllByTestId("file-changes-row")).toHaveLength(0);
  });

  it("行点击 / Enter / 空格都触发 onOpenFile(path)", () => {
    const onOpenFile = vi.fn();
    render(<FileChangesCard files={EIGHT_FILES} startExpanded onOpenFile={onOpenFile} />);

    const rows = screen.getAllByTestId("file-changes-row");
    fireEvent.click(rows[0]!);
    expect(onOpenFile).toHaveBeenLastCalledWith("a.tsx");

    fireEvent.keyDown(rows[1]!, { key: "Enter" });
    expect(onOpenFile).toHaveBeenLastCalledWith("b.tsx");

    fireEvent.keyDown(rows[2]!, { key: " " });
    expect(onOpenFile).toHaveBeenLastCalledWith("c.css");

    // 非激活键不触发。
    fireEvent.keyDown(rows[3]!, { key: "a" });
    expect(onOpenFile).toHaveBeenCalledTimes(3);
  });

  it("files 为空 → 零渲染", () => {
    const { container } = render(<FileChangesCard files={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("100 文件全部渲染，列表限高内滚（max-h-240px overflow-y-auto）", () => {
    const files = Array.from({ length: 100 }, (_, index) => makeFile(index));
    render(<FileChangesCard files={files} startExpanded />);

    expect(screen.getAllByTestId("file-changes-row")).toHaveLength(100);
    const list = screen.getByTestId("file-changes-list");
    expect(list.className).toContain("max-h-[240px]");
    expect(list.className).toContain("overflow-y-auto");
  });
});

/* task-11（2026-10-20-session-page-dsh-alignment 线 C「1b 第三段」）：
 * 真实数据面新增的三态（降级形态 / 二进制行 / 命令行行无编辑次数）——上面 8 例
 * 锁定的形态（28px 折叠行 / 24px 文件行 / 240px 限高 / 破折号 / 归因徽标）不动。 */
describe("FileChangesCard：降级形态与真实快照细节（task-11）", () => {
  it('degraded：折叠头「仅工具编辑」+ 说明行，无文件行、无 +/− 数字、头部不可展开', () => {
    render(<FileChangesCard files={[]} degraded capability="tool_only" turnNo={3} />);

    const card = screen.getByTestId("file-changes-card");
    expect(card).toHaveAttribute("data-degraded", "true");
    expect(card).toHaveAttribute("data-capability", "tool_only");
    expect(screen.getByText("仅工具编辑")).toBeInTheDocument();
    expect(
      screen.getByText("daemon 未上报工作区快照，本卡只含 Edit/Write 工具编辑"),
    ).toBeInTheDocument();
    expect(screen.getByText("第 3 轮")).toBeInTheDocument();

    // 降级卡没有行可开合：头部不是按钮、不给读屏假的 aria-expanded。
    const header = screen.getByTestId("file-changes-header");
    expect(header.tagName).toBe("DIV");
    expect(header).not.toHaveAttribute("aria-expanded");
    expect(screen.queryAllByTestId("file-changes-row")).toHaveLength(0);
    // 没有可信行级统计 → 头部只有破折号，不拿 0 冒充总数。
    expect(header.textContent).not.toContain("+");
    expect(header.textContent).not.toContain("−");
  });

  it("降级态全树不出现「无改动」字样（没有快照 ≠ 本轮无改动，E6/E8 硬约束）", () => {
    const { container } = render(
      <FileChangesCard files={[]} degraded capability="tool_only" sharedWorkspace />,
    );

    expect(container.textContent).toContain("仅工具编辑");
    expect(screen.queryByText(/无改动/)).toBeNull();
    // 共享工作区提示与降级说明可并存（两件事：缺能力 + 归属不可分）。
    expect(screen.getByText("共享工作区，可能含并行会话改动")).toBeInTheDocument();
  });

  it("files 为空且非降级 → 仍然零渲染（既有空态语义不回归）", () => {
    const { container } = render(<FileChangesCard files={[]} capability="full" />);
    expect(container.firstChild).toBeNull();
  });

  it("binary 行：行级 +/− 显示破折号并标注「二进制文件」", () => {
    render(
      <FileChangesCard
        files={[
          { path: "assets/logo.png", adds: 0, dels: 0, edits: 1, source: "tool", binary: true },
        ]}
        startExpanded
      />,
    );

    const row = screen.getAllByTestId("file-changes-row")[0]!;
    expect(row.textContent).toContain("—");
    expect(row.textContent).not.toContain("+0");
    expect(row.textContent).not.toContain("−0");
    expect(
      row.querySelector('[title="二进制文件：无行级行数统计"]'),
    ).not.toBeNull();
  });

  it("命令行归因行（edits=0）不出「改0次」；tool 行保留工具名提示", () => {
    render(
      <FileChangesCard
        files={[
          { path: "scripts/build.mjs", adds: 4, dels: 0, edits: 0, source: "shell" },
          {
            path: "src/app.tsx",
            adds: 6,
            dels: 1,
            edits: 2,
            source: "tool",
            editToolNames: ["Edit", "Write"],
          },
        ]}
        startExpanded
      />,
    );

    const [shellRow, toolRow] = screen.getAllByTestId("file-changes-row");
    // 0 会被读成「没改过」，而该行就在改动清单里 → 整列不渲染。
    expect(shellRow!.textContent).not.toContain("改0次");
    expect(shellRow!.querySelector('[data-testid="file-changes-edits"]')).toBeNull();
    const edits = toolRow!.querySelector('[data-testid="file-changes-edits"]');
    expect(edits).not.toBeNull();
    expect(edits!.textContent).toContain("改2次");
    expect(edits!.getAttribute("title")).toBe("编辑工具：Edit、Write");
  });
});
