type BuildMeoWrapperHtmlOptions = {
  cacheKey: string
  routePrefix: string
  title?: string
}

export function buildMeoWrapperHtml({
  cacheKey,
  routePrefix,
  title = 'Markdown Editor Optimized',
}: BuildMeoWrapperHtmlOptions) {
  const staticPrefix = `${routePrefix}${encodeURIComponent(cacheKey)}`

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light;
        --vscode-editor-background: #ffffff;
        --vscode-editor-foreground: #1f2328;
        --vscode-foreground: #1f2328;
        --vscode-sideBar-background: #f6f8fa;
        --vscode-sideBar-foreground: #57606a;
        --vscode-panel-border: #d0d7de;
        --vscode-textCodeBlock-background: #f6f8fa;
        --vscode-editor-selectionBackground: rgba(9, 105, 218, 0.24);
        --vscode-editorCursor-foreground: #0969da;
        --vscode-editorLineNumber-foreground: #8c959f;
        --vscode-editorWidget-background: #ffffff;
        --vscode-editorHoverWidget-background: #ffffff;
        --vscode-editorHoverWidget-foreground: #1f2328;
        --vscode-editor-findMatchBackground: rgba(255, 196, 0, 0.32);
        --vscode-editor-findMatchBorder: rgba(191, 135, 0, 0.55);
        --vscode-toolbar-hoverBackground: rgba(9, 105, 218, 0.1);
        --vscode-descriptionForeground: #6e7781;
        --vscode-focusBorder: rgba(9, 105, 218, 0.48);
        --vscode-input-background: #ffffff;
        --vscode-input-foreground: #1f2328;
        --vscode-button-border: rgba(31, 35, 40, 0.14);
        --vscode-button-secondaryBackground: #eef2f6;
        --vscode-button-secondaryHoverBackground: #e1e7ef;
        --vscode-list-hoverBackground: rgba(9, 105, 218, 0.08);
        --vscode-list-activeSelectionBackground: rgba(9, 105, 218, 0.12);
        --vscode-list-activeSelectionForeground: #0f172a;
        --vscode-scrollbarSlider-background: rgba(100, 110, 120, 0.28);
        --vscode-scrollbarSlider-hoverBackground: rgba(100, 110, 120, 0.42);
        --vscode-scrollbarSlider-activeBackground: rgba(100, 110, 120, 0.52);
        --vscode-errorForeground: #d1242f;
        --vscode-inputValidation-errorBackground: rgba(209, 36, 47, 0.12);
        --vscode-inputValidation-errorBorder: rgba(209, 36, 47, 0.48);
        --vscode-inputValidation-errorForeground: #b42318;
        --vscode-inputValidation-warningBackground: rgba(191, 135, 0, 0.12);
        --vscode-inputValidation-warningBorder: rgba(191, 135, 0, 0.4);
        --vscode-inputValidation-warningForeground: #8a4600;
        --vscode-inputValidation-infoBackground: rgba(9, 105, 218, 0.12);
        --vscode-inputValidation-infoBorder: rgba(9, 105, 218, 0.4);
        --vscode-inputValidation-infoForeground: #0757b8;
        --vscode-editor-font-family: "Georgia", "Times New Roman", serif;
        --vscode-font-family: "Georgia", "Times New Roman", serif;
        --vscode-editor-font-size: 15px;
        --vscode-editor-font-weight: 400;
      }

      :root[data-theme="dark"] {
        color-scheme: dark;
        --vscode-editor-background: #1b1f24;
        --vscode-editor-foreground: #e6edf3;
        --vscode-foreground: #e6edf3;
        --vscode-sideBar-background: #22272e;
        --vscode-sideBar-foreground: #9da7b3;
        --vscode-panel-border: #30363d;
        --vscode-textCodeBlock-background: #2d333b;
        --vscode-editor-selectionBackground: rgba(31, 111, 235, 0.36);
        --vscode-editorCursor-foreground: #58a6ff;
        --vscode-editorLineNumber-foreground: #6e7681;
        --vscode-editorWidget-background: #22272e;
        --vscode-editorHoverWidget-background: #22272e;
        --vscode-editorHoverWidget-foreground: #e6edf3;
        --vscode-editor-findMatchBackground: rgba(187, 128, 9, 0.34);
        --vscode-editor-findMatchBorder: rgba(242, 205, 82, 0.5);
        --vscode-toolbar-hoverBackground: rgba(88, 166, 255, 0.14);
        --vscode-descriptionForeground: #8b949e;
        --vscode-focusBorder: rgba(88, 166, 255, 0.5);
        --vscode-input-background: #1b1f24;
        --vscode-input-foreground: #e6edf3;
        --vscode-button-border: rgba(230, 237, 243, 0.12);
        --vscode-button-secondaryBackground: #30363d;
        --vscode-button-secondaryHoverBackground: #3b434c;
        --vscode-list-hoverBackground: rgba(88, 166, 255, 0.12);
        --vscode-list-activeSelectionBackground: rgba(88, 166, 255, 0.18);
        --vscode-list-activeSelectionForeground: #f0f6fc;
        --vscode-scrollbarSlider-background: rgba(110, 118, 129, 0.32);
        --vscode-scrollbarSlider-hoverBackground: rgba(110, 118, 129, 0.46);
        --vscode-scrollbarSlider-activeBackground: rgba(110, 118, 129, 0.58);
        --vscode-errorForeground: #ff7b72;
        --vscode-inputValidation-errorBackground: rgba(248, 81, 73, 0.14);
        --vscode-inputValidation-errorBorder: rgba(248, 81, 73, 0.4);
        --vscode-inputValidation-errorForeground: #ffb4ad;
        --vscode-inputValidation-warningBackground: rgba(187, 128, 9, 0.16);
        --vscode-inputValidation-warningBorder: rgba(210, 153, 34, 0.45);
        --vscode-inputValidation-warningForeground: #f2cc60;
        --vscode-inputValidation-infoBackground: rgba(31, 111, 235, 0.14);
        --vscode-inputValidation-infoBorder: rgba(88, 166, 255, 0.45);
        --vscode-inputValidation-infoForeground: #a5d6ff;
      }

      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        font-family: var(--vscode-editor-font-family);
        font-size: var(--vscode-editor-font-size);
      }

      body {
        caret-color: var(--vscode-editorCursor-foreground);
      }

      ::selection {
        background: var(--vscode-editor-selectionBackground);
      }

      #app {
        width: 100%;
        height: 100%;
      }
    </style>
    <link href="${staticPrefix}/webview/dist/katex/katex.min.css" rel="stylesheet" />
    <link href="${staticPrefix}/webview/dist/index.css" rel="stylesheet" />
  </head>
  <body data-meo-mermaid-src="${staticPrefix}/webview/dist/mermaid.min.js">
    <div id="app" class="editor-root"></div>
    <script>
      (() => {
        let state
        let isComposing = false
        const applyTheme = (nextTheme) => {
          if (nextTheme === 'light' || nextTheme === 'dark') {
            document.documentElement.dataset.theme = nextTheme
            return
          }

          delete document.documentElement.dataset.theme
        }

        const query = new URLSearchParams(window.location.search)
        const channelId = query.get('channel') || ''
        const parentOrigin = query.get('parentOrigin') || '*'
        applyTheme(query.get('theme'))

        const postMessageToParent = (message) => {
          window.parent.postMessage({
            __arynMeo: true,
            channel: channelId,
            payload: message,
          }, parentOrigin)
        }

        const updateCompositionState = (nextValue) => {
          if (isComposing === nextValue) {
            return
          }

          isComposing = nextValue
          postMessageToParent({
            isComposing: nextValue,
            type: 'compositionChanged',
          })
        }

        window.acquireVsCodeApi = function acquireVsCodeApi() {
          return {
            postMessage(message) {
              postMessageToParent(message)
            },
            getState() {
              return state
            },
            setState(nextState) {
              state = nextState
              return nextState
            },
          }
        }

        window.addEventListener('message', (event) => {
          if (event.source !== window.parent) {
            return
          }

          const payload = event.data
          if (!payload || typeof payload !== 'object') {
            return
          }

          if (parentOrigin !== '*' && event.origin !== parentOrigin) {
            return
          }

          if (channelId && payload.__arynMeoChannel !== channelId) {
            return
          }

          if (payload.type === 'themeChanged') {
            applyTheme(payload.themeKind)
          }
        })

        document.addEventListener('compositionstart', () => {
          updateCompositionState(true)
        }, true)

        document.addEventListener('compositionend', () => {
          updateCompositionState(false)
        }, true)

        window.addEventListener('blur', () => {
          updateCompositionState(false)
        })

        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState !== 'visible') {
            updateCompositionState(false)
          }
        })

        window.addEventListener('beforeunload', () => {
          updateCompositionState(false)
        })
      })()
    </script>
    <script type="module" src="${staticPrefix}/webview/dist/index.js"></script>
  </body>
</html>`
}
