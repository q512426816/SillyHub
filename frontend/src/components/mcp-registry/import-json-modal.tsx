"use client";

/**
 * McpImportJsonModal — JSON 粘贴导入弹窗（变更 2026-09-10-mcp-central-registry
 * / task-12 / FR-06，照原型 prototype-mcp-central-registry.html ⑤ 弹窗段）。
 *
 * 交互：textarea 粘贴（支持 mcpServers / servers / mcp 三种顶层键——后端
 * importer._WRAPPER_KEYS 探测，前端不预判）+ 目标库选择（我的库（私有）/
 * 平台共享库[admin]，scope=platform 由后端 router 权限门拦）→ 提交后展示
 * imported / skipped / renamed 三计数结果与 skipped 原因列表（后端 skipped
 * 条目为「原始键: 原因」中文文案，可直出）。
 *
 * mutation 由本组件持有（useImportMcpJson，成功后失效库列表缓存），页面只
 * 负责开关。McpImportResultView 为 JSON 导入 / workspace 扫描两弹窗共用的
 * 结果视图（同一 McpImportResult 契约）。
 *
 * 样式：antd Modal + FRONTEND_PAGE_STYLE §0.5（判定色绿导入/灰跳过/黄改名，
 * 对齐原型 .v-import/.v-skip/.v-rename）。
 */
import { useEffect, useState } from "react";
import { Button, Input, Modal, Select } from "antd";

import {
  useImportMcpJson,
  type McpImportResult,
  type McpImportScope,
} from "@/lib/api/mcp-registry";
import { errMessage } from "@/lib/errors";

// ── 导入结果视图（JSON 导入 / 扫描 apply 共用） ─────────────────────────────

export interface McpImportResultViewProps {
  result: McpImportResult;
  /** 结果视图内补充动作（如「重新扫描」）；缺省仅展示。 */
  extraAction?: React.ReactNode;
}

export function McpImportResultView({ result, extraAction }: McpImportResultViewProps) {
  return (
    <div className="space-y-3" data-testid="mcp-import-result">
      <div className="flex flex-wrap gap-2">
        <span className="rounded border border-green-300 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
          导入 {result.imported.length}
        </span>
        <span className="rounded border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
          跳过 {result.skipped.length}
        </span>
        <span className="rounded border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
          改名 {result.renamed.length}
        </span>
      </div>

      {result.imported.length > 0 && (
        <div className="text-xs text-muted-foreground">
          已导入：
          {result.imported.map((name) => (
            <code key={name} className="mx-1 rounded bg-muted px-1.5 py-0.5">
              {name}
            </code>
          ))}
        </div>
      )}
      {result.renamed.length > 0 && (
        <div className="text-xs text-muted-foreground">
          名称经归一化改写后落库：
          {result.renamed.map((name) => (
            <code key={name} className="mx-1 rounded bg-muted px-1.5 py-0.5">
              {name}
            </code>
          ))}
        </div>
      )}
      {result.skipped.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">跳过原因：</p>
          <ul className="space-y-1">
            {result.skipped.map((line) => (
              <li
                key={line}
                className="rounded border bg-muted/50 px-2 py-1 font-mono text-[11px] text-muted-foreground"
              >
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.imported.length === 0 && result.skipped.length === 0 && (
        <p className="text-xs text-muted-foreground">没有可导入的条目。</p>
      )}
      {extraAction}
    </div>
  );
}

// ── JSON 粘贴导入弹窗 ───────────────────────────────────────────────────────

export interface McpImportJsonModalProps {
  open: boolean;
  /** 平台库选项仅 admin 可选（scope=platform 需 SETTINGS_ADMIN）。 */
  isAdmin: boolean;
  /** 缺省目标库（随当前 tab；非 admin 强制 mine）。 */
  defaultScope: McpImportScope;
  onClose: () => void;
}

export function McpImportJsonModal({
  open,
  isAdmin,
  defaultScope,
  onClose,
}: McpImportJsonModalProps) {
  const [text, setText] = useState("");
  const [scope, setScope] = useState<McpImportScope>("mine");
  const [result, setResult] = useState<McpImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const importJson = useImportMcpJson();

  // 打开即重置（destroyOnHidden 下 state 复用，需显式清）。
  useEffect(() => {
    if (open) {
      setText("");
      setScope(isAdmin ? defaultScope : "mine");
      setResult(null);
      setError(null);
    }
  }, [open, isAdmin, defaultScope]);

  const handleSubmit = async () => {
    const jsonText = text.trim();
    if (!jsonText) return;
    setError(null);
    try {
      setResult(await importJson.mutateAsync({ jsonText, scope }));
    } catch (err) {
      setError(errMessage(err, "导入失败"));
    }
  };

  const scopeOptions: { value: McpImportScope; label: string }[] = [
    { value: "mine", label: "我的库（私有）" },
    ...(isAdmin
      ? [{ value: "platform" as const, label: "平台共享库（全员可见）" }]
      : []),
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="导入 JSON"
      width={560}
      mask={{ closable: false }}
      destroyOnHidden
      footer={
        result ? (
          <Button type="primary" onClick={onClose}>
            完成
          </Button>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <Button onClick={onClose}>取消</Button>
            <Button
              type="primary"
              loading={importJson.isPending}
              disabled={!text.trim()}
              onClick={() => void handleSubmit()}
            >
              导入
            </Button>
          </div>
        )
      }
    >
      {result ? (
        <McpImportResultView result={result} />
      ) : (
        <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground">
            粘贴 Claude Code / Cursor 等工具的 MCP 配置 JSON（支持 mcpServers /
            servers / mcp 三种顶层键）。同名已存在的条目会跳过，绝不覆盖既有配置。
          </p>
          <Input.TextArea
            className="font-mono text-xs"
            rows={9}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'{\n  "mcpServers": {\n    "context7": {\n      "command": "npx",\n      "args": ["-y", "@upstash/context7-mcp"]\n    }\n  }\n}'}
            data-testid="mcp-import-json-textarea"
          />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">导入到</span>
            <Select
              value={scope}
              onChange={(v) => setScope(v)}
              options={scopeOptions}
              className="w-48"
              aria-label="导入目标库"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
