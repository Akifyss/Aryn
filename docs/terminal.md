# 工作区终端

左右面板的“＋”菜单和空面板开始页均可创建终端。每次创建分配独立 tab，默认工作目录由当前项目确定。支持移动、排序、多个终端、查找、复制粘贴、命令中断和手动重启。

## 归属与生命周期

- Workbench 的 `terminal` tab 保存 `id`、`projectId`、`title`；继续使用 `layout.projectWorkspaces.layouts[projectId]`。不会把 PID、命令文本、环境变量或终端输出写入布局。
- `TerminalManager` 独占 PTY 和有界的 headless xterm 屏幕。每次 shell 启动都有新的 `generation`，防止旧视图的输入、resize、ACK 作用于替代进程；每个 renderer 控制器另有 `viewId`，识别当前附着客户端，旧视图的 ACK/detach 不影响新视图。
- `WorkbenchTerminalLayer` 在第一次访问 tab 时加载终端视图。移动面板和切换项目保留同一个 React/DOM 实例；后台 tab 不抢焦点，不按隐藏容器的零尺寸调整 PTY。
- Renderer reload、crash 或视图 detach 只解除客户端附着。主进程中的 shell 和 headless 屏幕继续有界运行，重连时以稳定 tab ID 恢复。窗口销毁或应用完整退出会结束会话；下次启动只恢复 tab，第一次访问时在项目目录启动新 shell，不自动重放命令。
- 关闭/重启先检查实际活动：空闲或已退出的终端直接处理；仍有命令或子进程时确认；无法可靠判断时说明原因并保留取消入口。检查和确认均绑定当时的 generation，重复点击共用同一检查/确认；等待期间发生会话替换时不会关闭新进程。
- 关闭与重启是不同意图，不能共用同一次确认结果；一个操作等待期间，另一个操作不会并发执行，防止重新创建已移除标签的会话。
- 确认复用应用全局的 `AppConfirmDialog`，继承主题、焦点约束、取消按钮及 Esc 行为。主进程通过一次性请求 ID 向当前窗口发起确认，回复仅接受同一主 frame、请求 ID 和布尔选择；最终操作仍校验窗口与 generation。renderer 刷新、崩溃或销毁会取消旧请求，不影响重新连接后的请求。其他应用确认替换当前弹窗时，按现有全局确认机制取消旧操作。
- 关闭结果按项目和终端 ID 更新标签所属布局：即使等待期间移动到另一面板或切换项目，也会从实际所属布局移除标签，避免留下已结束的标签。失败时保留标签并显示错误。
- 创建请求先在主进程登记，再异步验证项目和查找 shell。关闭、删除项目、窗口销毁和应用退出均能取消尚未完成的创建。
- shell 自行退出后保留最后输出与退出码，直到用户关闭或重启。

## 进程与传输

`renderer → preload 中的 TerminalApi → register-terminal-ipc → TerminalManager → node-pty`

Windows 优先使用 PATH 或标准安装位置中的 PowerShell 7，再使用系统 Windows PowerShell；POSIX 使用用户默认登录 shell。主进程根据已登记项目解析 cwd，不接受 renderer 提交任意 cwd、启动脚本或环境变量。子进程不继承 Electron、应用调试、Node IPC 和自动执行 shell 配置变量。

IPC 只接受当前主窗口的主 frame。每次数据操作核对窗口归属和 generation。输入单帧上限 65,536 个 UTF-16 代码单元，尺寸范围为 2–500 列、1–300 行，最多 24 个会话。大量粘贴在 renderer 分帧并按序发送，避免输入交错或切断 Unicode 代理对。

PTY 输出按短时间窗口合并，送入有界 headless xterm 后再按 sequence 推送。输出本身不进入 React/Zustand。待解析输出始终参与背压；仅附着客户端累积未确认输出，并在 renderer 解析后 ACK。超过高水位时暂停 PTY 读取，降至低水位再恢复。detach 清除客户端 ACK 欠账，离线时继续解析但不发送输出事件，避免等待已消失的视图而永久暂停。正常关闭等待中的 snapshot 通过会话关闭信号结束，不留下悬空 IPC Promise。

