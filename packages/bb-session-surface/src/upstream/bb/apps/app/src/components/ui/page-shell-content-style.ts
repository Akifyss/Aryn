import type { CSSProperties } from "react";

// Tell MarkdownPreview the surrounding text-column width so narrow tables sit
// flush with the prose. The value mirrors PageShell's DEFAULT_MAX_WIDTH_CLASS
// — keep them in sync if the class changes.
export const PAGE_SHELL_CONTENT_STYLE = {
  "--md-content-w": "760px",
} as CSSProperties;
