"use client";

import * as React from "react";
import type {
  DocxCommentCardRenderProps,
  DocxDocumentTheme,
  DocxTrackedChangeCardRenderProps,
} from "@extend-ai/react-docx";

import { DOCX_ANNOTATION_COPY } from "@/components/ui/viewer-copy";
import { cn } from "@/components/ui/viewer-utils";

type AnnotationTone =
  | "accent"
  | "danger"
  | "outline"
  | "secondary"
  | "success"
  | "warning";

const ANNOTATION_TONE_CLASS: Record<AnnotationTone, string> = {
  accent: "bg-[var(--accent-soft)] text-[var(--accent)]",
  danger:
    "bg-[color-mix(in_oklch,var(--danger)_14%,transparent)] text-[var(--danger)]",
  outline:
    "border border-[var(--border-primary)] text-[var(--foreground-secondary)]",
  secondary:
    "bg-[var(--background-tertiary)] text-[var(--foreground-secondary)]",
  success:
    "bg-[color-mix(in_oklch,var(--success)_14%,transparent)] text-[var(--success)]",
  warning:
    "bg-[color-mix(in_oklch,var(--warning)_14%,transparent)] text-[var(--warning)]",
};

function trackedChangeBadgeTone(
  kind: DocxTrackedChangeCardRenderProps["change"]["kind"],
): AnnotationTone {
  switch (kind) {
    case "insertion":
    case "move-to":
      return "success";
    case "deletion":
    case "move-from":
      return "danger";
    default:
      return "warning";
  }
}

function trackedChangeBadgeLabel({
  change,
  kindLabel,
}: Pick<DocxTrackedChangeCardRenderProps, "change" | "kindLabel">) {
  switch (change.kind) {
    case "insertion":
      return DOCX_ANNOTATION_COPY.inserted;
    case "deletion":
      return DOCX_ANNOTATION_COPY.removed;
    case "move-from":
      return DOCX_ANNOTATION_COPY.movedFrom;
    case "move-to":
      return DOCX_ANNOTATION_COPY.movedTo;
    default:
      return kindLabel;
  }
}

function DocxAnnotationCard({
  anchorText,
  badge,
  badgeTone = "outline",
  date,
  meta,
  snippet,
  style,
}: {
  anchorText?: string;
  badge: string;
  badgeTone?: AnnotationTone;
  date?: string;
  meta: string;
  snippet: string;
  style: React.CSSProperties;
}) {
  const cardStyle: React.CSSProperties = {
    ...style,
    backgroundColor: "var(--background-primary)",
    color: "var(--foreground-primary)",
  };
  const anchorStyle: React.CSSProperties = {
    backgroundColor: "var(--background-secondary)",
    color: "var(--foreground-secondary)",
  };

  return (
    <div
      style={cardStyle}
      className="pointer-events-auto box-border flex flex-col gap-2 rounded-lg border border-[var(--border-secondary)] p-2 shadow-sm"
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 text-[11px] leading-tight font-medium text-[var(--foreground-secondary)]">
          <div className="truncate">{meta}</div>
          {date ? <div className="mt-0.5 truncate">{date}</div> : null}
        </div>
        <span
          className={cn(
            "inline-flex h-5 max-w-[92px] shrink-0 items-center rounded-md px-1.5 text-[10px] font-medium",
            ANNOTATION_TONE_CLASS[badgeTone],
          )}
        >
          {badge}
        </span>
      </div>
      {anchorText ? (
        <div
          className="rounded-md px-2 py-1 text-[11px] leading-snug italic"
          style={anchorStyle}
        >
          {anchorText}
        </div>
      ) : null}
      <div className="text-xs leading-snug break-words">{snippet}</div>
    </div>
  );
}

export function createDocxTrackedChangeCardRenderer(
  _documentTheme: DocxDocumentTheme,
) {
  return function renderDocxTrackedChangeCard({
    change,
    formattedDate,
    kindLabel,
    snippet,
    style,
  }: DocxTrackedChangeCardRenderProps) {
    return (
      <DocxAnnotationCard
        badge={trackedChangeBadgeLabel({ change, kindLabel })}
        badgeTone={trackedChangeBadgeTone(change.kind)}
        date={formattedDate}
        meta={change.author?.trim() || DOCX_ANNOTATION_COPY.unknownAuthor}
        snippet={snippet}
        style={style}
      />
    );
  };
}

export function createDocxCommentCardRenderer(
  _documentTheme: DocxDocumentTheme,
) {
  return function renderDocxCommentCard({
    comment,
    formattedDate,
    snippet,
    style,
  }: DocxCommentCardRenderProps) {
    const badge = comment.resolved
      ? DOCX_ANNOTATION_COPY.resolved
      : comment.parentId !== undefined
        ? DOCX_ANNOTATION_COPY.reply
        : DOCX_ANNOTATION_COPY.comment;

    return (
      <DocxAnnotationCard
        anchorText={comment.anchorText}
        badge={badge}
        badgeTone={comment.resolved ? "secondary" : "accent"}
        date={formattedDate}
        meta={comment.author?.trim() || DOCX_ANNOTATION_COPY.unknownAuthor}
        snippet={snippet}
        style={style}
      />
    );
  };
}
