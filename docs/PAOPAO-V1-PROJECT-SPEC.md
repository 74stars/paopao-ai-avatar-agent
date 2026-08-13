# Paopao 泡泡：成熟 AI 桌面应用完整项目规格

> 版本：V1.0  
> 编写日期：2026-08-04  
> 基准仓库：<https://github.com/74stars/paopao-ai-avatar-agent>  
> 基准提交：<code>5d2aa78</code>（2026-06-26）  
> 文档目的：把当前的产品概念、视觉预览和桌面壳，推进成一条可验证、可恢复、可发布的真实 AI 应用链路。

## 0. 先说结论

当前项目已经有：

- 清楚的产品方向：桌面上的长期记忆入口和“活书房”。
- 可在线体验的静态预览。
- Electron + React + TypeScript 的桌面 UI 壳。
- 能收发文本消息的飞书机器人骨架。
- 产品架构、Prompt、Coze Workflow 和指标文档。

当前还没有：

- 真正的模型调用、结构化记忆抽取、Embedding 或 RAG。
- SQLite 数据落盘和崩溃恢复。
- 语音、链接、图片、文件的真实解析链路。
- 真实日报、周报、提醒和可审计的长期画像。
- 桌面端、在线预览、飞书端共享的核心数据层。
- 可在干净 Windows 机器稳定安装、升级和卸载的发布链路。

因此本项目现在属于“产品定义较完整的视觉原型 + 部分通信骨架”，不是已经完成的 AI 应用。后续文档和 README 必须把“已实现 / 进行中 / 规划”分开写，不能让设计稿看起来像生产能力。

## 1. 产品定义

### 1.1 一句话

泡泡是一个 Windows 本地优先的长期记忆 Agent：它接住文字、语音、链接、图片和文件，先完整保存原始材料，再异步理解、归档、建立可检索记忆，最后以活书房、日报、周报和有证据的提醒帮助用户持续行动。

### 1.2 用户真正得到的结果

用户不需要先想好“这条内容属于哪个分类”。用户只要把材料交给泡泡，系统就要保证：

1. 原文和原始附件不会丢。
2. 即使断网或 AI 失败，也能先完成记录。
3. AI 的分类、摘要和判断可以被纠正、撤销和追溯。
4. 每个洞察、报告和画像事实都能回到具体来源。
5. 用户可以导出，也可以彻底删除自己的数据。

### 1.3 V1 产品边界

V1 的唯一主产品是 Windows 桌面应用，采用本地优先架构。

| 范围 | V1 要做 | V1 暂不承诺 |
|---|---|---|
| 入口 | 桌面泡泡、快捷键、文字、语音、链接、图片、PDF/文本/DOCX | 全平台原生客户端 |
| 存储 | 本地 SQLite、原始附件、任务队列、备份恢复 | 默认云端同步 |
| 理解 | 分类、摘要、实体、目标、行动、Embedding、带来源回答 | 无证据的“人格预测” |
| 书房 | 日记、思想、人物、阅读、目标、日报、周报 | 社交公开发布 |
| 主动能力 | 可关闭的日报、周报和提醒、免打扰时间 | 自动替用户执行外部操作 |
| 接入 | Provider 抽象，至少支持一个真实 AI Provider | 同时维护多个模型供应商的全部高级能力 |
| 飞书 | 作为可选输入适配器，复用核心服务 | 飞书成为第二套独立数据库 |
| 同步 | 预留接口，默认关闭 | 在 V1 前强行上线 Supabase 多端冲突解决 |

在线预览只负责展示产品气质和交互概念，永远使用隔离的演示数据，不接触用户的本地数据库。

### 1.4 产品原则

1. **先保存，后理解**：任何网络请求和 AI 请求之前，先把原始输入写入本地。
2. **原文不可静默覆盖**：摘要、转写、分类、画像和报告都是派生数据。
3. **可解释**：AI 结论必须带来源，用户能打开原始记录。
4. **可纠正**：分类、实体和画像更新都能编辑、撤销和重跑。
5. **离线可用**：断网时仍能记录；网络恢复后任务自动继续。
6. **少打扰**：提醒默认克制，有开关、有免打扰时段、有失败状态。
7. **隐私优先**：Renderer 不接触数据库、文件系统和 API Key。
8. **输入不可信**：网页、文件和用户材料中的文字不能改变系统规则。
9. **真实数据优先**：生产界面不允许依赖硬编码的记忆数量和示例报告。
10. **资产不降质**：原始图片永不被缩略图或聊天传输覆盖。

