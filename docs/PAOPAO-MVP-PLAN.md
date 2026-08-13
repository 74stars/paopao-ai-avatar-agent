# Paopao 泡泡：本地优先桌面 MVP 实施计划

> 版本：MVP 0.1  
> 编写日期：2026-08-04  
> 范围修订：2026-08-08，飞书移至 MVP 后增量，见 `docs/adr/0004-defer-feishu-post-mvp.md`  
> 当前基线：桌面本地闭环与 AI 治理已完成自动化验证，Wave 4 产品化与 macOS/Windows 发布验收待完成  
> 后续完整规格：`docs/PAOPAO-V1-PROJECT-SPEC.md`

## 0. 决策摘要

本阶段交付 macOS/Windows 双平台独立桌面应用。用户数据和业务状态以本地 SQLite 为唯一权威来源，不建设 Paopao 自有云服务，不做云同步。

飞书不属于本期 MVP 发布范围。已完成的长连接 Adapter、绑定和 delivery 可靠性实现保留为 MVP 后实验性增量，真实租户验收、OAuth 和正式分发均延期。

MVP 可以调用用户自行配置的外部 AI Provider，但保存、查看、搜索、纠正和删除原始记录不能依赖模型或网络。完全本地模型不在本阶段范围内。

MVP 的第一条可信链路是：

~~~text
桌面文字
  -> SQLite 原文落盘
  -> 持久化任务队列
  -> AI 结构化处理
  -> 活书房真实展示
  -> 可追溯、可纠正、可删除
~~~

## 1. 产品目标

泡泡是一个本地优先的长期记忆桌面 Agent。用户通过桌面快捷入口留下文字，泡泡先可靠保存原文，再异步整理成可搜索、可追溯的记忆。

MVP 要验证两个核心假设：

1. 桌面常驻入口是否足够轻，能让用户持续记录。
2. 自动整理和活书房是否比普通笔记列表更有长期价值。

## 2. 范围边界

### 2.1 MVP 必须实现

- Electron 桌面常驻、托盘、快捷键、快速记录窗口和活书房。
- 文字原文在任何网络请求前写入本地 SQLite。
- 持久化 Job、失败重试、应用启动恢复和可见错误状态。
- AI 分类、摘要、实体、目标和行动的结构化抽取。
- 活书房真实列表、详情、全文搜索和来源查看。
- 分类纠正、派生内容编辑、删除、重新处理和数据导出。
- API Key 通过 Electron `safeStorage` 保存。
- Wave 4 产品美化、窗口交互回归，以及 Windows NSIS、macOS x64/arm64 DMG/ZIP 安装包和干净机器上的安装、运行和卸载验证。

### 2.2 明确不进入 MVP

- Paopao 自建云服务、云端数据库和多设备同步。
- 飞书连接器正式发布、真实租户验收、OAuth、日历、文档、通讯录和应用市场分发。
- 语音、图片、链接抓取、PDF、DOCX 等多模态处理。
- 自动日报、周报、复杂提醒和外部行动执行。
- 多用户和多设备身份切换。
- 完全本地大模型及模型管理平台。

### 2.3 MVP 运行约束

- 首发平台为 Windows 10/11 x64 与 macOS 12+ x64/arm64。
- 首发使用单个本地用户。
- 没有 AI Key 或网络时仍可保存、查看、搜索、编辑和删除原始记录。

## 3. 核心用户链路

### 3.1 桌面记录

1. 用户通过快捷键或桌面泡泡打开快速记录。
2. Renderer 提交经过 Schema 校验的文字命令。
3. Main 在一个 SQLite 事务中写入 Entry 和待处理 Job。
4. UI 在 300ms 内显示“已保存”，不等待 AI。
5. Worker 异步处理并更新状态。
6. 活书房显示原文、派生内容、来源和处理状态。

### 3.2 飞书绑定（MVP 后增量参考）

本节不参与 MVP 验收，仅保留已完成实现的行为说明。

