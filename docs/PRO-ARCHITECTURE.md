# Pro 商业架构(隔离边界与扩展机制)

> 本文定义 CutForge 三层产品结构的法律边界与技术设计。
> **核心原则:基础版(CE)完整可用、独立开源;一切付费能力在服务端或闭源扩展中。**

## 1. 三层产品

| 层 | 载体 | 许可 | 收费 |
|---|---|---|---|
| CE 基础版 | 本仓库 | AGPL-3.0-or-later | 免费,引流 |
| Pro 扩展 | 独立私有仓库,发布为闭源扩展包 | 专有许可(我们自有版权) | 买断/年费 + 授权码 |
| 云服务 | 独立私有仓库(服务端) | 不分发,仅 SaaS | 订阅 + 用量计费 |

## 2. 法律基础(为什么这个结构合法)

1. **双许可权**:CutForge CE 全部原创,版权归项目所有者。项目所有者有权
   以 AGPL 公开同一套代码,同时保留把这些代码用于闭源 Pro 的权利——
   AGPL 只约束"别人的代码",不约束版权人自己的授权选择。
2. **CLA 强制**:任何第三方 PR 合入本仓库前,贡献者须签署 `CLA.md`
   (授予商用与再许可权)。否则该贡献只能留在 AGPL 侧,永不进入 Pro。
3. **AGPL 边界**:
   - CE 内的代码(含 Pro 的 API 客户端、激活码校验 UI)→ 开源;
   - Pro 扩展包、云服务端代码 → 不放进本仓库,不受 AGPL 传染
     (扩展通过 CE 声明的扩展点 API 挂接,自有版权 + 专有许可);
   - 云服务只被网络调用,不分发,AGPL 不触及。
4. **商标**:正式发布前注册产品名商标;AGPL 允许任何人 fork 代码,
   但不允许使用我们的名称与品牌资源。

## 3. Pro 扩展机制

### 3.1 扩展点(CE 侧,开源)

CE 启动时按 `src/pro/capabilities.ts` 的能力注册表决定开放哪些功能。
能力( Capability )是唯一门控单元,例如:

```
pro.export.mp4        — 专业格式导出
pro.fx.pack.advanced  — 高级特效/转场包
pro.batch             — 批量处理
pro.library.premium   — 付费素材库
pro.cloud.sync        — 云同步
```

### 3.2 扩展包(Pro 侧,闭源)

- 形态:带 manifest 的独立包,通过 CE 的扩展加载点注册(与社区插件同机制,
  但来源签名受信);
- **禁止复制 CE 的社区贡献代码**:扩展代码全部自写,物理隔离于私有仓库;
- 发布渠道:我们自己的更新服务器(不进公共 npm,避免再分发纠纷)。

### 3.3 激活流程

```
用户购买 → 获得 License Key
CE 内"升级 Pro"输入 Key
  → POST /v1/licenses/activate { key, deviceId }
  ← { token, expiresAt, capabilities[] }   (服务端签名)
本地缓存 token,按需调用云端能力;每 24h 静默 revalidate
离线宽限期 7 天(本地能力可用,云能力中断)
```

- **本地能力**(扩展包功能):签名授权文件校验,可被破解——接受,
  主要价值在持续更新与云能力;
- **云能力**(素材库/云渲染/同步):每次请求带 token,服务端校验,
  实际上不可破解。

## 4. 云服务 API(素材库等)

### 4.1 接口草案

```
GET  /v1/library/categories                 分类(免费部分开放)
GET  /v1/library/items?kind=&page=          素材列表(含免费/付费标记)
GET  /v1/library/items/:id/download         下载 → 302 到签名 CDN URL(需订阅)
GET  /v1/library/asset-presets/:id          云端预设(LUT/模板参数)
POST /v1/licenses/activate | deactivate     授权激活/解绑
GET  /v1/account/subscription               订阅状态
```

鉴权:`Authorization: Bearer <token>`;下载走短期签名 URL,token 不落 CDN。

### 4.2 素材授权(重要, avoiding OpenChatCut 的坑)

- 只上架:自制素材、CC0/CC-BY 素材、已签买断授权的第三方素材;
- 每个素材记录 `license` 元数据(来源、许可、需署名与否);
- **不做**:免费商用条款字体、厂商相机 LUT、来源不明的音效——
  参考:OpenChatCut 捆绑的若干字体/LUT 均有此类隐患。

### 4.3 CE 内的开源客户端

`src/pro/gateway.ts`:仅包含 base URL、token 存取、请求封装与错误处理,
不含任何业务机密。云端逻辑全部在服务端。

## 5. 里程碑映射

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 | CE MVP(时间线/预览/Agent) | ✅ v0.0.1 |
| M2 | WebM 导出 + Electron 壳 + GitHub 发布 | 进行中 |
| M3 | 能力门控 + 激活 UI + 扩展加载点 | 本文设计,`src/pro/` 骨架已落 |
| M4 | 云服务端(素材库/授权)私有仓库 | 待启动 |
| M5 | Pro 扩展第一包(高级导出 + 特效包) | 待启动 |
