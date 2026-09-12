// Agent 工具集:LLM 通过这些工具操作时间线。
// 关键设计:工具最终都落到 core 的 Command,与手工编辑走同一套命令层与
// 校验(重叠/越界/类型兼容),Agent 无法做出手工做不到的非法操作。

import type { ToolSchema } from './llm.ts';
import { projectDuration } from '../core/select.ts';
import { uid, type ProjectDoc, type TrackKind } from '../core/types.ts';
import type { Command } from '../core/commands.ts';
import { editorStore } from '../ui/hooks/useEditorStore.ts';

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const stringOr = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

/** 供系统提示词使用的工程状态摘要。 */
export function describeProject(doc: ProjectDoc): string {
  const lines = [
    `工程:${doc.name},${doc.width}x${doc.height},${doc.fps}fps,当前时长 ${projectDuration(doc).toFixed(2)}s`,
    `轨道:${doc.tracks.map((t) => `${t.name}(${t.kind})`).join(', ') || '无'}`,
    `素材(${doc.assets.length}):`,
    ...doc.assets.map(
      (a) =>
        `  - id=${a.id} "${a.name}" [${a.kind}]${a.durationSeconds !== null ? ` 时长 ${a.durationSeconds.toFixed(2)}s` : ''}`,
    ),
    `片段(${doc.clips.length}):`,
    ...doc.clips.map(
      (c) =>
        `  - id=${c.id} 素材 ${c.assetId} → 轨道 ${c.trackId} 起点 ${c.start.toFixed(2)}s 时长 ${c.duration.toFixed(2)}s 源内偏移 ${c.inPoint.toFixed(2)}s`,
    ),
  ];
  return lines.join('\n');
}

export interface ToolContext {
  readonly doc: ProjectDoc;
  /** 返回给模型的结果文本 */
  readonly report: (text: string) => void;
}

type ToolHandler = (args: Record<string, unknown>, context: ToolContext) => void;

interface AgentTool {
  readonly schema: ToolSchema;
  readonly handle: ToolHandler;
}

/** 把一批命令派发到编辑器;全部合法才生效(整批一个撤销点)。 */
function runCommands(commands: readonly Command[], report: (text: string) => void, okText: string): void {
  const result = editorStore.dispatchAll(commands, `Agent:${okText}`);
  report(result.ok ? okText : `被编辑器拒绝:${result.error}`);
}

