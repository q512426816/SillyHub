"use client";

/**
 * McpTemplatePickerModal — 从模板新建弹窗（变更 2026-09-10-mcp-central-registry
 * / task-12 / FR-09，照原型 ③ 工具栏「从模板新建」入口）。
 *
 * 模板列表（预置全员 + 本人自存，task-10 端点）→ 选中把 server_config 预填进
 * server-form-modal 新建（模板为明文无 secret；secret 由用户在表单 env 区补）。
 * 预填通过 onPick 回调把模板交给页面，页面以 create 模式 + template 预填打开
 * 表单（server-form-modal 的 template prop）。
 */
import { Button, Empty, Modal, Spin } from "antd";
import { StarFilled } from "@ant-design/icons";

import { errMessage } from "@/lib/errors";
import {
  useMcpTemplates,
  type McpTemplateRead,
} from "@/lib/api/mcp-registry";
import { readStdioEntry } from "@/lib/api/mcp-registry";

export interface McpTemplatePickerModalProps {
  open: boolean;
  onClose: () => void;
  /** 选中模板（含解析后的 stdio 形态，预填表单用）。 */
  onPick: (picked: McpTemplatePick) => void;
}

/** 选中模板的预填载荷（页面传给 server-form-modal 的 template prop 同形态）。 */
export interface McpTemplatePick {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function McpTemplatePickerModal({ open, onClose, onPick }: McpTemplatePickerModalProps) {
  const { templates, isLoading, isError, error, refetch } = useMcpTemplates();

  const handlePick = (t: McpTemplateRead) => {
    // server_config 为 stdio 形态 {type,command,args,env}；容错取值与表单一致。
    const { command, args, env } = readStdioEntry(t.server_config);
    onPick({ name: t.name, command, args, env });
    onClose();
  };

  return (
    <Modal
      open={open}
      title="从模板新建"
      onCancel={onClose}
      footer={null}
      width={560}
      destroyOnHidden
    >
      {isLoading ? (
        <div className="py-10 text-center">
          <Spin />
        </div>
      ) : isError ? (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-sm text-destructive">
          {errMessage(error, "模板加载失败")}
          <Button className="ml-3" size="small" onClick={() => void refetch()}>
            重新加载
          </Button>
        </div>
      ) : templates.length === 0 ? (
        <Empty className="py-8" description="暂无模板" />
      ) : (
        <div className="max-h-96 space-y-2 overflow-y-auto" data-testid="mcp-template-list">
          {templates.map((t) => {
            const { command } = readStdioEntry(t.server_config);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => handlePick(t)}
                className="flex w-full items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-left transition-colors hover:border-brand-300 hover:bg-brand-50"
                data-testid="mcp-template-row"
              >
                {t.is_preset ? (
                  <StarFilled className="shrink-0 text-amber-500" aria-label="预置模板" />
                ) : (
                  <StarFilled className="shrink-0 text-muted-foreground/40" aria-label="我的模板" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{t.name}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {command || "—"}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-brand-600">使用 →</span>
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
