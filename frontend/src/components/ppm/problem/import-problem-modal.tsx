"use client";

/**
 * 问题清单 Excel 批量导入弹窗 —— 复制 import-module-modal.tsx 三态范式，
 * 适配问题清单单表 flat rows（非 plan 的多 Sheet 结构）。
 *
 * 三态：1=上传 / 2=预览(未匹配/必填缺失行标红) / 3=结果。
 * 预览走 importProblemsPreview (FormData)，提交走 importProblemsCommit (multipart: file + rows, D-013)。
 *
 * 依据：
 * - design.md §5 Wave2 step3、§7 DTO 与字段映射、§3 非目标（不导入附件/不查重/只产「新建」态）；
 * - prototype-problem-import.html（三态线框 + 全字段列）；
 * - 决策 D-001（后端解析+两步式）、D-003（全字段）；
 * - 范式完整复制 frontend/src/components/ppm/milestone/import-module-modal.tsx
 *   （step 状态机 + handleUpload/handleCommit + rowClassName 标红 + StatBox 结果）。
 *
 * 关键差异（vs import-module-modal）：
 * - 单表 flat rows：去掉 Sheet 分组维度，dataSource 直接喂 preview.rows；
 * - props 瘦身：项目归属来自 Excel 每行 project_name 反查（D-002），无 planNodeId/projectId；
 * - client 签名：importProblemsPreview(file) / importProblemsCommit(file, rows)（D-013 multipart）；
 * - 提交所有 valid 行（原型倾向后者，不做行级勾选）。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Button,
  message,
  Modal,
  Table,
  Tag,
  Upload,
  type TableProps,
} from "antd";

import { StatBox } from "@/components/ppm/milestone/milestone-helpers";
import {
  downloadImportTemplate,
  importProblemsCommit,
  importProblemsPreview,
  type ProblemImportPreviewResp,
  type ProblemImportPreviewRow,
  type ProblemImportResultResp,
} from "@/lib/ppm";
import { fmtDate } from "@/lib/ppm/format";

export interface ImportProblemModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ImportProblemModal({
  open,
  onClose,
  onSuccess,
}: ImportProblemModalProps) {
  // step: 1=上传 2=预览 3=结果
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<ProblemImportPreviewResp | null>(null);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<ProblemImportResultResp | null>(null);
  // 预览时选中的 .xlsx — commit 阶段需原文件回传 (D-013 multipart, 后端按 row_index 关联附件图)
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // 每次打开重置状态
  useEffect(() => {
    if (open) {
      setStep(1);
      setPreview(null);
      setResult(null);
      setUploading(false);
      setCommitting(false);
      setSelectedFile(null);
    }
  }, [open]);

  // --- 上传态:选 .xlsx → 预览 ---
  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const resp = await importProblemsPreview(file);
      if (resp.parse_errors.length > 0) {
        // 整体解析错误(如找不到表头)提示但仍进预览,让用户看到错误
        message.warning(resp.parse_errors.join("；"));
      }
      if (!resp.rows || resp.rows.length === 0) {
        message.error("未解析到任何数据行，请检查 Excel 表头格式");
        return;
      }
      setSelectedFile(file);
      setPreview(resp);
      setStep(2);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "预览失败");
    } finally {
      setUploading(false);
    }
  };

  // --- 预览态:全字段 Table + 标红 ---
  const previewColumns = useMemo<TableProps<ProblemImportPreviewRow>["columns"]>(
    () => [
      {
        title: "项目",
        dataIndex: "project_name",
        key: "project_name",
        width: 120,
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "模块",
        dataIndex: "module_name",
        key: "module_name",
        width: 100,
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "问题描述",
        dataIndex: "pro_desc",
        key: "pro_desc",
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "类型",
        dataIndex: "pro_type",
        key: "pro_type",
        width: 70,
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "加急",
        dataIndex: "is_urgent",
        key: "is_urgent",
        width: 60,
        render: (v: string | null) => renderBool(v),
      },
      {
        title: "功能",
        dataIndex: "func_name",
        key: "func_name",
        width: 100,
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "责任人",
        dataIndex: "duty_user_name",
        key: "duty_user_name",
        width: 90,
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "发现人",
        dataIndex: "find_by",
        key: "find_by",
        width: 90,
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "发现时间",
        dataIndex: "find_time",
        key: "find_time",
        width: 100,
        render: (v: string | null) => fmtDate(v),
      },
      {
        title: "计划起止",
        key: "plan_range",
        width: 180,
        render: (_v: unknown, row: ProblemImportPreviewRow) => {
          const s = fmtDate(row.plan_start_time, "");
          const e = fmtDate(row.plan_end_time, "");
          if (!s && !e) return "—";
          return `${s || "—"} ~ ${e || "—"}`;
        },
      },
      {
        title: "验证人",
        dataIndex: "audit_user_name",
        key: "audit_user_name",
        width: 90,
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "工作量",
        dataIndex: "work_load",
        key: "work_load",
        width: 80,
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "工作类型",
        dataIndex: "work_type",
        key: "work_type",
        width: 90,
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "问题答复",
        dataIndex: "pro_answer",
        key: "pro_answer",
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "延期",
        dataIndex: "is_delay_plan",
        key: "is_delay_plan",
        width: 60,
        render: (v: string | null) => renderBool(v),
      },
      {
        title: "备注",
        dataIndex: "remarks",
        key: "remarks",
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "附件",
        dataIndex: "attachment_count",
        key: "attachment_count",
        width: 70,
        // attachment_count=0 显 "—"; >0 显数字。超额行整行标红 + 状态列文案,见 rowClassName / 状态列。
        render: (v: number) => (v > 0 ? String(v) : "—"),
      },
      {
        title: "状态",
        key: "status",
        width: 120,
        fixed: "right",
        render: (_v: unknown, row: ProblemImportPreviewRow) => {
          // attachment_exceeded 优先展示 (design §5.3 预览阶段超额即 valid=false,
          // error "附件超过3张", 与 valid 分支文案一致不冲突); 超额优先以明确归因。
          if (row.attachment_exceeded) {
            return (
              <Tag color="red" className="text-[10px]">
                附件超过3张
              </Tag>
            );
          }
          if (!row.valid) {
            return (
              <Tag color="red" className="text-[10px]">
                {row.error ?? "不可导入"}
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

  const rowClassName = useCallback((row: ProblemImportPreviewRow) => {
    // problem 无 duty_matched 维度(plan 才有),看 valid 或 attachment_exceeded 取并集;
    // 后端按 D-005 attachment_exceeded ⇒ valid=false, 两者并集等价 (显式取并集防御)。
    return !row.valid || row.attachment_exceeded ? "bg-red-50" : "";
  }, []);

  // --- 确认导入:提交所有 valid 行(原型倾向后者,不做行级勾选) ---
  const handleCommit = async () => {
    if (!preview) return;
    if (!selectedFile) {
      message.warning("请先选择 Excel 文件");
      return;
    }
    const validRows = preview.rows.filter((r) => r.valid);
    if (validRows.length === 0) {
      message.warning("没有可导入的行");
      return;
    }
    setCommitting(true);
    try {
      // D-013 multipart: file + rows (后端按 row_index 关联附件图, task-05)
      const resp = await importProblemsCommit(selectedFile, validRows);
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

  const validCount = preview ? preview.rows.filter((r) => r.valid).length : 0;
  const invalidCount = preview ? preview.rows.length - validCount : 0;

  return (
    <Modal
      open={open}
      title="导入问题清单"
      width={980}
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
              支持 .xlsx，参考「问题清单导入模板」格式
            </p>
            <p className="mt-2 text-sm font-semibold text-primary">
              选择文件开始预览
            </p>
          </Upload.Dragger>
          <div className="mt-3 text-center">
            <Button
              type="link"
              onClick={() => {
                // D-007: 走动态端点 GET /api/ppm/problem-list/import-template,
                // 后端按当前用户 data_scope 生成 (含下拉验证), 替代旧静态 xlsx (task-09 删)。
                void downloadImportTemplate().catch((e) =>
                  message.error(
                    e instanceof Error ? e.message : "模板下载失败",
                  ),
                );
              }}
            >
              下载导入模板
            </Button>
          </div>
        </>
      ) : null}

      {step === 2 && preview ? (
        <div>
          <div className="mb-1 text-sm font-semibold">解析预览</div>
          <div className="overflow-auto rounded-lg border border-border">
            <Table<ProblemImportPreviewRow>
              size="small"
              rowKey={(r) => String(r.row_index)}
              columns={previewColumns}
              dataSource={preview.rows}
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
              <Button disabled={committing} onClick={() => setStep(1)}>
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
            <StatBox value={result.created} label="新建成功" tone="blue" />
            {/* 不可导入跳过取 preview 阶段已统计的 invalidCount (不可导入行数);后端
                service.import_commit 恒返回 skipped=0 (commit 只收 valid 行,失败入
                failed_rows),design §7 skipped 本意为前端预览阶段统计,故此处用真实来源。 */}
            <StatBox value={invalidCount} label="不可导入跳过" tone="amber" />
          </div>
          {result.failed_rows.length > 0 ? (
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
              新建问题状态默认为「新建」，创建人=当前登录用户，可在列表里逐条「开始 / 执行」。
            </span>
            <Button onClick={handleClose}>关闭</Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

/** is_urgent / is_delay_plan (importer 已转 "1"/"0") → 中文标签展示。 */
function renderBool(v: string | null): ReactNode {
  if (v === null || v === undefined) return "—";
  if (v === "1") {
    return (
      <Tag color="red" className="text-[10px]">
        是
      </Tag>
    );
  }
  if (v === "0") {
    return (
      <Tag className="text-[10px]">否</Tag>
    );
  }
  return v;
}