## 2. 端到端目标链路

### 2.1 总体架构

~~~mermaid
flowchart LR
  Capture["桌面泡泡 / 快捷键 / 飞书适配器"] --> Ingest["统一接收层"]
  Ingest --> Tx["SQLite 事务：原文 + 附件索引 + Job"]
  Tx --> Queue["持久化任务队列"]
  Queue --> Extract["转写 / OCR / 链接 / 文件解析"]
  Extract --> Understand["结构化 AI 理解"]
  Understand --> Memory["记忆图谱 + FTS + 向量索引"]
  Memory --> Library["活书房读模型"]
  Memory --> RAG["混合检索 + 有证据回答"]
  Memory --> Reports["日报 / 周报 / 提醒"]
  Library --> Correct["编辑 / 纠正 / 删除"]
  Correct --> Queue
~~~

### 2.2 一条文字输入的完整时序

1. 用户通过快捷键打开快速投递口。
2. Renderer 只提交经过 Schema 校验的 CaptureCommand。
3. Main 进程调用 CaptureService，生成不可变的 <code>entryId</code>。
4. SQLite 单事务写入原文、来源、时间、校验和，并创建一个 <code>normalize</code> Job。
5. UI 在 300ms 内显示“已保存”，不等待模型。
6. Worker 读取待处理 Job，做去重、清理和分段。
7. AI Provider 按 JSON Schema 返回分类、摘要、实体、目标、行动和画像候选。
8. Zod 校验结果；失败时只允许一次修复重试，仍失败则进入可见的人工复核状态。
9. 写入结构化记忆、全文索引和向量索引，并记录 <code>ai_runs</code>。
10. 书房读模型更新，用户可以查看原文、摘要和来源。
11. 用户勾选“请泡泡思考”时，才进行历史检索并生成有来源的洞察。
12. 日报和周报只读取真实时间窗内的记录，且每段结论都保存来源关系。

### 2.3 处理状态机

~~~text
RECEIVED
  -> STORED
  -> NORMALIZED
  -> EXTRACTED
  -> ANALYZED
  -> INDEXED
  -> READY

可恢复异常：
FAILED_RETRYABLE -> RETRY_WAIT -> NORMALIZED / EXTRACTED / ANALYZED

需要人处理：
NEEDS_REVIEW -> READY

不可恢复异常：
FAILED_FINAL（原文仍保留，用户可手动重跑）
~~~

每个任务必须有：<code>jobId</code>、幂等键、尝试次数、最后错误、下次执行时间和可重跑按钮。应用启动时要恢复超时任务，不能因为进程退出而丢失队列。

## 3. 各类输入的实现规格

### 3.1 文字

- 保存原文、语言、来源、创建时间和客户端版本。
- 规则预处理只做空白清理和长度限制，不改变原文。
- AI 失败时仍显示原文和“待处理”状态。
- 支持用户编辑派生摘要，但原始文本保留版本。

### 3.2 语音

1. Renderer 使用系统允许的录音能力生成音频文件。
2. 音频先复制到应用资产目录并写入 <code>assets</code> 表。
3. Worker 调用 <code>transcribe()</code>，保存可编辑的转写版本。
4. 转写失败不删除音频，允许重试或手动粘贴文本。
5. UI 明确显示录音是否会上传到外部模型。

### 3.3 链接

- 保存原始 URL、抓取时间、重定向链、标题、正文快照和用户备注。
- 抓取前拒绝 <code>file:</code>、localhost、内网 IP、非 HTTP(S) 协议和过大的响应。
- 限制超时、最大字节数、最大重定向次数和内容类型。
- 解析正文时使用成熟的 Readability 类库；原始 URL 和快照都保留。
- 文章内容视为不可信数据，不能执行其中的提示词。

### 3.4 图片

- 原图先落盘，生成缩略图和可选的 OCR/视觉理解结果。
- 缩略图只用于列表，不能替换原图。
- 保存 EXIF 中必要的方向信息；默认不把精确位置写入外部模型。
- 对超大图片做尺寸和内存保护，明确提示用户是否上传。

