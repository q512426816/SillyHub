// task-12:ImportModuleModal 三态导入流程 vitest 测试 (FR-008 / D-003 / D-006)。
//
// 覆盖「上传 → 预览 → 勾选 Sheet → 确认 → 结果报告」完整三态:
//   ① 上传 .xlsx → 进预览态,importModulesPreview 被调一次,解析行展示。
//   ② valid=false 行视觉标记 (bg-red-50 + 「责任人未匹配」Tag 文案)。
//   ③ 取消勾选某 Sheet → 该 Sheet rows 不进 commit payload。
//   ④ 点「确认导入」→ importModulesCommit 被调,mock.calls[0][1].sheets 仅含勾选 sheet。
//   ⑤ 结果态显示统计文案 (导入完成 / 新建模块 / ...)。
//   ⑥ 结果态关闭 → onSuccess 回调被触发。
//
// 技术约束 (对齐 task-12.md constraints):
//   - vi.mock "@/lib/ppm/plan",不真实请求;preview/commit 由 mock 返回。
//   - 不测样式细节(颜色 hex),用 className / 文案 / DOM 结构断言。
//   - AntD Upload.Dragger 在 jsdom 下渲染真实 <input type=file>,
//     用 fireEvent.change 喂 File 触发 beforeUpload(同 AntD 官方测试套路)。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";

import { ImportModuleModal } from "@/app/(dashboard)/ppm/milestone-details/page";
import type {
  ImportPreviewResp,
  ImportResultResp,
} from "@/lib/ppm";

// ---------------------------------------------------------------------------
// jsdom 环境补丁:AntD 6 的 Modal/Table/message 经 @rc-component/resize-observer
// 和 rc-util 依赖 ResizeObserver / matchMedia / scrollIntoView,jsdom 默认无实现,
// 会抛 ReferenceError 导致组件 mount 失败(同 milestone-details.test.tsx 注释提到的
// "vitest jsdom 无 ResizeObserver/matchMedia" 易碎点)。这里在模块级 polyfill,
// 仅本测试文件生效,不污染全局 setup.ts。
// ---------------------------------------------------------------------------

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
if (typeof globalThis.matchMedia === "undefined") {
  globalThis.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof matchMedia;
}
// AntD Table 行 ellipsis 计算会访问 DOM scrollWidth;jsdom 返回 0 足够,不抛错。
// Element.prototype.scrollIntoView 在 jsdom 下为空实现,无需补。

// ---------------------------------------------------------------------------
// mock @/lib/ppm/plan:提供 importModulesPreview / importModulesCommit。
// 其他导出保持真实(测试只用这两个 API)。
// ---------------------------------------------------------------------------

const mockImportModulesPreview = vi.fn();
const mockImportModulesCommit = vi.fn();

vi.mock("@/lib/ppm/plan", () => ({
  // 仅 mock 导入流程需要的两个 API;其余导出留空(测试不触达)。
  importModulesPreview: (...args: unknown[]) => mockImportModulesPreview(...args),
  importModulesCommit: (...args: unknown[]) => mockImportModulesCommit(...args),
}));

// ---------------------------------------------------------------------------
// fixtures — 2 个 Sheet:
//   正常Sheet「正常Sheet」: 全部 valid + duty_matched。
//   临时Sheet「临时Sheet」: 含 1 行 valid=false(必填缺失) + 1 行 duty 未匹配。
// ---------------------------------------------------------------------------

function mkPreview(): ImportPreviewResp {
  return {
    sheets: [
      {
        name: "正常Sheet",
        plan_type: "正常计划",
        row_count: 2,
        rows: [
          {
            sheet_name: "正常Sheet",
            plan_type: "正常计划",
            module_name: "登录模块",
            detailed_stage: "开发",
            task_theme: "登录页",
            task_description: null,
            plan_workload: "5",
            duty_user_name: "张三",
            duty_user_id: "u-zhang",
            duty_matched: true,
            duty_unmatched_note: null,
            plan_begin_time: "2026-07-01",
            plan_complete_time: "2026-07-10",
            valid: true,
            error: null,
          },
          {
            sheet_name: "正常Sheet",
            plan_type: "正常计划",
            module_name: "登录模块",
            detailed_stage: "测试",
            task_theme: "单元测试",
            task_description: null,
            plan_workload: "2",
            duty_user_name: "李四",
            duty_user_id: "u-li",
            duty_matched: true,
            duty_unmatched_note: null,
            plan_begin_time: "2026-07-11",
            plan_complete_time: "2026-07-13",
            valid: true,
            error: null,
          },
        ],
      },
      {
        name: "临时Sheet",
        plan_type: "临时计划",
        row_count: 2,
        rows: [
          {
            // valid=false:必填模块名缺失 → 不可导入
            sheet_name: "临时Sheet",
            plan_type: "临时计划",
            module_name: null,
            detailed_stage: "应急",
            task_theme: "紧急修复",
            task_description: null,
            plan_workload: "1",
            duty_user_name: "张三",
            duty_user_id: "u-zhang",
            duty_matched: true,
            duty_unmatched_note: null,
            plan_begin_time: "2026-07-14",
            plan_complete_time: "2026-07-14",
            valid: false,
            error: "模块名称缺失",
          },
          {
            // duty 未匹配 → duty_matched=false(但 valid 可能仍 true,后端按业务定)
            sheet_name: "临时Sheet",
            plan_type: "临时计划",
            module_name: "临时支撑",
            detailed_stage: "现场",
            task_theme: "现场支持",
            task_description: null,
            plan_workload: "3",
            duty_user_name: "未知用户",
            duty_user_id: null,
            duty_matched: false,
            duty_unmatched_note: null,
            plan_begin_time: "2026-07-15",
            plan_complete_time: "2026-07-16",
            valid: true,
            error: null,
          },
        ],
      },
    ],
    parse_errors: [],
  };
}