1. 用户在设置中填写自己的飞书 App ID/App Secret。
2. 桌面应用验证凭据并建立长连接。
3. 桌面端生成短时有效的一次性绑定码。
4. 用户向飞书机器人发送 `/bind <code>`。
5. 系统把 `app_id + tenant_key + open_id` 绑定到本地用户。
6. 凭据进入 `safeStorage`，绑定关系进入 SQLite。

### 3.3 飞书记录（MVP 后增量参考）

1. 飞书长连接收到消息事件。
2. Adapter 验证事件、使用 `message_id` 去重并转换为 CaptureCommand。
3. CaptureService 先写入本地数据库，再返回已保存状态。
4. AI 处理完成后，Adapter 通过飞书 OpenAPI 回复摘要或洞察。
5. 应用退出时关闭连接，不进行云端暂存。

## 4. 目标架构

~~~mermaid
flowchart TD
  Desktop[桌面泡泡 / 快捷记录] --> IPC[Typed IPC + Zod]
  Renderer[活书房 Renderer] --> IPC
  Feishu[post-MVP 飞书 Adapter] -.-> Capture[CaptureService]
  IPC --> Capture
  Capture --> Tx[SQLite 事务: Entry + Job]
  Tx --> Worker[持久化 Worker]
  Worker --> AI[AI Provider]
  Worker --> Memory[派生内容与记忆]
  AI --> Memory
  Memory --> Search[FTS5 / 可选向量检索]
  Search --> Renderer
  Memory -.-> Feishu
~~~

### 4.1 模块划分

~~~text
desktop-app/
  electron/
    bootstrap/           启动、迁移、任务恢复
    windows/             泡泡、投递口、书房、托盘
    ipc/                 typed IPC 路由与权限检查
    security/            safeStorage 和敏感配置
  src/
    renderer/            pet、capture、library、settings

packages/
  domain/                Entry、Job、Memory、Binding 等领域类型
  contracts/             Zod Schema、IPC 和事件契约
  core/
    CaptureService
    ProcessingService
    RetrievalService
    CorrectionService
    ExportService
  infrastructure/
    database/            SQLite、迁移、事务、FTS5
    ai/                  Provider、Prompt、结构化输出
    scheduler/           Job、重试、恢复
    logging/             结构化日志和脱敏

adapters/
  feishu/                长连接、绑定、消息转换和回复
~~~

### 4.2 技术选型

| 领域 | 选型 | MVP 用法 |
|---|---|---|
| 桌面容器 | Electron | 窗口、托盘、快捷键、通知、Main 进程 |
| Renderer | React + TypeScript + Vite | 桌面泡泡、记录窗口、书房和设置 |
| 桌面界面 | React Renderer | 泡泡状态、记录窗口和活书房交互 |
| 契约校验 | Zod | IPC、设置、AI 结构化输出 |
| 本地数据库 | SQLite + `better-sqlite3` | 权威数据、事务、FTS5、Job |
| AI | Provider Adapter | 支持多个命名配置、只激活一个 Provider；Direct OpenAI 兼容协议或复用 Codex 渠道 |
| 密钥 | Electron `safeStorage` | MVP 使用 AI Key；飞书凭据属于后续增量 |
| 飞书增量 | 官方 Node SDK 长连接 + OpenAPI | 已实现实验基线，不参与 MVP 发布验收 |
| 测试 | Vitest + Electron E2E | Core 单测、数据库集成、桌面冒烟 |
| 发布 | electron-builder | Windows x64 NSIS、macOS x64/arm64 DMG/ZIP |

Renderer 不得直接访问数据库、任意文件、API Key、飞书凭据或原始 `ipcRenderer`。Core 不依赖 Electron 全局对象；未来启用飞书增量时必须复用桌面的 CaptureService。

## 5. 最小数据模型