### 3.5 文件

V1 首批支持 PDF、TXT、Markdown、DOCX。每种文件都保留原件和抽取版本：

- PDF：页数、文本、页码来源。
- DOCX：段落、标题和原文件。
- Markdown/TXT：原文和编码。
- 拒绝可执行文件、脚本和未知危险类型。
- 限制单文件大小、页数、解压后大小和处理时长。

### 3.6 “只记住”和“请泡泡思考”

这是两个不同的产品动作：

- **只记住**：本地保存，后台整理，不强制生成回复。
- **请泡泡思考**：保存后检索历史，生成带来源的洞察。

这样既降低 API 成本，也避免用户每次输入都被无意义的回复打断。

## 4. 目标模块边界

核心服务必须独立于 Electron，这样桌面端、飞书适配器和测试可以共享同一条业务链。

~~~text
desktop-app/
  electron/
    bootstrap/              启动、迁移、任务恢复
    windows/                泡泡、投递口、书房、托盘
    ipc/                    typed IPC 路由和权限检查
    notifications/          系统通知
  src/
    renderer/
      pet/
      capture/
      library/
      reports/
      settings/
    components/
    styles/

packages/
  domain/                   Entry、Memory、Goal、Report 等类型
  contracts/                IPC 和服务端 Schema
  core/
    services/
      CaptureService
      AssetService
      ProcessingService
      RetrievalService
      SelfModelService
      ReportService
      ReminderService
      ExportService
  infrastructure/
    database/                SQLite、迁移、事务
    files/                   内容寻址资产、缩略图、加密
    ai/                      Provider 适配器和 Prompt 版本
    parsers/                 网页、PDF、DOCX、OCR、音频
    scheduler/               持久化 Job 和定时任务
    logging/
    sync/                    V1.1 以后

adapters/
  feishu/                    可选输入/输出适配器

preview/
  demo-data/                 与真实数据库完全隔离
  assets/

docs/
  product-spec/
  adr/
  runbooks/
~~~

### 4.1 责任边界

| 层 | 可以做什么 | 不能做什么 |
|---|---|---|
| Renderer | 展示状态、收集用户操作、请求 IPC | 读数据库、读 API Key、任意访问文件系统 |
| Preload | 暴露最小 typed API | 暴露原始 <code>ipcRenderer</code> 或 Node API |
| Main | 窗口、数据库、网络、任务、密钥、通知 | 把原文写进普通日志 |
| Core | 业务规则、状态机、领域服务 | 依赖 Electron 全局对象 |
| Infrastructure | SQLite、AI、解析器、资产和调度 | 直接决定 UI 文案或绕过领域规则 |
| Preview | 演示交互和视觉 | 访问私人数据或生产 API |
| Feishu Adapter | 验签、抽取消息、调用统一接收服务 | 自己维护第二套记忆库 |

### 4.2 统一 IPC 和领域事件契约

所有 Renderer 请求都通过版本化的 typed IPC，建议先固定以下最小契约：

| 命令 | 作用 | 成功返回 |
|---|---|---|
| <code>capture.create</code> | 保存文字或资产引用并创建 Job | <code>entryId, status: stored</code> |
| <code>entry.list</code> | 分页、搜索和筛选书页 | <code>items, cursor</code> |
| <code>entry.get</code> | 查看原文、派生内容和来源 | <code>entry + derivations + sources</code> |
| <code>entry.correct</code> | 修改分类、实体或标题 | <code>newRevision, affectedJobs</code> |
| <code>entry.delete</code> | 软删并排队清理派生数据 | <code>deletionJobId</code> |
| <code>job.retry</code> | 重跑失败任务 | <code>jobId, status: queued</code> |
| <code>report.generate</code> | 生成或重生成日报/周报 | <code>reportId, sourceCount</code> |
| <code>export.create</code> | 创建可校验的数据导出 | <code>exportId, path</code> |

主进程向 Renderer 只发送领域事件，不发送数据库对象：

~~~text
entry:stored
entry:updated
job:progress
job:failed
report:ready
pet:state
sync:status
~~~

