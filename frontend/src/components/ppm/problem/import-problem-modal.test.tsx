// task-11: import-problem-modal 单测 (问题清单 Excel 批量导入, 2026-07-24)。
//
// 覆盖三态切换 + 标红 + 提交回传:
//   用例1: step1 上传 → preview mock 返回含 valid=false 行 → 进入 step2
//          且该行标红 (rowClassName bg-red-50) + error Tag 文案渲染
//   用例2: step2 点「确认导入」→ importProblemsCommit 被调用
//          (body.rows 仅 valid 行, D-011 防篡改前端只回传 valid) + 进入 step3
//   用例3: step3 结果态渲染 created/不可导入跳过(invalidCount) 统计 (StatBox)
//          + failed_rows 空不渲染失败列表 + 点「关闭」触发 onSuccess 一次
//          (handleClose step3 触发 onSuccess 范式)。注:结果态「不可导入跳过」
//          取 preview invalidCount,非 result.skipped (service 恒 0,QA P2)。
//
// 测试边界 (对齐 problem-detail-modal.test.tsx L14-18 的 vi.mock 纯渲染哲学):
//   - jsdom 下 antd Modal/Dashboard 异步提交序列易脆, 此处全 mock API, 不触发真实网络。
//   - vi.mock @/lib/ppm/problem 的 importProblemsPreview/importProblemsCommit,
//     参考 problem-detail-modal.test.tsx L30-40 的 hoisted vi.mock + vi.mocked() 范式。
//   - 不测真实 API / 真实 Excel 解析 (importer 在后端 task-02 / service 在 task-05 已测)。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

import { ImportProblemModal } from "@/components/ppm/problem/import-problem-modal";
import type {
  ProblemImportPreviewResp,
  ProblemImportPreviewRow,
  ProblemImportResultResp,
} from "@/lib/ppm";

// ---------------------------------------------------------------------------
// hoisted vi.mock — 不触发真实 API (barrel `@/lib/ppm` 经 `export * from "./problem"`
// 重导出, mock 源模块后组件经 barrel 取到的即为同一 mock 实例)
// ---------------------------------------------------------------------------
vi.mock("@/lib/ppm/problem", () => ({
  importProblemsPreview: vi.fn(),
  importProblemsCommit: vi.fn(),
}));

// vi.mock hoisted 后, 真实 import 拿到 mock 版本
import {
  importProblemsPreview,
  importProblemsCommit,
} from "@/lib/ppm/problem";

const previewMock = vi.mocked(importProblemsPreview);
const commitMock = vi.mocked(importProblemsCommit);

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

/**
 * mkPreviewRow — 构造单行 preview, 默认全业务字段 null + valid:true / error:null。
 * 用例按需覆盖 valid/error/project_name 等 (对齐 task-07 ProblemImportPreviewRow 字段集)。
 */
function mkPreviewRow(
  over: Partial<ProblemImportPreviewRow> = {},
): ProblemImportPreviewRow {
  return {
    row_index: over.row_index ?? 1,
    project_name: over.project_name ?? null,
    module_name: over.module_name ?? null,
    pro_desc: over.pro_desc ?? null,
    pro_type: over.pro_type ?? null,
    is_urgent: over.is_urgent ?? null,
    func_name: over.func_name ?? null,
    duty_user_name: over.duty_user_name ?? null,
    find_by: over.find_by ?? null,
    find_time: over.find_time ?? null,
    plan_start_time: over.plan_start_time ?? null,
    plan_end_time: over.plan_end_time ?? null,
    audit_user_name: over.audit_user_name ?? null,
    work_load: over.work_load ?? null,
    work_type: over.work_type ?? null,
    pro_answer: over.pro_answer ?? null,
    is_delay_plan: over.is_delay_plan ?? null,
    remarks: over.remarks ?? null,
    project_id: over.project_id ?? null,
    module_id: over.module_id ?? null,
    duty_user_id: over.duty_user_id ?? null,
    audit_user_id: over.audit_user_id ?? null,
    valid: over.valid ?? true,
    error: over.error ?? null,
  };
}

function mkPreviewResp(
  rows: ProblemImportPreviewRow[],
): ProblemImportPreviewResp {
  const validCount = rows.filter((r) => r.valid).length;
  return {
    rows,
    parse_errors: [],
    valid_count: validCount,
    invalid_count: rows.length - validCount,
  };
}

function mkResult(
  over: Partial<ProblemImportResultResp> = {},
): ProblemImportResultResp {
  return {
    created: over.created ?? 0,
    skipped: over.skipped ?? 0,
    failed_rows: over.failed_rows ?? [],
  };
}

/**
 * 模拟 Upload.Dragger 选文件 (jsdom 下直接对隐藏 input[type=file] 触发 change,
 * antd Upload 内部读 e.target.files 后调 beforeUpload(file) → handleUpload)。
 */
