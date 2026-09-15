# 终端参考实现核对

2026-09-15 核对四个项目当时默认分支的源码及相关测试。以下描述对应固定提交和具体关闭入口，不代表已在本机运行这些产品，也不把开发分支等同于用户安装的发布版。

| 项目 | 核对提交 | 手动关闭终端标签的策略 |
| --- | --- | --- |
| OpenChamber | `ac5005ddf214fac60117aef58bc79458e59e78b0` | 标签入口直接调用关闭会话 API，成功后删除标签；未经过忙碌确认。 |
| Orca | `caa465d1da886b2697c85c18bf36f79f2d3b9e68` | 用户关闭入口按需探测运行任务；支持确认去重、排队和用户关闭确认的设置。超时与已返回的未知结果有不同策略。 |
| MonoCode | `7522b37bd15309bf4827bf12716d6cc7382c6c5e` | 获取前台进程标签，检测到非 shell 进程才确认；批量关闭列出相关终端和进程。 |
| T3 Code | `ae53072af0560c0606202b87b5fdb7e52d48ac5c` | 单独手动关闭入口统一确认，不依据空闲状态；自动退出清理、批量关闭使用不同路径。 |

## 值得直接采纳：Orca 的 zsh 启动边界

[Orca 的启动器](https://github.com/stablyai/orca/blob/caa465d1da886b2697c85c18bf36f79f2d3b9e68/src/main/zsh-startup-wrapper-builder.ts) 仅生成 `.zshenv` 入口，立即归还用户的 `ZDOTDIR`，其余启动文件由 zsh 正常加载，初始化延迟到首次 `precmd`。其注释明确记录了旧四文件转交方案造成的历史路径、shell 模式和配置兼容问题；[真实 shell 等价性测试](https://github.com/stablyai/orca/blob/caa465d1da886b2697c85c18bf36f79f2d3b9e68/src/main/zsh-startup-hook-user-config-equivalence.live-shell.test.ts) 将包装后的用户配置结果与普通 zsh 对照。

Aryn 上一版也使用四文件转交，虽然每次加载用户文件前恢复目录，但执行系统启动文件时目录仍指向临时位置。[Apple 的系统 zshrc](https://github.com/apple-oss-distributions/zsh/blob/main/zshrc) 会以 `ZDOTDIR` 推导默认历史文件和按键配置路径。仅验证用户自己设置的 `HISTFILE` 掩盖了这个差异。

本次已采纳单入口、立即还原目录、首次提示符安装 hook 的结构，删除四文件转交及目录状态跟踪。保留 Aryn 的会话标记、标准 ZLE hook 组合和进程探测，不引入 Orca 的代理启动、远程传输及功能开关框架。

新增检查在实际生成的 `.zshenv` 执行完毕、系统配置即将执行的边界套用 Apple 的历史路径规则，旧版确实得到临时目录，新版得到用户目录，同时保持用户设置的非导出属性。另增加 macOS 原生默认历史路径检查、后续 prompt hook 与用户选项兼容、`emulate sh` 下与无包装 shell 的配置结果对照。

复查延迟初始化时补充了用户 `precmd` hook 自己调用 `vared` 的场景。使用 [zsh 的 ZLE CONTEXT](https://zsh.sourceforge.io/Doc/Release/Zsh-Line-Editor.html) 区分普通命令行与嵌套读取，替代额外的“到达提示符”状态变量，避免初始化顺序变化造成误判。标准 ZLE hook 链若被用户配置替换或因更早的 hook 失败而中断，仍可能无法得到空闲信号；当前保留确认，不强行覆盖用户 widget。2026-09-16 review 增加真实 zsh 回归，验证失败回调不会导致误判空闲，以及首次提示符后继续注册 hook 不会重复、递归或改变用户选项。

## 关闭判断：借鉴机制，保留适合 Aryn 的策略

- [MonoCode 关闭入口](https://github.com/hardbeat920/monocode/blob/7522b37bd15309bf4827bf12716d6cc7382c6c5e/src/lib/terminalClose.ts) 和 [Unix PTY 实现](https://github.com/hardbeat920/monocode/blob/7522b37bd15309bf4827bf12716d6cc7382c6c5e/src-tauri/src/pty.rs)：通过终端前台进程组和进程名给出具体提示，避免只因 shell 活着就打扰用户。这个体验值得保留；但仅看前台进程会漏掉后台任务和 shell 自身执行的内置循环。它将状态读取异常当作无须确认的路径，也不适合直接替代 Aryn 的未知状态保护。
- [Orca 探测器](https://github.com/stablyai/orca/blob/caa465d1da886b2697c85c18bf36f79f2d3b9e68/src/renderer/src/components/terminal/pty-running-work-probe.ts) 区分有任务、未观察到任务、无法验证，并在破坏性操作前按需探测；[关闭策略](https://github.com/stablyai/orca/blob/caa465d1da886b2697c85c18bf36f79f2d3b9e68/src/renderer/src/components/terminal/running-terminal-close-guard.ts) 对 4 秒未回答的探测弹窗，但对已回答的未知结果允许关闭。Aryn 借鉴测量与策略分层，继续让所有未知结果进入确认，避免因探测故障中断任务。
- [Orca 确认队列](https://github.com/stablyai/orca/blob/caa465d1da886b2697c85c18bf36f79f2d3b9e68/src/renderer/src/store/running-terminal-close-confirm.ts) 合并重复关闭、保留不同标签的待处理请求，并防止连按误确认下一个标签。Aryn 当前已按 owner、终端 ID 合并重复请求，并隔离关闭与重启、校验会话 generation；无需为本次单标签问题引入完整全局队列。
- [T3 Code 确认入口](https://github.com/pingdotgg/t3code/blob/ae53072af0560c0606202b87b5fdb7e52d48ac5c/apps/web/src/lib/terminalCloseConfirm.ts) 及 [调用处](https://github.com/pingdotgg/t3code/blob/ae53072af0560c0606202b87b5fdb7e52d48ac5c/apps/web/src/components/ThreadTerminalDrawer.tsx) 统一手动关闭确认，优点是各入口一致；但其策略不能解决本次“空闲 zsh 总弹窗”的需求。

Aryn 保留的行为：确认空闲或已退出时直接关闭；前后台任务、shell 内置命令或嵌套交互仍在执行时确认；无法可靠判断时说明未知并确认。不能用提示符文字、终端无输出、仅有 shell 进程等现象单独证明空闲。

## 生命周期和 macOS 启动：保留已有边界，明确后续价值

[OpenChamber 标签关闭](https://github.com/openchamber/openchamber/blob/ac5005ddf214fac60117aef58bc79458e59e78b0/packages/ui/src/components/views/TerminalView.tsx) 直接销毁会话；[服务端](https://github.com/openchamber/openchamber/blob/ac5005ddf214fac60117aef58bc79458e59e78b0/packages/web/server/lib/terminal/runtime.js) 将客户端 detach 与结束进程分开，终止时先发信号、监听退出并在超时后强制结束。Aryn 已区分 detach 与 close，切换标签/移动面板不会结束 shell。对于忽略退出信号的进程，受控终止和退出确认值得单独补充针对性验证；本次不扩张进程终止实现。

[T3 Code 的 node-pty 适配器](https://github.com/pingdotgg/t3code/blob/ae53072af0560c0606202b87b5fdb7e52d48ac5c/apps/server/src/terminal/NodePtyAdapter.ts) 实际检查并尝试修复 `spawn-helper` 的执行权限，而不是假设依赖安装成功即可启动终端。这与 Aryn 此前 macOS `posix_spawnp failed` 的排查直接相关。Aryn 已在依赖准备和打包后、签名前修复权限，并验证实际 Electron PTY；继续采用这个适合当前打包方式的边界，无需复制运行时修改资源的方式。

[T3 Code 的输出设计](https://github.com/pingdotgg/t3code/blob/ae53072af0560c0606202b87b5fdb7e52d48ac5c/docs/internals/terminal-runtime.md) 包括服务端持有会话、有界历史、增量输出以及历史回放不向当前 shell 回答终端查询。这些原则 Aryn 已有对应处理；本次不切换终端渲染器、不新增远程守护进程。

## 本次验证范围

- 修改前在真实 WSL/zsh 中复现系统配置边界的错误历史路径。
- 修改后 WSL/zsh 活动、配置和生命周期相关检查 13 项通过；macOS 默认历史检查在 WSL 跳过，已纳入现有双架构 CI 执行的测试文件。
- Windows 50 项 manager、IPC、进程与准备/清理测试通过；完整类型检查和最终 Vite test 构建通过。
- 尚未执行本次新代码的 macOS CI，不将 WSL 通过等同于 macOS 开发版或打包版验收。

2026-09-16 最终 review：Windows 73 项相关回归、WSL/zsh 15 项检查和完整类型检查通过；macOS 专属历史测试在 WSL 跳过。CI 补充终端前端、preload、应用确认组件的触发路径，并执行 manager／IPC／进程表测试；新增的 CI 测试命令在 WSL 验证 52 项通过。应用实现与此前通过构建及 26 项 Windows Electron 检查的版本一致，本轮新增范围为回归测试、CI 覆盖及验证记录。