事件中只包含必要的 ID、状态和摘要，不包含 API Key、完整附件内容或未经授权的原文。契约变更必须更新共享 Schema、迁移说明和 E2E 测试。

## 5. 数据与存储设计

### 5.1 本地目录

建议使用 Electron 的 <code>app.getPath("userData")</code>：

~~~text
userData/
  db/paopao.sqlite
  db/backups/
  assets/original/<sha256>.<ext>
  assets/derived/<sha256>/<kind>.<ext>
  exports/
  logs/
  secrets/
~~~

原始附件采用 SHA-256 内容寻址，重复文件只保存一份。所有文件写入临时文件后使用原子 rename，避免崩溃留下半个文件。

### 5.2 最小数据库表

| 表 | 作用 | 关键字段 |
|---|---|---|
| <code>entries</code> | 原始输入主表 | <code>id, source, modality, raw_text, status, created_at, checksum, deleted_at</code> |
| <code>assets</code> | 音频、图片、文件 | <code>id, entry_id, mime, bytes, sha256, relative_path, width, height, duration</code> |
| <code>entry_contents</code> | 转写、OCR、网页正文版本 | <code>entry_id, kind, content, revision, created_by</code> |
| <code>memories</code> | AI 结构化记忆 | <code>id, type, summary, confidence, status, created_at</code> |
| <code>entities</code> | 人物、书籍、地点、主题 | <code>id, type, canonical_name</code> |
| <code>entry_entities</code> | 输入与实体关系 | <code>entry_id, entity_id, evidence</code> |
| <code>goals</code> | 目标及进度 | <code>id, title, status, due_at, progress</code> |
| <code>actions</code> | 下一步行动 | <code>id, goal_id, title, status, due_at</code> |
| <code>self_model_facts</code> | 可审计画像事实 | <code>id, domain, value_json, confidence, state</code> |
| <code>artifact_sources</code> | 派生内容证据 | <code>artifact_type, artifact_id, entry_id, quote</code> |
| <code>embeddings</code> | 向量索引 | <code>document_type, document_id, chunk_index, model, vector</code> |
| <code>reports</code> | 日报和周报 | <code>id, type, period_start, period_end, body_json, status</code> |
| <code>reminders</code> | 提醒计划和结果 | <code>id, scheduled_at, status, source_id</code> |
| <code>jobs</code> | 持久化后台任务 | <code>id, type, payload_json, attempts, next_run_at, status</code> |
| <code>ai_runs</code> | AI 调用审计 | <code>provider, model, prompt_version, latency_ms, tokens, error</code> |
| <code>settings</code> | 本地配置 | <code>key, value_json, updated_at</code> |

数据库必须有版本化迁移和启动前备份。删除一条原始记录时，必须同时清理附件、索引、派生记忆、报告引用和缓存。

### 5.3 事务边界

捕捉一条输入至少使用一个事务：

~~~text
BEGIN
  insert entries
  insert assets metadata
  insert jobs (idempotency_key = source + external_id or content hash)
COMMIT
~~~

AI 处理不能和网络请求放在同一个长事务里。处理成功后用短事务写入派生结果；任何失败都不能回滚原始输入。

### 5.4 版本和可追溯

- 原文永远不可变，编辑产生新 revision。
- AI 结果保存 Provider、模型、Prompt 版本和时间。
- 报告每一段结论关联一个或多个 <code>artifact_sources</code>。
- 画像事实先进入 <code>proposed</code>，用户确认或多次高置信度重复后才进入 <code>confirmed</code>。
- 用户纠正分类后，要重新排队受影响的索引和报告，而不是只改 UI。

## 6. AI Provider、结构化理解与 RAG

### 6.1 Provider 抽象

业务层只依赖以下能力，不直接绑定某一家 SDK：

~~~text
generateStructured(input, schema, options)
generateText(messages, options)
embed(chunks, options)
transcribe(audio, options)
understandImage(image, options)
~~~

第一版可以只实现一个 Provider；Coze、其他云模型或本地模型通过 Adapter 接入。API Key 只在 Main 进程读取，并用系统密钥能力保护。

### 6.2 结构化抽取输出

模型输出必须经过 JSON Schema 和 Zod 双重校验。建议字段：