异步输出队列中的 resize 和协议回复单独处理原生 I/O 异常。ConPTY 可能在发送 onExit 前已拒绝操作，此类异常会作为终端错误上报，不会逃逸到主进程的全局异常处理而退出应用。

resize 与输出共用有序队列和 sequence：先解析旧尺寸下的输出，再调整主屏幕、通知视图和调整 PTY；renderer 也等待前序写入完成后改变网格。Windows 将同一 `windowsPty` ConPTY 后端与系统 build number 传给主、从 xterm，保持重排兼容行为一致。

### 关闭与重启的活动判断

`TerminalManager.inspectClose` 组合两个独立证据，不能用会话的 `running` 状态代替任务活动：

- `TerminalShellActivity` 消费会话专属 OSC 633 活动标记，主进程 headless parser 处理完整序列。PowerShell 在 `PSConsoleHostReadLine` 开始等待输入及返回命令时报告状态；zsh 通过 `preexec` 和 ZLE 的输入开始/结束 hook 报告状态，只有非子 shell 的 ZLE `CONTEXT=start` 才标为空闲，排除 `vared`、`select` 和续行输入。它们既能区分空闲提示符，也能识别 `Start-Sleep`、循环等没有子进程的前台工作。输入 Enter 时立即作废上一次空闲状态，防止命令开始标记尚未到达时误关。
- `terminal-processes.ts` 仅在关闭/重启时异步读取进程表。Windows 使用系统 PowerShell 的 CIM，macOS/Linux 使用 `ps`；沿父子关系检查所有后代，包括后台进程和嵌套 shell。Windows 控制台辅助进程不作为用户任务，仍继续检查它们的后代；已复用父 PID 的旧进程及 POSIX 僵尸不会误报。只采集 PID、父 PID、进程名和 Windows 创建时间，不读取命令参数、环境或任务内容。

只有命令状态明确空闲、没有子进程且扫描期间状态未变化，才跳过确认。单次 OS 查询最多 2.5 秒；输入或命令边界变化后最多重新检查一次，失败、权限不足或超时均视为未知。关闭窗口会取消检查；shell 在检查中退出则直接允许关闭。已识别的任务显示进程名，未知状态不会声称任务仍在运行；关闭与重新启动使用对应文案，默认按钮和 Escape 均取消。

PowerShell 集成仅安装在当前会话内，不修改 profile、提示符或按键映射，不绕过执行策略，不记录命令文本。嵌套调试提示符和提示符处尚未结束的 PowerShell 作业（包括没有子 PID 的 ThreadJob）不会被标为空闲；作业结束状态在下一次进入提示符时刷新，期间保守确认。受限语言模式、未加载/被替换的 PSReadLine、尚未就绪的 shell，以及目前未安装命令边界集成的 bash/fish 等 shell 都采用未知状态保护；不能通过屏幕上的提示符文本猜测空闲。任意用户代码自行创建的非 PowerShell 作业线程或远程任务不在本地进程检测的保证范围内。

zsh 集成仅通过会话独立的临时 `.zshenv` 进入，立即还原用户的 `ZDOTDIR` 并在顶层加载用户 `.zshenv`；其余系统和用户启动文件及 `.zlogout` 均由 zsh 自行加载，避免 macOS `/etc/zshrc` 将历史文件或按键配置路径指向临时目录。活动 hook 延迟到首次提示符初始化，通过标准 helper 保留用户现有函数和 ZLE widget，函数内部采用局部 zsh 模式以隔离用户选项；不改写用户文件、提示符或历史记录，也不向子 shell 导出集成参数。脚本随 main bundle 以文本打包，再写入权限受限的临时文件，避免 zsh 读取 ASAR 路径。关闭、取消创建及启动失败均清理临时文件。显式 `-f`、用户禁用 RCS/ZLE、用户替换 hook 数组导致集成未安装或准备失败时保留原 shell 行为和未知状态保护，不强制开启集成，也不阻止终端启动。

## 屏幕恢复与界面

主进程最多保留 5,000 行回滚记录。重新连接返回经 SerializeAddon 序列化的屏幕、原始列行数与 sequence；renderer 先订阅事件，在原尺寸恢复屏幕，丢弃快照已包含的事件，再调整到当前面板尺寸。标准终端协议查询统一由主进程 headless 解析器回复；renderer 屏蔽对应自动回复，回放期间也不向 shell 发送数据，避免实时重复回复和历史设备查询污染输入。