| 表 | 用途 | 关键字段 |
|---|---|---|
| `entries` | 不可静默覆盖的原始输入 | `id, source, raw_text, status, checksum, created_at, deleted_at` |
| `jobs` | 持久化后台任务 | `id, type, idempotency_key, attempts, next_run_at, status, last_error` |
| `derivations` | 摘要、分类等版本化派生内容 | `entry_id, kind, content_json, revision, created_by` |
| `memories` | 可检索结构化记忆 | `id, type, summary, confidence, status` |
| `artifact_sources` | AI 结论到原文的证据关系 | `artifact_type, artifact_id, entry_id, quote` |
| `ai_runs` | 模型调用审计 | `provider, model, prompt_version, latency_ms, tokens, error` |
| `feishu_bindings`（增量保留） | 飞书与本地用户绑定 | `app_id, tenant_key, open_id, local_profile_id, bound_at` |
| `processed_events`（增量保留） | 飞书事件幂等 | `provider, external_event_id, processed_at` |
| `settings` | 非敏感本地设置 | `key, value_json, updated_at` |

敏感值不进入 `settings`，只保存 safeStorage 返回的受保护数据。原文和完整 Prompt 不进入普通日志。

## 6. 飞书增量设计（MVP 后）

### 6.1 功能目标

- 应用运行时建立和维护飞书长连接。
- 接收已绑定用户发给机器人的文本消息。
- 将消息转换为统一 CaptureCommand，并写入同一份本地数据库。
- 回复保存状态、处理结果或带来源的洞察。
- 支持绑定、解绑、连接状态和权限错误提示。
- 断线自动重连，重复事件不重复建档或回复。

### 6.2 当前增量基线未使用 OAuth 的原因

现有实验实现只以机器人身份收发消息，不访问用户日历、个人文档或通讯录，因此使用事件中的 `tenant_key/open_id` 和一次性绑定码。正式产品化时重新评估自建应用向导与公开应用 OAuth，不沿用“MVP 不需要 OAuth”的旧假设。

### 6.3 已接受的限制

- 应用关闭期间的消息可能不被接收，当前增量基线不提供补偿承诺。
- 用户需要自行创建企业自建应用、启用机器人、配置权限和发布应用。
- 统一 App Secret 不打包进公开客户端；凭据由用户本地配置。
- 多设备同时运行、多个租户和公开市场分发留到后续版本。

### 6.4 主要工程风险

- 长连接重连、Token 刷新和系统休眠恢复。
- 飞书事件重试导致重复保存或重复回复。
- 权限、应用可用范围和租户安装状态配置复杂。
- App Secret 存在于本地进程，必须缩小暴露面并避免写日志。
- 桌面端关闭时没有云队列，因此产品文案不能承诺全天候代收。

## 7. 开发阶段

总工期按单人连续开发估算约 5–7 周。每个阶段通过验收后再进入下一阶段。

| 阶段 | 参考时间 | 必须交付 | 退出条件 |
|---|---:|---|---|
| M0 工程基线 | 3–5 天 | 构建修复、锁文件、目录基线、CI | Windows/macOS 安装包可启动 |
| M1 本地文字闭环 | 1–2 周 | SQLite、Capture、Job、真实书房 | 断网与重启后原文仍在 |
| M2 AI 记忆闭环 | 1–2 周 | Provider、抽取、搜索、来源、纠正 | AI 失败不丢数据，结论可追溯 |
| M3 飞书在线适配（MVP 后） | 不计入 MVP | 已有长连接、绑定、去重、回复基线 | 正式发布前完成产品方案与真实租户验收 |
| M4 产品化、可靠性与发布 | 1–2 周 | 候选截图与美术指导记录、窗口交互、跨平台安全/导出/测试/打包 | macOS/Windows 干净机器完成完整冒烟 |

### M0：工程基线

- [ ] 修复 Electron 主进程继承 `noEmit` 的编译问题。
- [ ] 修复 Vite `base`、CSS 和托盘资源的生产路径。
- [ ] 提交 lockfile，固定 Node、npm 和 Electron。
- [ ] 建立 domain、contracts、core、infrastructure 和 adapters 边界。
- [ ] 建立 typecheck、unit test、renderer build、electron build 和 Windows/macOS package CI。

### M1：本地文字闭环