async function fireUploadFile(fileName = "t.xlsx") {
  const input = await waitFor(() => {
    const el = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement | null;
    if (!el) throw new Error("未找到 Upload 的 file input");
    return el;
  });
  const file = new File(["fake-xlsx-bytes"], fileName, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  fireEvent.change(input, { target: { files: [file] } });
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

describe("ImportProblemModal — 三态切换 + 标红 + 提交回传", () => {
  beforeEach(() => {
    previewMock.mockReset();
    commitMock.mockReset();
  });

  it("用例1: step1 上传 → preview 含 valid=false 行 → 进入 step2 且该行标红 (bg-red-50) + error 文案", async () => {
    previewMock.mockResolvedValue(
      mkPreviewResp([
        mkPreviewRow({
          row_index: 1,
          project_name: "不存在的项目",
          valid: false,
          error: "项目名未匹配",
        }),
      ]),
    );

    render(
      <ImportProblemModal
        open={true}
        onClose={() => undefined}
        onSuccess={() => undefined}
      />,
    );

    // step1 初始文案存在
    expect(screen.getByText("选择文件开始预览")).toBeInTheDocument();

    // 触发选文件 → preview
    await fireUploadFile();

    // error 文案渲染 (状态列 Tag, 仅 step2 表格里有) — 同时证明已进入 step2
    const errorTag = await screen.findByText("项目名未匹配");
    expect(errorTag).toBeInTheDocument();

    // 标红: error Tag 所在 <tr> 应带 bg-red-50 (rowClassName !valid → "bg-red-50")
    const tr = errorTag.closest("tr");
    expect(tr?.className).toContain("bg-red-50");

    // 「确认导入」按钮出现 (进一步确认 step2 渲染)
    expect(
      screen.getByRole("button", { name: /确认导入/ }),
    ).toBeInTheDocument();

    // preview mock 被调用一次 (传入 File)
    expect(previewMock).toHaveBeenCalledTimes(1);
    expect(previewMock.mock.calls[0]?.[0]).toBeInstanceOf(File);
  });

  it("用例2: step2 点「确认导入」→ importProblemsCommit 被调用 (rows 仅 valid 行) + 进入 step3", async () => {
    const validRow = mkPreviewRow({
      row_index: 1,
      project_name: "项目甲",
      pro_desc: "问题描述A",
      valid: true,
    });
    const invalidRow = mkPreviewRow({
      row_index: 2,
      project_name: "不存在的项目",
      valid: false,
      error: "项目名未匹配",
    });
    previewMock.mockResolvedValue(mkPreviewResp([validRow, invalidRow]));
    commitMock.mockResolvedValue(mkResult({ created: 1, skipped: 1 }));

    render(
      <ImportProblemModal
        open={true}
        onClose={() => undefined}
        onSuccess={() => undefined}
      />,
    );

    // 上传 → step2
    await fireUploadFile();
    const commitBtn = await screen.findByRole("button", { name: /确认导入/ });
    // 有 1 条 valid → 按钮可点 (disabled={validCount === 0})
    expect(commitBtn).toBeEnabled();

    // 点「确认导入」
    fireEvent.click(commitBtn);

    // commit 被调用一次, body.rows 仅含 valid 行 (D-011: 前端只回传 valid, commit 重算)
    await waitFor(() => {
      expect(commitMock).toHaveBeenCalledTimes(1);
    });
    expect(commitMock).toHaveBeenCalledWith({
      rows: [validRow],
    });

    // 进入 step3: 导入完成文案出现
    await waitFor(() => {
      expect(screen.getByText(/导入完成/)).toBeInTheDocument();
    });
  });

  it("用例3: step3 结果态渲染 created/invalidCount 统计 + failed_rows 空不渲染失败列表 + 关闭触发 onSuccess 一次", async () => {
    // 结果态「不可导入跳过」取 preview 阶段的 invalidCount (不可导入行数),
    // 非 result.skipped (后端 service.import_commit 恒返回 skipped=0,design §7 本意
    // skipped 由前端预览统计)。故 preview 故意造 2 条 invalid → invalidCount=2,
    // result.skipped 恒 0 不再被读取,避免遮蔽真实来源 (2026-07-24 QA P2)。
    previewMock.mockResolvedValue(
      mkPreviewResp([
        mkPreviewRow({ row_index: 1, project_name: "项目甲", valid: true }),
        mkPreviewRow({
          row_index: 2,
          project_name: "不存在项目1",
          valid: false,
          error: "项目名未匹配",
        }),
        mkPreviewRow({
          row_index: 3,
          project_name: "不存在项目2",
          valid: false,
          error: "项目名未匹配",
        }),
      ]),
    );
    commitMock.mockResolvedValue(
      // skipped 恒 0 (service 硬编码),即使填非 0 也不会被结果态读取。
      mkResult({ created: 3, skipped: 0, failed_rows: [] }),
    );

    const onClose = vi.fn();
    const onSuccess = vi.fn();

    render(
      <ImportProblemModal open={true} onClose={onClose} onSuccess={onSuccess} />,
    );

    // 上传 → step2 → 点确认 → step3
    await fireUploadFile();
    const commitBtn = await screen.findByRole("button", { name: /确认导入/ });
    fireEvent.click(commitBtn);

    // step3: 导入完成 + StatBox label 渲染
    await waitFor(() => {
      expect(screen.getByText(/导入完成/)).toBeInTheDocument();
    });
    const createdLabel = screen.getByText("新建成功");
    const skippedLabel = screen.getByText("不可导入跳过");

    // StatBox value: created=3 (后端 result.created); 不可导入跳过=2 (preview
    // invalidCount,2 条 valid=false 行) — 取 label 所在 StatBox 根节点 textContent
    expect(createdLabel.parentElement?.textContent).toContain("3");
    expect(skippedLabel.parentElement?.textContent).toContain("2");

    // failed_rows 空 → 不渲染失败列表标题
    expect(screen.queryByText("入库失败行：")).toBeNull();

    // 点「关闭」→ handleClose: step3 且有 result → onSuccess 触发一次 + onClose 触发
    // (antd 对两汉字按钮标签自动插入空格 → "关闭" 渲染为 "关 闭", 用正则容忍)
    fireEvent.click(screen.getByRole("button", { name: /关\s?闭/ }));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