界面延续既有双栏工作台：通过顶栏“＋”菜单创建普通 tab，复用现有移动、排序和关闭行为。终端工具栏仅显示 shell、状态、cwd 与复制、粘贴、查找、重启操作，沿用应用按钮和 Mingcute 图标；浅色/深色跟随应用 token，终端正文使用 13px 等宽字体。启动、运行、退出码、错误与重试均在终端内呈现。

终端采用 xterm.js 的输入、选择、ANSI 解析和 TUI 鼠标协议。Base UI Scroll Area 通过公开的行滚动 API 驱动滚动条，不访问 xterm 私有 `_core`；屏幕阅读器模式按 Electron 检测状态启用。可见状态与焦点意图分别传入控制器，异步连接完成时仅在仍可见且被指定为焦点面板时聚焦；后台加载或另一面板的终端不抢输入焦点。

快捷键：Ctrl+F 查找；Ctrl+Shift+C 复制选择；Ctrl+Shift+V 粘贴；Ctrl+C 无选择时发送中断，有选择时复制。Workbench 的 Ctrl/Cmd+W、Ctrl+Tab、Ctrl+PageUp/PageDown 保留；其他终端输入组合键不冒泡到全局快捷键。链接仅支持 Ctrl/Cmd+点击打开 HTTP(S)，输出不能自行调用外部应用。

## 原生依赖与验证

依赖版本固定。Windows 使用 node-pty 自带的 ConPTY 运行库；`electron-builder.json` 显式解包 node-pty，保证 `.node`、ConPTY DLL 和辅助程序可访问。原生依赖必须分别验证开发运行和目标平台打包产物，普通浏览器预览不提供本地终端。

macOS 还要求 `spawn-helper` 具有执行权限。已核验 `node-pty@1.1.0` 的 npm 原始发布包：`prebuilds/darwin-arm64/spawn-helper` 和 `prebuilds/darwin-x64/spawn-helper` 均为 `0644`。此版本的安装脚本检测到 prebuild 后直接跳过编译，也不恢复执行位；原生模块可以正常加载，但首次创建 PTY 时 macOS 执行 helper 失败，抛出不含 errno 的 `posix_spawnp failed`。这与 shell 是否存在、xterm 是否渲染成功是不同的检查。

`scripts/prepare-terminal-runtime.cjs` 在 `postinstall` 和 `predev` 准备当前架构的 helper，兼顾 `build/Release`、`build/Debug` 和预编译目录。`after-pack-terminal.cjs` 在 Electron 打包复制/解包之后、签名之前处理实际 `.app` 中的文件；缺失或不可执行时令构建失败。修复只添加执行位，不改二进制内容，不在运行期间修改已签名应用，不通过更换 shell 或重复 spawn 掩盖失败。现有源码环境更新后运行 `npm run dev` 即会执行准备；单独修复依赖可运行 `npm run prepare:terminal`。

`npm run check:terminal-runtime` 用 Electron 运行真实 PTY，检查输出与退出码，并在 macOS 输出实际 helper 路径和权限；它不负责修复权限。`npm run test:terminal-runtime` 验证准备及打包钩子，在 POSIX 文件系统上实测 `0644 → EACCES → 0755 → 可执行`。`test/terminal-native-spawn.spec.ts` 另外通过实际 `TerminalManager` 验证解析出的 shell、中文输出、cwd、resize 与退出。`.github/workflows/terminal-native.yml` 为 macOS arm64 和 Intel 配置上述检查，以及开发版/打包版 Electron 终端场景；Unix 场景独立于原先仅适用于 PowerShell 的断言。

