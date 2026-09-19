<div align="center">

<img src="assets/logo.svg" width="96" alt="CutForge logo" />

# CutForge(工作代号)

**Agent 优先的开源 AI 视频编辑器 —— 社区版**

用对话驱动剪辑:你描述想法,AI 直接在真实的多轨时间线上完成添加、切割、
排列,每一步都可撤销、可继续手工调整。CutForge 不是"生成一段不可修改的
视频",而是维护一个真正可编辑的视频工程。

**[在线试用(GitHub Pages)](https://qwert702.github.io/cutforge/)** ·
[下载源码](https://github.com/qwert702/cutforge) ·
[Pro 商业架构](docs/PRO-ARCHITECTURE.md)

<img src="assets/screenshot-demo.png" width="880" alt="CutForge 编辑器:双轨时间线 + Canvas 预览 + AI 对话剪辑" />

</div>

> 命名说明:"CutForge" 是开发代号,正式发布名待定。

## 快速开始

打开[在线版](https://qwert702.github.io/cutforge/),点击左侧
**「🎬 加载示例工程」**——应用会在浏览器里现场合成两段示例视频并铺上
时间线,你可以立即体验拖拽、分割、导出和 AI 对话剪辑,不需要导入任何文件。

本地开发:

```bash
npm install
npm run dev      # http://localhost:5300
npm test         # 核心逻辑单元测试
npm run lint
npm run build
```

要求 Node.js 20+(建议 24)。AI 功能在应用内"设置"里填入任一
OpenAI 兼容接口的 Base URL 与 API Key(存储在浏览器本地,不经过任何第三方)。

## 功能

- 🎞️ **多轨时间线**:视频/音频/图片,拖拽、裁剪、分割、跨轨、多选
- ↩️ **完整撤销栈**:不可变工程文档 + 命令层,手工与 AI 共用同一套命令
- 🤖 **AI 对话剪辑**:Agent 通过 8 个时间线工具真实剪辑,操作被拒会阅读错误自动重试
- 📦 **浏览器内导出**:WebCodecs(VP9 + Opus)客户端完成,素材不出本机
- 🔒 **隐私优先**:无遥测、无上报;素材与 API Key 全部留在本地

## 路线图

- [x] 时间线核心:不可变工程文档 + 命令层 + 撤销栈
- [x] 预览播放器与基础剪辑
- [x] Agent 对话剪辑(工具调用与手工编辑共用同一套命令层)
- [x] WebM 导出(WebCodecs,客户端完成)
- [x] 在线版与示例工程(无需安装即可体验)
- [ ] Agent 提案/批准模式
- [ ] 字幕工具与转写
- [ ] Electron 桌面壳
- [ ] 云服务(Pro):素材库、云同步、云端渲染 —— 独立闭源服务

## 双版本模式

本项目(社区版)以 AGPL-3.0-or-later 开源。商业结构分三层:

1. **基础版**(本仓库,免费开源)—— 完整本地剪辑能力;
2. **Pro 扩展** —— 闭源扩展包 + 授权码激活,安装进基础版后解锁本地高级功能;
3. **云服务** —— 付费素材库、云渲染、云同步,按订阅收费,通过 API 与基础版交互。

设计与边界见 [docs/PRO-ARCHITECTURE.md](docs/PRO-ARCHITECTURE.md)。
向本仓库贡献代码前请阅读 [CLA.md](CLA.md)。

## 许可

Copyright (C) CutForge Contributors

本程序为自由软件:你可以依据自由软件基金会发布的 **GNU Affero 通用公共
许可证(AGPL-3.0-or-later)** 再分发与/或修改它;无论是第 3 版许可证还是
(按你的选择)任何更新的版本。

依据 AGPL-3.0 第 13 条,如果你将本程序修改后以网络服务形式向用户提供,
你也必须向这些用户提供修改后源代码的获取途径。

本程序不提供任何担保。详见 LICENSE 文件。
第三方组件遵循其各自的许可。