function mkResult(): ImportResultResp {
  return {
    created_modules: 2,
    merged_modules: 1,
    created_details: 3,
    skipped_rows: 1,
    failed_rows: [],
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function defaultProps(over: Partial<React.ComponentProps<typeof ImportModuleModal>> = {}) {
  return {
    planNodeId: "node-1",
    projectId: "proj-1",
    open: true,
    onClose: vi.fn(),
    onSuccess: vi.fn(),
    ...over,
  };
}

/** 触发 AntD Upload.Dragger 上传:找到真实 <input type=file> 喂 File。 */
async function uploadFile(file: File): Promise<void> {
  const input = await waitFor(() => {
    const el = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!el) throw new Error("file input 未渲染");
    return el;
  });
  fireEvent.change(input, { target: { files: [file] } });
}

describe("ImportModuleModal — 三态导入流程 (task-12 / FR-008)", () => {
  beforeEach(() => {
    mockImportModulesPreview.mockReset();
    mockImportModulesCommit.mockReset();
  });

  // -------------------------------------------------------------------------
  // ① 上传 → 预览态 + importModulesPreview 调用一次 + 解析行展示
  // -------------------------------------------------------------------------
  it("① 上传文件后进入预览态,调用 importModulesPreview 并展示 Sheet 勾选区", async () => {
    mockImportModulesPreview.mockResolvedValueOnce(mkPreview());
    render(<ImportModuleModal {...defaultProps()} />);

    // 上传态:步骤指示器渲染「1. 上传文件」(数字前缀),用子串匹配
    await screen.findByText("上传文件", { exact: false });

    const file = new File(["fake-xlsx-bytes"], "modules.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    await uploadFile(file);

    // 预览态:勾选 Sheet 区块文案 + 解析行模块名出现
    await waitFor(() => {
      expect(mockImportModulesPreview).toHaveBeenCalledTimes(1);
    });
    expect(mockImportModulesPreview).toHaveBeenCalledWith("node-1", "proj-1", file);

    expect(await screen.findByText("① 勾选要导入的 Sheet")).toBeInTheDocument();
    // 两个 Sheet 名称都展示
    expect(screen.getByText("正常Sheet")).toBeInTheDocument();
    expect(screen.getByText("临时Sheet")).toBeInTheDocument();
    // 解析行模块名展示(正常Sheet 两行都用「登录模块」,故为多个)
    expect(screen.getAllByText("登录模块").length).toBeGreaterThanOrEqual(1);
    // 步骤指示进入预览(渲染「2. 预览解析」,子串匹配)
    expect(screen.getByText("预览解析", { exact: false })).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // ② valid=false 行视觉标记 + duty 未匹配 Tag 文案 (不测颜色 hex)
  // -------------------------------------------------------------------------
  it("② 未匹配/无效行渲染「责任人未匹配」/错误 Tag 文案 + bg-red-50 行类名", async () => {
    mockImportModulesPreview.mockResolvedValueOnce(mkPreview());
    render(<ImportModuleModal {...defaultProps()} />);

    await uploadFile(new File(["x"], "m.xlsx"));
    await screen.findByText("① 勾选要导入的 Sheet");

    // duty 未匹配行:状态列渲染「责任人未匹配」Tag 文案
    expect(screen.getByText("责任人未匹配")).toBeInTheDocument();
    // valid=false 行:状态列渲染错误 Tag(文案=error)
    expect(screen.getByText("模块名称缺失")).toBeInTheDocument();

    // 行类名含 bg-red-50 (不依赖具体颜色值,仅断言 className 标记存在)
    const redRows = document.querySelectorAll('tr.bg-red-50');
    expect(redRows.length).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // ③ 取消勾选某 Sheet → 该 Sheet rows 不在 commit payload
  // -------------------------------------------------------------------------
  it("③ 取消勾选「临时Sheet」后,该 Sheet 的 rows 不进入 commit payload", async () => {
    mockImportModulesPreview.mockResolvedValueOnce(mkPreview());
    mockImportModulesCommit.mockResolvedValueOnce(mkResult());
    render(<ImportModuleModal {...defaultProps()} />);

    await uploadFile(new File(["x"], "m.xlsx"));
    await screen.findByText("① 勾选要导入的 Sheet");

    // 取消勾选「临时Sheet」(点其 Checkbox 文本节点对应的 input)
    const tempCheckbox = screen.getByText("临时Sheet").closest("label")!.querySelector('input[type="checkbox"]')!;
    fireEvent.click(tempCheckbox);

    // 临时 Sheet 的两行模块名应不再出现在表格中(表格只渲染勾选 sheet 的 rows)
    await waitFor(() => {
      expect(screen.queryByText("临时支撑")).toBeNull();
    });

    // 点确认导入
    fireEvent.click(screen.getByText("确认导入"));

    await waitFor(() => {
      expect(mockImportModulesCommit).toHaveBeenCalledTimes(1);
    });
    const payload = mockImportModulesCommit.mock.calls[0]![1] as { sheets: { name: string; rows: unknown[] }[] };
    const sheetNames = payload.sheets.map((s) => s.name);
    expect(sheetNames).toEqual(["正常Sheet"]);
    expect(sheetNames).not.toContain("临时Sheet");
  });

  // -------------------------------------------------------------------------
  // ④ 点确认 → importModulesCommit 被调,payload.sheets 仅含勾选 sheet 的 rows
  // -------------------------------------------------------------------------
  it("④ 点「确认导入」调用 importModulesCommit,payload 仅含勾选 sheet", async () => {
    mockImportModulesPreview.mockResolvedValueOnce(mkPreview());
    mockImportModulesCommit.mockResolvedValueOnce(mkResult());
    render(<ImportModuleModal {...defaultProps()} />);

    await uploadFile(new File(["x"], "m.xlsx"));
    await screen.findByText("① 勾选要导入的 Sheet");

    // 默认两个 sheet 都勾选 → payload 含两个 sheet
    fireEvent.click(screen.getByText("确认导入"));

    await waitFor(() => {
      expect(mockImportModulesCommit).toHaveBeenCalledTimes(1);
    });
    // calls[0] = [planNodeId, payload]
    expect(mockImportModulesCommit.mock.calls[0]![0]).toBe("node-1");
    const payload = mockImportModulesCommit.mock.calls[0]![1] as { sheets: { name: string; rows: unknown[] }[] };
    expect(payload.sheets.map((s) => s.name).sort()).toEqual(["临时Sheet", "正常Sheet"]);
    // 正常 sheet 含 2 行(原样回传,含所有 rows,后端按 valid 过滤)
    const normal = payload.sheets.find((s) => s.name === "正常Sheet")!;
    expect(normal.rows.length).toBe(2);
  });

  // -------------------------------------------------------------------------
  // ⑤ 结果态显示统计文案
  // -------------------------------------------------------------------------
  it("⑤ 确认后进入结果态,显示「导入完成」+ 统计文案(新建模块/不可导入跳过)", async () => {
    mockImportModulesPreview.mockResolvedValueOnce(mkPreview());
    mockImportModulesCommit.mockResolvedValueOnce(mkResult());
    render(<ImportModuleModal {...defaultProps()} />);

    await uploadFile(new File(["x"], "m.xlsx"));
    await screen.findByText("① 勾选要导入的 Sheet");
    fireEvent.click(screen.getByText("确认导入"));

    expect(await screen.findByText("导入完成", { exact: false })).toBeInTheDocument();
    // StatBox label 文案
    expect(screen.getByText("新建模块")).toBeInTheDocument();
    expect(screen.getByText("合并同名模块")).toBeInTheDocument();
    expect(screen.getByText("新增明细")).toBeInTheDocument();
    expect(screen.getByText("不可导入跳过")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // ⑥ 结果态关闭 → onSuccess 回调被触发一次
  // -------------------------------------------------------------------------
  it("⑥ 结果态点关闭 → onSuccess 被调用一次", async () => {
    mockImportModulesPreview.mockResolvedValueOnce(mkPreview());
    mockImportModulesCommit.mockResolvedValueOnce(mkResult());
    const onSuccess = vi.fn();
    render(<ImportModuleModal {...defaultProps({ onSuccess })} />);

    await uploadFile(new File(["x"], "m.xlsx"));
    await screen.findByText("① 勾选要导入的 Sheet");
    fireEvent.click(screen.getByText("确认导入"));
    await screen.findByText("导入完成", { exact: false });

    // 结果态有「关闭」按钮（antd 两字按钮自动加字间距「关闭」→「关 闭」，正则兼容）
    fireEvent.click(screen.getByText(/^关\s*闭$/));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });
});