- [ ] 建立 SQLite migration、事务和启动备份。
- [ ] 实现 CaptureCommand、typed IPC 和输入大小限制。
- [ ] 实现 CaptureService：单事务保存 Entry 和 Job。
- [ ] 实现 Worker、幂等、退避重试、启动恢复和失败状态。
- [ ] 书房数量、列表和详情全部改为真实数据库查询。
- [ ] 支持全文搜索、原文查看、编辑、分类纠正和删除。

### M2：AI 记忆闭环

- [ ] 建立 Provider 接口、Key 设置和联网状态提示。
- [ ] 固定结构化输出 Schema、Prompt 版本和 AI Run 审计。
- [ ] 抽取分类、摘要、实体、目标和行动。
- [ ] 实现 FTS5；向量检索根据本阶段容量评估决定是否同时交付。
- [ ] 绑定派生结果和原文来源。
- [ ] 支持结果纠正、重新处理和失败人工复核。

### M3：飞书在线适配（MVP 后增量）

- [x] 将现有 HTTP 回调骨架替换为 Electron 内部长连接 Adapter。
- [x] 实现飞书凭据验证、连接状态、断线重连和 Token 刷新。
- [x] 实现一次性绑定码、`/bind` 和 `/unbind`。
- [x] 使用 `message_id/event_id` 建立持久化幂等记录。
- [x] 飞书文字复用 CaptureService，不维护独立记忆库。
- [x] 处理权限不足、用户未绑定和应用关闭等边界。
- [ ] MVP 后重新决定自建应用向导或公开应用 OAuth，并执行真实租户验收。

### M4：产品化、可靠性与发布

- [ ] API Key 接入 safeStorage；实验性飞书凭据实现保留但不属于 MVP DoD。
- [ ] 实现数据导出、删除完整性和恢复验证。
- [ ] 补齐 Core 单测、数据库集成测试和 Electron 冒烟测试。
- [ ] 记录候选 Git SHA，完成泡泡透明通道、DPR、边缘和活书房固定状态截图采样；每轮截图由人工评审输出下一轮美术指导。
- [ ] 完成泡泡拖动、三窗口拖动区域/no-drag 控件和互斥单双击状态机验收。
- [ ] 验证系统休眠、断网、强退和重启。
- [ ] 在干净 Windows 10/11 x64 与 macOS 12+ x64/arm64 环境测试安装、升级和卸载。
- [ ] 产出带校验和、签名/notarization 状态和已知限制说明的 NSIS、DMG、ZIP 包。

## 8. MVP Definition of Done

MVP 只有同时满足以下条件才算完成：

1. 桌面文字进入本地 CaptureService。
2. 原文在任何 AI 请求之前持久化。
3. 断网、模型失败和应用强退都不会丢失已确认保存的原文。
4. 生产书房不使用硬编码数据。
5. AI 派生结果可追溯到原文，并能纠正、删除和重跑。
6. App 关闭后不依赖后台云服务。
7. Renderer 无法读取数据库文件、任意文件或明文密钥。
8. 有自动化测试、脱敏日志和可诊断错误状态。
9. 干净 Windows 与 macOS 机器可完成安装、记录、重启恢复和卸载。
10. 泡泡透明渲染、拖动和单双击满足工程要求；活书房保留当前候选的原始截图与人工美术指导记录，软件测试不产生美术结论。

## 9. MVP 后路线

MVP 验收后，再按照实际使用数据决定优先级：

1. 链接、图片、语音、PDF 和 DOCX 等多模态入口。
2. 日报、周报、目标提醒和免打扰时间。
3. 飞书连接器产品化：接入向导或公开应用 OAuth、真实租户验收、消息历史补偿、日历和文档能力。
4. 本地模型与完全离线 AI。
5. 可选的端到端加密同步和多设备支持。
6. 多用户、公开分发、应用市场和配套授权服务。

任何后续能力都不能破坏本地 SQLite 的权威数据源地位，也不能让桌面记录依赖 Paopao 自有云服务。
