# 贡献指南

感谢你对 CutForge 的关注!本文介绍如何搭建环境、跑通验证和提交贡献。

## 环境搭建

- Node.js 20+(建议 24),无需其他系统依赖(媒体编解码用浏览器原生的 WebCodecs)
- `npm install`
- `npm run dev` → http://localhost:5300
- `npm test` / `npm run lint` / `npm run build`

## 代码结构导览

```
src/core/      时间线核心:不可变文档 + 命令层 + 撤销栈(纯逻辑,有单元测试)
src/render/    合成器:预览与导出共用的画面绘制
src/export/    导出引擎(MP4/WebM,WebCodecs)
src/agent/     AI 工具(与手工编辑共用命令层)
src/media/     素材导入、缩略图、波形、示例工程
src/persist/   本地工程库(IndexedDB 自动保存)
src/ui/        React 界面(时间线/预览/检查器/AI 面板)
private/       私有材料(不入库,见下)
```

设计要点:**所有修改都走 `src/core/commands.ts` 的命令层**,命令携带显式 id,
重放是确定性的 —— AI 工具与手工编辑共用同一套命令与校验。

## 提交约定

1. 从 `main` 切分支:`feat/xxx` 或 `fix/xxx`
2. 提交信息用中文或英文均可,一行主题 + 必要时正文说明动机
3. 核心(`src/core/`)的改动必须带 `*.verify.ts` 单元测试
4. 提交前确认 `npm test`、`npm run lint`、`npx tsc -b` 全部通过

## 贡献者许可协议(CLA)

首次提交 PR 前请阅读并同意 [CLA.md](CLA.md) —— 这让我们能同时以
AGPL 维护社区版并发布商业版本。提交内容即视为接受该协议。

## 报告问题

提交 Issue 时请附:浏览器/系统版本、复现步骤、控制台报错截图。
功能建议请说明使用场景。

## 行为准则

保持友善与尊重;对事不对人;欢迎新手问题。