~~~json
{
  "input_type": "diary|thought|person|reading|goal|link|schedule|other",
  "summary": "一句可校验的摘要",
  "entities": [
    { "type": "person|book|place|topic", "name": "实体名", "confidence": 0.0 }
  ],
  "growth_axes": ["认知", "行动"],
  "goals": [
    { "title": "目标", "evidence": "原文短引", "confidence": 0.0 }
  ],
  "next_actions": [
    { "title": "下一步", "due_hint": null, "confidence": 0.0 }
  ],
  "self_model_candidates": [
    { "domain": "values|ambitions|tone|pattern", "value": "候选事实", "evidence": "原文短引" }
  ],
  "should_reply": false,
  "needs_user_review": false
}
~~~

禁止模型直接写入系统设置、执行外部命令、修改原文或自动确认画像。

### 6.3 混合检索

只做向量检索会漏掉精确的人名、书名和时间条件。推荐：

1. SQLite FTS5 召回关键词结果。
2. Embedding 召回语义相近结果。
3. 按时间衰减、来源、分类和目标状态过滤。
4. 去重并重排，先召回约 20 条。
5. 选 6–8 条进入上下文。
6. 生成回答并保存来源关系。

没有相关记忆时，模型必须明确说“目前没有找到相关记录”，不能编造过去发生过的事。

### 6.4 Prompt 和评测

- Prompt 必须版本化，不能散落在组件里。
- 用户输入、网页正文和文件内容都放在不可信数据区。
- 建立至少 100 条匿名评测样本，覆盖分类、目标、人物、阅读、无关文本和恶意提示词。
- 结构化解析成功率目标不低于 99%，人工分类一致率目标不低于 90%。
- 记录延迟、失败率、token、费用和模型版本，但日志不写原文。

### 6.5 日报、周报和提醒规则

- 日报按用户本地时区的自然日生成，周报默认按周一至周日生成。
- 每个时间窗使用稳定的幂等键，例如 <code>daily:2026-08-04</code>，重复触发只更新同一报告。
- 报告正文保存结构化章节、生成版本、来源数量和模型信息；用户编辑后保留编辑版本。
- 生成失败不覆盖上一版报告，界面显示失败原因并允许重试。
- 提醒计划持久化到 <code>reminders</code>，应用错过执行时间后按策略补跑一次，不重复发送。
- 免打扰、暂停、时区和通知渠道都由用户控制；提醒发送结果写入状态，不能只依赖内存定时器。

## 7. 书房与桌面体验

### 7.1 桌面泡泡

- 透明、置顶、可拖动、可吸附边缘，位置在重启后恢复。
- 单击打开快速投递，双击打开活书房；实现明确的点击判定，避免单击事件抢先触发。
- Pet 状态由真实处理事件驱动：<code>quiet</code>、<code>listening</code>、<code>remembering</code>、<code>thinking</code>、<code>insight</code>、<code>sleeping</code>。
- 主进程必须真正发送 <code>pet:state</code>，不能只在 preload 中订阅。
- 高 DPI、多屏、窗口最小尺寸和无障碍文本都要验收。

### 7.2 快速投递口

必须有以下状态：

- 输入中。
- 已保存，等待整理。
- 整理中。
- 已完成，显示分类和来源。
- 失败，可重试。
- 离线，已保存待联网。

用户能看到“是否联网处理、原文保存在哪里、当前任务是否完成”，但不需要理解内部队列。

### 7.3 活书房

- 所有数量和列表从 SQLite 查询，禁止硬编码。
- 书脊支持日记、思想、人物、阅读、目标、日报、周报。
- 详情页同时显示原文、派生摘要、处理状态和来源。
- 支持搜索、筛选、收藏、编辑、纠正分类、删除和恢复。
- 报告可以重新生成，生成失败时保留上一版。

### 7.4 设置与信任

设置页至少包括：

- AI Provider、模型和联网范围。
- 免打扰时间和提醒开关。
- 数据目录、备份、导出、全量删除。
- 外部模型发送内容的预览。
- 日志和诊断导出（默认脱敏）。

## 8. 隐私、安全和可靠性

### 8.1 密钥和本地数据