```powershell
npx vitest run test/terminal-manager.spec.ts test/terminal-ipc.spec.ts test/workbench-terminal.spec.ts
npx vitest run test/terminal-processes.spec.ts test/terminal-native-close.spec.ts
npx vitest run test/terminal-zsh-integration.spec.ts test/terminal-native-zsh.spec.ts
npx vitest run test/terminal-controller-browser.spec.ts
npm run typecheck
npx vite build --mode=test
$env:ARYN_ELECTRON_DEBUG_SCENARIO='terminal'
npm run debug:electron

npx electron-builder --win --dir --config.directories.output=tmp/terminal-package
$env:ARYN_ELECTRON_DEBUG_EXECUTABLE=(Resolve-Path 'tmp/terminal-package/win-unpacked/Aryn.exe').Path
$env:ARYN_ELECTRON_DEBUG_ARTIFACT_ROOT='tmp/electron-terminal-packaged'
npm run debug:electron
Remove-Item Env:ARYN_ELECTRON_DEBUG_EXECUTABLE, Env:ARYN_ELECTRON_DEBUG_ARTIFACT_ROOT, Env:ARYN_ELECTRON_DEBUG_SCENARIO
```

浏览器测试在 Chromium 中运行真实 xterm 控制器，以模拟 IPC 检查重连、协议回复、输入与网格顺序及焦点。Electron 场景使用调试流程的隔离项目/profile；检查真实 PowerShell、cwd、中文输入、复制粘贴、查找、tab 移动、多终端、回滚、resize、主题、renderer 重连、项目切换、后台 100,000 行输出、Ctrl+C、关闭取消与 shell/child 回收，以及退出码和重启。调试脚本操作隔离窗口中的真实应用内确认框，检查取消默认焦点、Esc、关闭按钮、确认及主题；若终端退回原生确认框则明确失败，不操作日常窗口。首次缺少构建依赖产物时，使用 `npm run debug:electron:build`；完整调试说明见 [electron-debug-workflow.md](electron-debug-workflow.md)。

关闭策略另有真实 Windows PTY 测试，覆盖 PowerShell 7/Windows PowerShell 的空闲、内部 cmdlet、后台作业、ThreadJob（PowerShell 7）与退出；单元测试覆盖异步标记分片、进程扫描失败、重复关闭、窗口销毁、generation 替换、检查期间输入及任务结束等情况。Electron 场景同时断言空闲关闭和已退出重启没有确认、内部 cmdlet 和前台程序关闭需要确认。

review 回归还覆盖检查期间前台程序已结束时丢弃旧的 busy 快照、延迟关闭跨面板/项目完成后的布局清理，以及普通链接和 OSC 8 超链接共用 Ctrl/Cmd+点击规则（避免触发 xterm 默认弹窗）。

2026-09-13 验证：27 项终端测试、56 项 Workbench 回归、类型检查、Vite 构建和 Windows unpacked 打包通过；Windows 开发构建的 18 项 Electron 检查及 unpacked 产物的 20 项检查均通过，后者包含新增退出码与重启检查。报告分别位于 `tmp/electron-debug-session/` 和 `tmp/electron-terminal-packaged/`。macOS、Linux 与 Windows NSIS 安装流程尚未实测。

2026-09-13 关闭策略更新：相关 48 项测试（manager 25、IPC 11、进程表 5、Workbench terminal 5、真实 PTY 1、浏览器 controller 1）、完整 `npm run typecheck`、Vite test 构建及隔离 Electron 的 22 项场景检查通过。Electron 报告位于 `tmp/electron-terminal-close/electron-debug-session-report.json`，renderer 错误和请求失败均为零。本次未重新生成安装包；macOS/Linux 进程表有单元覆盖，未做原生实测，非 PowerShell 的命令边界集成尚未实现，关闭时保守确认。

2026-09-14 review 验证：18 个测试文件的 130 项相关回归通过；随后补充关闭/重启冲突和异步原生 I/O 异常回归，最终 manager、IPC 和浏览器 controller 共 42 项测试通过（两轮合计覆盖 134 个不同测试）。最终代码的完整 `npm run typecheck`、Vite test 构建和 Windows unpacked 打包均通过。开发构建与 unpacked 产物各通过 23 项真实 Electron 场景，包括延迟确认期间移动标签、切换项目后的清理；两者 renderer 错误和请求失败均为零。报告分别位于 `tmp/electron-terminal-review/electron-debug-session-report.json` 与 `tmp/electron-terminal-review-packaged/electron-debug-session-report.json`。浅色/深色截图已检查；macOS、Linux 与 Windows NSIS 安装流程仍未实测。

