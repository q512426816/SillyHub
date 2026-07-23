"use client";

/**
 * 模块 Excel 导入弹窗 —— 从 app/(dashboard)/ppm/milestone-details/page.tsx 复制抽取（W5），
 * 供移动端模块层复用（对齐 W1 抽取范式 D-007：复制抽取，桌面 page.tsx 保留原定义零风险）。
 *
 * 三态：1=上传 / 2=预览(勾选 Sheet + 标错) / 3=结果。
 * 预览走 importModulesPreview (FormData)，提交走 importModulesCommit (JSON)。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  message,
  Modal,
  Table,
  Tag,
  Upload,
  type TableProps,
} from "antd";

import { StatBox } from "@/components/ppm/milestone/milestone-helpers";
import {
  importModulesCommit,
  importModulesPreview,
  type ImportPreviewResp,
  type ImportPreviewRow,
  type ImportResultResp,
} from "@/lib/ppm";
import { fmtDate } from "@/lib/ppm/format";

export interface ImportModuleModalProps {
  planNodeId: string;
  projectId: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ImportModuleModal({
  planNodeId,
  projectId,
  open,
  onClose,
  onSuccess,
}: ImportModuleModalProps) {
  // step: 1=上传 2=预览 3=结果
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewResp | null>(null);
  const [checkedSheets, setCheckedSheets] = useState<Record<string, boolean>>(
    {},
  );
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<ImportResultResp | null>(null);

  // 每次打开重置状态
  useEffect(() => {
    if (open) {
      setStep(1);
      setPreview(null);
      setCheckedSheets({});
      setResult(null);
      setUploading(false);
      setCommitting(false);
    }
  }, [open]);

  // --- 上传态:选 .xlsx → 预览 ---
  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const resp = await importModulesPreview(planNodeId, projectId, file);
      if (resp.parse_errors.length > 0) {
        // 整体解析错误(如找不到表头)提示但仍进预览,让用户看到错误
        message.warning(resp.parse_errors.join("；"));
      }
      if (!resp.sheets || resp.sheets.length === 0) {
        message.error("未解析到任何数据 Sheet,请检查 Excel 表头格式");
        return;
      }
      const init: Record<string, boolean> = {};
      for (const s of resp.sheets) init[s.name] = true;
      setCheckedSheets(init);
      setPreview(resp);
      setStep(2);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "预览失败");
    } finally {
      setUploading(false);
    }
  };

  // --- 预览态:勾选 sheet 的 rows(含未匹配/无效行;后端按 valid 过滤) ---
  const visibleRows = useMemo(() => {
    if (!preview) return [];
    return preview.sheets
      .filter((s) => checkedSheets[s.name])
      .flatMap((s) => s.rows);
  }, [preview, checkedSheets]);

  const previewColumns = useMemo<TableProps<ImportPreviewRow>["columns"]>(
    () => [
      {
        title: "计划类型",
        dataIndex: "plan_type",
        key: "plan_type",
        width: 90,
        render: (v: string) =>
          v === "临时计划" ? (
            <Tag color="orange" className="text-[10px]">
              临时
            </Tag>
          ) : (
            <Tag color="blue" className="text-[10px]">
              正常
            </Tag>
          ),
      },
      {
        title: "模块",
        dataIndex: "module_name",
        key: "module_name",
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "明细阶段",
        dataIndex: "detailed_stage",
        key: "detailed_stage",
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "任务主题",
        dataIndex: "task_theme",
        key: "task_theme",
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "工作量",
        dataIndex: "plan_workload",
        key: "plan_workload",
        width: 80,
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "责任人",
        dataIndex: "duty_user_name",
        key: "duty_user_name",
        width: 100,
        render: (v: string | null, row: ImportPreviewRow) =>
          v ? (
            <span>
              {v}
              {row.duty_unmatched_note ? (
                <span className="ml-1 text-[10px] text-destructive">
                  ({row.duty_unmatched_note})
                </span>
              ) : null}
            </span>
          ) : (
            "—"
          ),
      },
      {
        title: "开始",
        dataIndex: "plan_begin_time",
        key: "plan_begin_time",
        width: 100,
        render: (v: string | null) => fmtDate(v),
      },
      {
        title: "结束",
        dataIndex: "plan_complete_time",
        key: "plan_complete_time",
        width: 100,
        render: (v: string | null) => fmtDate(v),
      },
      {
        title: "状态",
        key: "status",
        width: 110,
        render: (_v: unknown, row: ImportPreviewRow) => {
          if (!row.valid) {
            return (
              <Tag color="red" className="text-[10px]">
                {row.error ?? "不可导入"}
              </Tag>
            );
          }
          if (!row.duty_matched) {
            return (
              <Tag color="orange" className="text-[10px]">
                责任人未匹配
              </Tag>
            );
          }
          return (
            <Tag color="green" className="text-[10px]">
              就绪
            </Tag>
          );
        },
      },
    ],
    [],
  );

  const rowClassName = useCallback((row: ImportPreviewRow) => {
    return !row.valid || !row.duty_matched ? "bg-red-50" : "";
  }, []);

  // --- 确认导入:组装勾选 sheet 的 rows 原样回传 ---
  const handleCommit = async () => {
    if (!preview) return;
    const sheets = preview.sheets
      .filter((s) => checkedSheets[s.name])
      .map((s) => ({ name: s.name, plan_type: s.plan_type, rows: s.rows }));
    if (sheets.length === 0) {
      message.warning("请至少勾选一个 Sheet");
      return;
    }
    setCommitting(true);
    try {
      const resp = await importModulesCommit(planNodeId, { sheets });
      setResult(resp);
      setStep(3);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "导入失败");
    } finally {
      setCommitting(false);
    }
  };

  // --- 结果态关闭:刷新列表 + 关弹窗 ---
  const handleClose = () => {
    if (step === 3 && result) {
      onSuccess();
    }
    onClose();
  };

  const validCount = visibleRows.filter((r) => r.valid).length;
  const invalidCount = visibleRows.length - validCount;

  return (
    <Modal
      open={open}
      title="导入模块（实施阶段）"
      width={880}
      destroyOnClose
      maskClosable={false}
      onCancel={handleClose}
      footer={null}
    >
      {/* 步骤指示 */}
      <div className="mb-4 flex text-xs">
        {["上传文件", "预览解析", "完成导入"].map((t, i) => {
          const n = (i + 1) as 1 | 2 | 3;
          const done = n < step;
          const active = n === step;
          return (
            <div
              key={t}
              className={[
                "flex-1 border-t-2 px-1 py-2 text-center",
                done
                  ? "border-success font-medium text-success"
                  : active
                    ? "border-primary font-semibold text-primary"
                    : "border-border text-muted-foreground",
              ].join(" ")}
            >
              {done ? "✓ " : `${n}. `}
              {t}
            </div>
          );
        })}
      </div>

      {step === 1 ? (
        <>
          <Upload.Dragger
            accept=".xlsx"
            multiple={false}
            showUploadList={false}
            beforeUpload={(file) => {
              void handleUpload(file);
              // 返回 false 阻止 AntD 自动上传
              return false;
            }}
            disabled={uploading}
          >
            <p className="text-3xl">📄</p>
            <p className="text-sm text-muted-foreground">
              {uploading ? "解析中…" : "点击或拖拽 Excel 文件到此"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              支持 .xlsx，参考「项目详细开发计划」格式
            </p>
            <p className="mt-2 text-sm font-semibold text-primary">
              选择文件开始预览
            </p>
          </Upload.Dragger>
          <div className="mt-3 text-center">
            <Button
              type="link"
              onClick={() => {
                // 模板置于 public/templates(Next.js 静态服务),临时 anchor 触发下载。
                const a = document.createElement("a");
                a.href = "/templates/dev-plan-template.xlsx";
                a.download = "项目详细开发计划模板.xlsx";
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
              }}
            >
              下载导入模板
            </Button>
          </div>
        </>
      ) : null}

      {step === 2 && preview ? (
        <div>
          <div className="mb-1 text-sm font-semibold">① 勾选要导入的 Sheet</div>
          <div className="mb-3 rounded-lg border border-border px-4 py-1">
            {preview.sheets.map((s) => (
              <div
                key={s.name}
                className="flex items-center gap-2 border-b border-slate-100 py-2 last:border-b-0"
              >
                <Checkbox
                  checked={checkedSheets[s.name] ?? true}
                  onChange={(e) =>
                    setCheckedSheets((prev) => ({
                      ...prev,
                      [s.name]: e.target.checked,
                    }))
                  }
                >
                  <span className="text-sm">{s.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    （{s.plan_type} · {s.row_count} 行）
                  </span>
                </Checkbox>
              </div>
            ))}
          </div>
          <div className="mb-1 text-sm font-semibold">② 解析预览</div>
          <div className="overflow-auto rounded-lg border border-border">
            <Table<ImportPreviewRow>
              size="small"
              rowKey={(r, idx) => `${r.sheet_name}-${idx}`}
              columns={previewColumns}
              dataSource={visibleRows}
              pagination={false}
              scroll={{ x: "max-content", y: 320 }}
              rowClassName={rowClassName}
            />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              将提交 {validCount} 条可导入行
              {invalidCount > 0 ? `（${invalidCount} 条不可导入将跳过）` : ""}
            </span>
            <div className="flex gap-2">
              <Button
                disabled={committing}
                onClick={() => setStep(1)}
              >
                上一步
              </Button>
              <Button
                type="primary"
                loading={committing}
                disabled={validCount === 0}
                onClick={() => void handleCommit()}
              >
                {committing ? "导入中…" : "确认导入"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {step === 3 && result ? (
        <div>
          <div className="mb-2 font-semibold text-success">✓ 导入完成</div>
          <div className="mb-4 flex flex-wrap gap-3">
            <StatBox value={result.created_modules} label="新建模块" tone="blue" />
            <StatBox value={result.merged_modules} label="合并同名模块" tone="blue" />
            <StatBox value={result.created_details} label="新增明细" tone="blue" />
            <StatBox value={result.skipped_rows} label="不可导入跳过" tone="amber" />
          </div>
          {result.failed_rows && result.failed_rows.length > 0 ? (
            <div className="rounded-lg border border-destructive/30 bg-red-50 p-3 text-xs text-destructive">
              <b>入库失败行：</b>
              <ul className="mt-1 list-disc pl-5">
                {result.failed_rows.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
            <span className="text-xs text-muted-foreground">
              明细状态默认为「草稿」，可在明细列表里逐条提交。
            </span>
            <Button onClick={handleClose}>关闭</Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