- API Key 存在系统安全存储中，不进 Renderer、日志或数据库明文。
- <code>safeStorage</code> 只负责保护密钥，不能把它当成数据库加密。
- 正式版本对敏感字段和附件使用 AES-256-GCM；主密钥由 Windows DPAPI 或同等级系统密钥保护。
- 默认不启用云同步；启用时只上传端到端加密内容。

### 8.2 IPC 和 Renderer

- 保持 <code>contextIsolation: true</code>、<code>nodeIntegration: false</code>。
- 每个 IPC 入参和返回值都使用 Zod Schema。
- 不暴露原始 <code>ipcRenderer</code>、文件系统或网络客户端。
- 设置 CSP，禁止 Renderer 任意导航、外部弹窗和未授权权限。
- 文件选择、录音、剪贴板都需要明确用户动作。

### 8.3 链接和文件安全

- 阻止 SSRF：拒绝 localhost、内网 IP、<code>file:</code>、不安全重定向。
- 限制响应大小、解压后大小、页数、超时和重定向次数。
- 文件类型按 MIME、扩展名和魔数三重检查。
- 解析器进程失败时不影响主数据库和新输入。

### 8.4 删除、导出和恢复

- 支持 Markdown/JSON/原始附件导出。
- 支持单条删除、按时间段删除和全量擦除。
- 删除必须清理原文、附件、Embedding、派生记忆、报告引用、缓存和同步墓碑。
- 备份采用版本号和 SHA-256 校验；迁移失败自动回滚到最近备份。

## 9. 媒体资源工程边界

程序只验证媒体文件存在、可解码、请求成功、透明通道可用、画面非空且运行窗口没有未覆盖、裁切或溢出。像素统计和固定视口截图仅用于确认候选可被可靠查看，不定义母版、媒介、构图、风格或美术质量。

每轮候选保留未加标注的原始截图和采样环境。人工评审直接查看当前画面与本轮用户参考，并输出问题、依据、保留项和下一轮美术指导；自动化报告不包含美术结论。

## 10. 工程化、构建与发布

### 10.1 先修复当前构建风险

当前代码中存在以下必须先处理的断点：

- <code>capture:save</code> 只返回固定分类和话术，不落盘。
- <code>LibraryWindow</code> 使用硬编码数量和内容。
- <code>better-sqlite3</code>、Supabase、Zod 出现在依赖中，但没有业务接入。
- 托盘从 <code>app.getAppPath()/public/assets</code> 读取图片，而打包清单没有稳定包含该目录。
- CSS 使用 <code>/assets/...</code>，在 <code>file://</code> 的打包环境可能失效。
- Electron 主进程的开发、编译和 <code>noEmit</code> 配置需要重新验证。
- 飞书 README 要求使用 <code>.env</code>，但当前启动路径没有可靠加载环境变量的实现。

### 10.2 依赖和目录基线

- 提交并锁定 <code>package-lock.json</code>。
- 固定 Node、npm 和 Electron 版本。
- 统一 Vite 的 <code>base</code>、资源路径和生产打包路径。
- 为 <code>better-sqlite3</code> 等原生模块执行 Electron rebuild，并验证打包后能加载。
- 核心服务和测试不依赖窗口是否打开。

### 10.3 CI 最低流水线

~~~text
install
  -> lint
  -> typecheck
  -> unit tests
  -> database integration tests
  -> renderer build
  -> electron build
  -> Windows NSIS package
  -> clean-machine smoke test
  -> asset quality check
  -> checksum and release artifact
~~~

正式安装包只在 <code>windows-latest</code> 构建，首发支持 Windows 10/11 x64。公测前完成代码签名；自动更新只接受已签名的稳定或 Beta Release。

### 10.4 安装包验收

在干净 Windows 虚拟机完成：

1. 安装。
2. 首次启动和数据库迁移。
3. 托盘图标和快捷键。
4. 保存文字并重启。
5. 断网保存，恢复网络后继续处理。
6. 打开书房、搜索、纠正和删除。
7. 备份、导出、恢复。
8. 升级到下一版本。
9. 卸载时明确保留或删除数据。

## 11. 测试策略

### 11.1 单元测试

- Zod Schema 和结构化输出。
- Capture 状态机和 Pet 状态机。
- 分类、去重、幂等键和重试退避。
- 画像候选合并和撤销。
- 报告时间窗和提醒时间计算。
- 文件类型、大小和 URL 安全校验。