export const AGENT_TOOLS: readonly AgentTool[] = [
  {
    schema: {
      type: 'function',
      function: {
        name: 'list_project',
        description: '读取当前工程状态:轨道、素材、片段与时间。',
        parameters: { type: 'object', properties: {} },
      },
    },
    handle: (_args, { doc, report }) => report(describeProject(doc)),
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'add_clip',
        description: '把一个已导入的素材作为片段添加到时间线。',
        parameters: {
          type: 'object',
          properties: {
            assetId: { type: 'string', description: '素材 id(list_project 可查)' },
            trackId: { type: 'string', description: '可选,目标轨道 id;省略时放第一条兼容轨道' },
            start: { type: 'number', description: '时间线起点(秒)' },
            duration: { type: 'number', description: '可选,片段时长(秒);省略用素材完整时长' },
            inPoint: { type: 'number', description: '可选,源内偏移(秒)' },
          },
          required: ['assetId', 'start'],
        },
      },
    },
    handle: (args, { doc, report }) => {
      const assetId = stringOr(args.assetId);
      const asset = doc.assets.find((a) => a.id === assetId);
      if (!asset) {
        report(`素材不存在:${assetId}`);
        return;
      }
      const trackId = stringOr(args.trackId) || pickTrack(doc, assetId);
      if (!trackId) {
        report('没有兼容轨道;请先调用 add_track');
        return;
      }
      const duration = numberOr(args.duration, asset.durationSeconds ?? 5);
      const commands: Command[] = [];
      if (!doc.tracks.some((t) => t.id === trackId)) {
        report(`轨道不存在:${trackId}`);
        return;
      }
      commands.push({
        type: 'clip.add',
        clip: {
          id: uid('clip'),
          trackId,
          assetId,
          start: numberOr(args.start, 0),
          duration,
          inPoint: numberOr(args.inPoint, 0),
        },
      });
      runCommands(commands, report, '已添加片段');
    },
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'add_track',
        description: '新建一条视频或音频轨道。',
        parameters: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['video', 'audio'] },
            name: { type: 'string', description: '可选,轨道名' },
          },
          required: ['kind'],
        },
      },
    },
    handle: (args, { report }) => {
      const kind: TrackKind = args.kind === 'audio' ? 'audio' : 'video';
      const existing = editorStore.get().history.present.tracks.filter((t) => t.kind === kind).length;
      const track = { id: uid('track'), kind, name: stringOr(args.name) || `${kind === 'video' ? '视频' : '音频'} ${existing + 1}` };
      runCommands([{ type: 'track.add', track }], report, `已新建轨道 ${track.name}`);
    },
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'move_clip',
        description: '移动片段(可换轨)。被拒绝通常说明目标位置与同轨片段重叠。',
        parameters: {
          type: 'object',
          properties: {
            clipId: { type: 'string' },
            start: { type: 'number' },
            trackId: { type: 'string', description: '可选' },
          },
          required: ['clipId', 'start'],
        },
      },
    },
    handle: (args, { report }) => {
      const command: Command = { type: 'clip.move', clipId: stringOr(args.clipId), start: numberOr(args.start, 0) };
      runCommands([command], report, '已移动片段');
    },
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'trim_clip',
        description: '调整片段:改起点(左切,源内偏移随之变化)和/或时长。',
        parameters: {
          type: 'object',
          properties: {
            clipId: { type: 'string' },
            start: { type: 'number' },
            duration: { type: 'number' },
          },
          required: ['clipId'],
        },
      },
    },
    handle: (args, { report }) => {
      const command: Command = {
        type: 'clip.trim',
        clipId: stringOr(args.clipId),
        ...(args.start !== undefined ? { start: numberOr(args.start, 0) } : {}),
        ...(args.duration !== undefined ? { duration: numberOr(args.duration, 0) } : {}),
      };
      runCommands([command], report, '已调整片段');
    },
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'split_clip',
        description: '在指定时间点分割片段。',
        parameters: {
          type: 'object',
          properties: { clipId: { type: 'string' }, at: { type: 'number', description: '时间线秒' } },
          required: ['clipId', 'at'],
        },
      },
    },
    handle: (args, { report }) => {
      runCommands(
        [{ type: 'clip.split', clipId: stringOr(args.clipId), at: numberOr(args.at, 0), newClipId: uid('clip') }],
        report,
        '已分割片段',
      );
    },
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'remove_clip',
        description: '删除片段。',
        parameters: { type: 'object', properties: { clipId: { type: 'string' } }, required: ['clipId'] },
      },
    },
    handle: (args, { report }) => {
      runCommands([{ type: 'clip.remove', clipId: stringOr(args.clipId) }], report, '已删除片段');
    },
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'seek',
        description: '把预览播放头移动到指定时间。',
        parameters: { type: 'object', properties: { time: { type: 'number' } }, required: ['time'] },
      },
    },
    handle: (args, { report }) => {
      editorStore.seek(numberOr(args.time, 0));
      report('已定位播放头');
    },
  },
];

export const AGENT_TOOL_SCHEMAS: readonly ToolSchema[] = AGENT_TOOLS.map((tool) => tool.schema);

function pickTrack(doc: ProjectDoc, assetId: string): string | null {
  const asset = doc.assets.find((a) => a.id === assetId);
  if (!asset) return null;
  const kind = asset.kind === 'audio' ? 'audio' : 'video';
  return doc.tracks.find((t) => t.kind === kind)?.id ?? null;
}

/** 按名字执行工具。工具内可以连续派发命令。 */
export function executeTool(name: string, rawArguments: string, doc: ProjectDoc): string {
  const tool = AGENT_TOOLS.find((t) => t.schema.function.name === name);
  if (!tool) return `未知工具:${name}`;
  let args: Record<string, unknown>;
  try {
    args = rawArguments ? (JSON.parse(rawArguments) as Record<string, unknown>) : {};
  } catch {
    return '参数不是合法 JSON';
  }
  const chunks: string[] = [];
  tool.handle(args, { doc, report: (text) => chunks.push(text) });
  return chunks.join('\n') || '(无输出)';
}
