# Changelog

本项目的显著变更记录在案。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [0.1.0] - 2026-09-12

社区版首个公开版本。

### 新增
- 多轨时间线(视频/音频/图片):拖拽移动、边缘裁剪、分割、跨轨移动、复制、多选
- 不可变工程文档 + 命令层 + 撤销/重做,所有操作(手工与 AI)共用同一命令层
- Canvas 预览合成器与播放主时钟
- 本地素材导入(视频/音频/图片,自动探测时长与分辨率)
- AI 对话剪辑:OpenAI 兼容接口 BYO Key,8 个时间线工具,被拒自动重试
- WebM 导出:WebCodecs(VP9 + Opus)客户端完成,含音频混音,零 GPL 依赖
- Pro 能力门控与授权客户端骨架(`src/pro/`,见 docs/PRO-ARCHITECTURE.md)

[0.1.0]: https://github.com/qwert702/cutforge/releases/tag/v0.1.0