### 11.2 集成测试

- 数据库迁移、事务和级联删除。
- 进程强杀后的任务恢复。
- AI Provider 超时、限流、空结果和无效 JSON。
- 全文索引、向量索引和来源绑定。
- 导出后在新目录恢复。

### 11.3 Electron E2E

- 快捷键打开投递口。
- 离线保存和重启恢复。
- 文本、链接、图片、PDF 和语音的处理状态。
- 搜索、详情、纠正、收藏、删除和撤销。
- 托盘、窗口位置、多屏和高 DPI。

### 11.4 截图与渲染完整性

- 1366×768、1440×900、1920×1080。
- 100%、125%、150% 缩放。
- 日间和夜间主题。
- 长标题、长段落、空数据、错误和加载状态。
- 资源请求、解码、非空画面、窗口覆盖、裁切和溢出检查。
- 截图只作为当前候选的原始证据；人工评审另行输出下一轮美术指导。

### 11.5 隐私测试

- Renderer 无法直接读取 Key、数据库和任意文件。
- 普通日志不出现原文、附件内容、Prompt 和 Key。
- 删除后附件、索引、缓存和报告引用全部消失。
- 链接抓取无法访问本机和内网地址。

## 12. 迭代路线与交付物

以下顺序适合单人或小团队。时间是参考，不是承诺；每阶段必须通过本阶段验收才能进入下一阶段。

| 阶段 | 时间 | 必须交付 |
|---|---:|---|
| M0 基线 | 3–5 天 | 锁文件、统一 README、修复资源路径、CI、媒体解码检查、迁移框架 |
| M1 本地文字闭环 | 1–2 周 | SQLite、原文先存、任务队列、真实书房、搜索、编辑、删除 |
| M2 AI 与 RAG | 1–2 周 | Provider、结构化抽取、FTS/向量检索、来源引用、画像候选 |
| M3 链接和文件 | 1–2 周 | URL 快照、PDF/TXT/MD/DOCX 抽取、附件生命周期和失败重试 |
| M4 图片和语音 | 1–2 周 | 原图/音频保存、OCR/视觉理解、转写、可编辑版本 |
| M5 报告和主动能力 | 1–2 周 | 日报、周报、提醒、免打扰、重生成、来源追溯 |
| M6 隐私和发布 | 2 周 | 加密、导出恢复、Windows 安装、签名、升级、冒烟测试 |
| V1.1 扩展 | V1 后 | 飞书适配器、加密同步、冲突解决、日历/天气等外部上下文 |

可信的本地优先 V1，单人开发通常需要约 10–14 周。提前同时做飞书、Supabase、多设备和所有多模态，会显著扩大安全、部署和冲突处理成本。

## 13. P0/P1/P2 初始任务清单

### P0：不完成就不能称为真实 MVP

- [ ] P0-01：提交锁文件，固定 Node/Electron，补 typecheck/test/build CI。
- [ ] P0-02：验证当前候选的媒体资源可加载、可解码，固定视口截图非空且完整覆盖窗口。
- [ ] P0-03：建立 SQLite 迁移、备份和恢复机制。
- [ ] P0-04：实现 typed IPC 和所有输入大小/来源校验。
- [ ] P0-05：实现 CaptureService，原文先存并创建幂等 Job。
- [ ] P0-06：实现持久化 Worker、失败重试、启动恢复和可见错误状态。
- [ ] P0-07：让书房数量、列表和详情全部来自真实数据库。
- [ ] P0-08：修复打包资源路径和原生模块加载，在 Windows 干净环境启动。
- [ ] P0-09：支持搜索、分类纠正、编辑、删除、导出和来源查看。

### P1：把 README 的主要承诺补齐

- [ ] P1-01：接入一个真实 AI Provider 和结构化 Schema。
- [ ] P1-02：实现 FTS5 + 向量的混合检索。
- [ ] P1-03：实现链接、PDF、TXT、Markdown、DOCX 的解析。
- [ ] P1-04：实现图片 OCR/视觉理解和语音转写。
- [ ] P1-05：实现日报、周报、提醒、免打扰和重生成。
- [ ] P1-06：画像候选确认、撤销和审计。
- [ ] P1-07：补齐单元、集成、E2E、视觉和隐私测试。