2026-09-14 macOS 启动修复：WSL 原生 POSIX 文件权限测试 6 项通过；从 npm 原始 tarball 提取的 arm64/x64 helper 实测由 `0644` 变为 `0755`，字节内容不变。Windows 终端相关 43 项测试、Electron 原生 PTY 启动检查、完整类型检查和 Windows unpacked 打包回归通过。本次未修改终端业务逻辑或界面，打包回归使用现有构建产物。macOS 双架构 CI 与 Unix Electron 场景已加入，当前 Windows/WSL 工作环境不能执行 macOS 二进制，因此尚无本次修复的 macOS 实机或 CI 通过结果，不能将 POSIX 权限检查视为 macOS 启动验收。

2026-09-14 首次 macOS CI：[arm64 job](https://github.com/Akifyss/Aryn/actions/runs/34853421703/job/104006789516) 和 [Intel job](https://github.com/Akifyss/Aryn/actions/runs/34853421703/job/104006789188) 均通过 6 项权限/打包准备测试、Electron 42.2.0 原生 PTY 启动检查和 `TerminalManager` 原生测试，日志确认 helper 权限为 `755`。两者随后在完整应用的 Vite 构建阶段达到约 2048 MiB 堆上限，报 `JavaScript heap out of memory` 并以 134 退出；完整界面及打包验证因此未执行。workflow 为构建步骤单独设置 `NODE_OPTIONS=--max-old-space-size=4096`，不传给后续 Electron 检查；构建日志保存为 `tmp/terminal-ci-build.log` 并上传，Bash pipefail 保留原始失败结果。修复后的完整 macOS CI 仍需在新提交上验证，重跑旧提交不会使用新配置。

本地对照验证（Windows / Node 24.16.0）：限制为 2048 MiB 时复现相同堆溢出和退出码 134；设置 4096 MiB 后完整 `npm run pretest` 通过，包括 bb surface、renderer、main 和 preload 构建。另验证 workflow YAML、内存设置只作用于构建步骤，以及日志管道保留失败退出码；本地日志位于 `tmp/terminal-ci-failure/repro-2gb.log` 和 `tmp/terminal-ci-failure/verify-4gb.log`。

2026-09-14 第二次 macOS CI：[运行 34855686574](https://github.com/Akifyss/Aryn/actions/runs/34855686574) 的 arm64/Intel 原生检查和完整应用构建均通过，确认构建堆预算修复有效。开发版场景随后在打开终端之前因 `assert(project)` 失败：脚本读取了 `ProjectState` 中不存在的 `activeProjectId`，实际字段为 `lastProjectId`；Windows 场景用首个项目兜底，掩盖了相同错误。两个场景现均按 `lastProjectId` 查找，找不到时明确失败，不任意选择其他项目。修复前后执行实际场景的项目查询回调，覆盖单项目、选中非首个项目、失效 ID 和未选择项目，共 8 项检查；修复后全部通过。Windows 隔离 Electron 完整终端回归通过，renderer 错误及请求失败均为零，报告位于 `tmp/terminal-ci-project-fix/electron-debug-session-report.json`。本次仅修改测试脚本；macOS 完整界面及打包验证仍需新提交的 CI 结果。

2026-09-15 zsh 空闲关闭修复：此前 zsh 没有活动 hook，`inspectClose` 即使看到无子进程也会返回 `unknown`，因此空闲提示符总是弹确认。旧版本在真实 zsh 中复现此结果；补充集成后，WSL/zsh 的 5 项原生场景和 4 项准备/清理测试通过，覆盖空闲、内置循环、前后台进程、嵌套 shell/`vared`、Ctrl+C、启动文件顺序、ZDOTDIR 与导出属性、原有 hook/widget、历史和退出状态。Windows 51 项相关测试、完整类型检查、Vite test 构建和 23 项隔离 Electron 场景通过，renderer 错误及请求失败均为零（`tmp/terminal-zsh-windows-regression/electron-debug-session-report.json`）。macOS CI 增加 zsh 原生测试，并将开发版/打包版场景扩展到运行中取消关闭、空闲重启和空闲关闭；本次 macOS 双架构运行尚待推送后验证，上一轮启动验证不能代替这次关闭行为验证。

2026-09-16 应用内确认框更新：关闭/重启使用全局 `AppConfirmDialog`，主进程保留活动检查、窗口归属、generation 与重复操作保护，并在 renderer 刷新/崩溃/销毁时取消等待。63 项相关测试、完整类型检查和 Vite test 构建通过；Windows 隔离 Electron 的 26 项检查通过，覆盖浅深色确认框、默认取消焦点、Esc、右上角关闭、取消后继续运行、确认后进程回收，以及空闲关闭。报告位于 `tmp/terminal-app-confirmation/electron-debug-session-report.json`，renderer 错误和请求失败均为零。macOS 场景已切换为操作真实应用内弹窗，本次未执行 macOS 实机或打包验证。

2026-09-16 合并 review：Windows 9 个测试文件、73 项回归及完整类型检查通过；WSL/zsh 15 项检查通过，macOS 专属历史检查跳过。新增用例覆盖用户 line-init 回调失败时保留确认，以及后续注册 ZLE hook 时不递归、不重复、不改变用户选项。用户 hook 链失效时仍可能持续确认，不能据此宣称所有自定义 zsh 环境均可免确认关闭。CI 补全终端前端、preload 和共享确认组件的触发路径，并加入 manager／IPC／进程表回归（同一命令在 WSL 通过 52 项）。本轮未再改变已通过上述构建和 26 项 Windows Electron 检查的应用实现；macOS 新代码的开发版与打包版验证仍待 CI 执行。

2026-09-16 macOS CI 与清理修复：[运行 34995247014](https://github.com/Akifyss/Aryn/actions/runs/34995247014) 的 Intel job 全部通过，包括 zsh 原生检查和开发版／打包版 Electron 场景；arm64 的原生启动及活动判断检查通过，但 zsh 测试清理临时 `startup` 目录时出现 `ENOTEMPTY`，其余 16 项通过，后续构建和界面验证跳过。测试夹具在 `manager.dispose()` 发出终止信号后立即删除 HOME/ZDOTDIR，没有等待进程退出，可能与 shell 的退出写入竞争。现通过独立的原生 PTY `onExit` 观察器确认退出后再删除目录，等待超时或删除失败仍令测试失败。新增延迟退出写入回归在旧清理顺序下失败，修复后 WSL 的 CI 原生测试命令通过 17 项（macOS 专属历史检查跳过），针对清理及原失败用例重复三轮均通过，Windows manager／准备与清理回归 32 项通过。本次只修改测试及记录；修复后的 macOS CI 尚待运行。

## 参考实现

四个指定项目的固定版本源码核对、取舍及本次采纳项见 [终端参考实现核对](terminal-reference-review.md)。

- [Orca](https://github.com/stablyai/orca/blob/main/package.json)：Electron / node-pty / xterm 的分层组合。
- [Monocode](https://github.com/hardbeat920/monocode/blob/main/src/lib/terminalTab.ts)：终端 tab 身份和元数据。
- [OpenChamber](https://github.com/openchamber/openchamber/blob/main/packages/web/server/lib/terminal/DOCUMENTATION.md)：创建取消、会话归属和快照/实时输出边界。
- [T3 Code](https://github.com/pingdotgg/t3code/blob/main/docs/internals/terminal-runtime.md)：进程与客户端分离、有界历史和禁止历史查询回复。
- [xterm.js flow control](https://xtermjs.org/docs/guides/flowcontrol/) 与 [node-pty](https://github.com/microsoft/node-pty)：终端解析确认与平台 PTY API。
- [VS Code PowerShell shell integration](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/common/scripts/shellIntegration.ps1)：交互读取函数中的命令边界；本项目只使用会话活动标记，不报告命令内容。
- [zsh startup files](https://zsh.sourceforge.io/Doc/Release/Files.html) 与 [zsh hooks](https://zsh.sourceforge.io/Doc/Release/Functions.html#Hook-Functions)：启动文件顺序及可组合的命令 hook；另核对 [VS Code zsh 环境转交](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/common/scripts/shellIntegration-env.zsh) 的 `ZDOTDIR` 处理。
- [node-pty #858](https://github.com/microsoft/node-pty/pull/858) 与 [T3 Code #4924](https://github.com/pingdotgg/t3code/issues/4924)：macOS 预编译 spawn-helper 执行权限缺失的上游修复和同类报告；本项目已独立核验固定版本的发布包。

本实现借鉴边界设计，未引入参考项目的远程连接、独立守护进程或代理终端协议。
