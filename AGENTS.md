# 项目 Agent 指南

## 产品概述

本项目是一个用于长篇草拟、改写、续写和辅助创作的 AI 写作 Agent 桌面应用程序，运行在本地桌面工作区。

产品方向如下：

- 打开本地文件夹作为活动工作区，类似于 Obsidian 或 VS Code
- 将“工作区”作为核心模型，而不仅仅是文件选择器
- 将本地优先的文件访问和外部文件更改检测作为一等公民能力
- 为选定的 Git 工作流提供 GUI，而不是仅限终端使用

## 当前范围

目前的最小可行范围包括：

- 打开和切换本地工作区文件夹
- 渲染文件树
- 打开、编辑和保存支持的文本文件
- 提供左侧导航区、中央写作/编辑器区和右侧 AI 对话面板
- 保存并恢复本地工作区状态
- 展示基础的 Agent 任务状态反馈

## 技术路线

- Electron 作为桌面容器
- React + TypeScript 作为渲染层技术栈
- `vite` / `electron-vite` 作为构建工具链
- PI Agent 是目前的 AI 后端集成路径
- Tailwind CSS 负责样式
- Tiptap 是富文本编辑器
- Zustand 管理渲染器状态
- 允许使用 HeroUI 以实现快速的早期交付
- 核心业务 UI 应逐步转向基于 Base UI 构建的自定义组件
- 使用 mingcute 、 iconify 来引入界面中需要的图标。
- 使用 [pierrejs](https://pierrejs-docs.vercel.app/) 来实现 diff 渲染

## 架构指导

### 进程边界

- `main` 进程负责文件系统访问、窗口管理、Agent 编排和特权本地集成
- `preload` 脚本仅通过 `contextBridge` 和 IPC 暴露受控 API
- `renderer` 进程负责编辑器 UX、会话 UI、写作工作流和交互设计
- 保持对齐 `main / preload / renderer / shared` 的分层结构

### 数据策略

- 第一阶段保持本地文件系统优先
- 仅在工作区元数据、会话历史、提示词模板或用户设置超出扁平文件承载能力时，才引入 `better-sqlite3`
- 优先保存结构化的编辑器内容以及所需的导出格式

## 参考产品

- [scratch](https://github.com/erictli/scratch): 极简、离线优先的桌面 Markdown 笔记，具有强大的本地文件人体工程学
- [1code](https://github.com/21st-dev/1code): 多 Agent 视觉编排和 Git 工作树隔离理念
- [openchamber](https://github.com/openchamber/openchamber): 具有分支时间线和深度 Git 集成的桌面 AI Agent UI
- [craft-agents-oss](https://github.com/lukilabs/craft-agents-oss): 基于 Pi SDK 模式构建的 Agent 原生架构
- [obsidian git](https://github.com/Vinzent03/obsidian-git) obsidian 的 git 集成插件
- 