### P2：成熟化扩展

- [ ] P2-01：飞书改为共享核心服务的可选适配器。
- [ ] P2-02：端到端加密同步和多设备冲突解决。
- [ ] P2-03：签名安装包、自动更新和回滚。
- [ ] P2-04：本地模型、模型切换、成本预算和评测面板。
- [ ] P2-05：日历、天气、地点、国际化和插件能力。

## 14. Definition of Done

任何功能只有同时满足以下条件，才算完成：

- 正常、失败、离线、重启四种状态都有明确行为。
- 原始输入在任何网络请求前持久化。
- 生产界面不依赖假数据。
- AI 派生结果可追溯、可纠正、可删除。
- 有自动化测试和可诊断的错误日志。
- 敏感内容不写入普通日志。
- 用户能理解是否会访问外部模型。
- 数据迁移、Schema、测试和文档同步更新。

## 15. V1 完整验收场景

1. 用户用快捷键保存文字，300ms 内看到“已保存”。
2. 断网并强制退出，重新打开后原文仍在。
3. 网络恢复后任务自动继续，重复事件不会重复建档。
4. 用户输入链接，系统保存 URL、正文快照和备注。
5. 用户导入图片、PDF 和语音，原始文件与派生版本都可查看。
6. 书房的数量、搜索和详情全部来自真实数据库。
7. AI 回答至少展示 1–3 条真实来源；无来源时明确说明没有找到。
8. 用户纠正分类后，后续检索和报告使用新的分类。
9. 日报、周报只覆盖指定时间窗，结论可展开到原始记录。
10. 用户可导出完整数据，也可彻底删除指定数据。
11. 干净 Windows 10/11 机器可安装、启动、驻留托盘、升级和卸载。
12. 1440×900 和 150% 缩放下资源均可加载，截图非空且不存在未覆盖、裁切或横向溢出。

## 16. README 和项目治理规则

根 README 建议固定为以下结构：

1. 产品一句话和当前截图。
2. 当前已实现能力。
3. 在线演示的边界（明确是演示数据）。
4. 本地开发和 Windows 构建。
5. 数据与隐私说明。
6. 当前路线和未实现能力。
7. 架构图和目录。
8. 发布、测试和问题反馈。

每次发布都更新：

- 版本号、变更日志和迁移说明。
- 已实现 / 进行中 / 规划列表。
- 资产清单、像素尺寸和校验和。
- Windows 安装包校验结果。
- 已知限制和回滚方式。

## 17. 关键风险与决策

### 风险：范围过大

解决：先完成“文字输入 -> SQLite -> 真实书房 -> AI 抽取 -> 有证据回答”，再扩展入口。

### 风险：模型输出不稳定

解决：Schema 校验、修复重试、人工复核、Prompt 版本和评测集。

### 风险：隐私数据外泄

解决：默认本地、显式联网提示、密钥隔离、脱敏日志、导出和彻底删除。

### 风险：Electron 原生依赖在 Windows 失败

解决：只在 Windows CI 打包，固定版本，执行 rebuild，做干净机冒烟。

### 风险：候选截图不能真实反映运行画面

解决：记录运行环境和数据状态，保留未标注原始截图，并分别检查资源加载、解码、窗口覆盖、裁切和渲染错误。美术判断由人工评审输出下一轮指导。

### 已作出的产品决策

- 主产品：Windows 本地优先桌面应用。
- 权威数据源：本地 SQLite。
- 在线预览：隔离的演示站。
- 飞书和云同步：V1.1 后的适配器。
- 原始输入：不可变、优先保存。
- AI 画像：候选 -> 确认 -> 可撤销。

## 18. 最重要的执行顺序

不要先继续堆新的视觉页面，也不要先同时接入所有入口。第一条必须稳定的链路是：

~~~text
文字输入
  -> SQLite 原文落盘
  -> 持久化任务队列
  -> 真实 AI 结构化抽取
  -> FTS/向量索引
  -> 活书房真实读模型
  -> 带来源的泡泡回答
~~~

这条链路通过断网、重启、失败重试、纠正、删除和来源追溯验收后，泡泡才从“漂亮的演示”进入“可信的成熟 AI 应用”。
