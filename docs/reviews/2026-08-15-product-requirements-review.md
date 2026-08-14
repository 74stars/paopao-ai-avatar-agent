# Paopao 产品需求审核报告

> 审核日期：2026-08-15
> 审核基线：本地 `main`，`HEAD 962213f`，工作树包含未提交用户改动
> 产品范围：当前桌面 MVP、在线预览、V1 规划边界、跨平台发布准备
> 证据口径：源码与冻结文档静态核对、当前工作树测试、Electron 截图和 E2E 报告
> 生命周期：dated review，整改后的动态工程状态以 [`docs/mvp/gate-status.md`](../mvp/gate-status.md) 为准
> 状态：dated review；桌面 MVP 与 Preview P1/P2 整改已在工作树验证，公开签名发布 Gate 仍待关闭

## 1. 结论

当前项目不是“每个设计均达到产品要求”的状态。

| 验收面 | 结论 | 说明 |
| --- | --- | --- |
| 桌面 MVP 核心闭环 | 条件通过 | 本地保存、持久任务、AI 整理、搜索、纠正、删除、导出和备份均有真实实现与测试 |
| 产品设计完整性 | 通过当前 MVP | 桌面与 Preview 已关闭本轮设置错误态、焦点、局部失败、空搜索和键盘弹层问题；安装发布单独受 G4 约束 |
| 在线预览 | 条件通过 | 已明确模拟数据边界并禁用未开放能力；模态可访问性仍待处理 |
| 移动端预览 | 通过桌面产品降级方案 | 窄屏改为可阅读的桌面产品说明，不再裁切交互画布 |
| 公开发布准备 | 不通过 | 干净机矩阵、签名、公证和跨平台安装证据未完成 |
| V1 长期能力 | 未进入当前验收 | 多模态、日报、提醒、向量检索和 Self Model 已明确延期，不作为 MVP 实现缺陷 |

因此，当前候选可继续作为内部 MVP 施工基线，但不能标记为完整产品或公开发布完成。

## 2. 审核基准

文档冲突按 [MVP 执行总纲](../mvp/README.md) 的优先级处理：

1. `docs/mvp/` 冻结执行文档和契约。
2. [PAOPAO-MVP-PLAN.md](../PAOPAO-MVP-PLAN.md) 的当前 MVP 范围。
3. [PAOPAO-V1-PROJECT-SPEC.md](../PAOPAO-V1-PROJECT-SPEC.md) 的成熟 V1 参考。
4. 早期产品架构、Prompt、Coze 与指标文档只作为方向材料。
5. 原型代码和静态预览不自动成为产品契约。

当前 MVP 的可信链路是：

`桌面文字 -> SQLite 原文落盘 -> 持久任务 -> AI 结构化整理 -> 活书房 -> 搜索/纠正/删除/导出`

当前明确不进入 MVP：语音、图片、链接抓取、文件、日报、周报、主动提醒、向量检索、云同步和 Self Model 自动画像。详见 [MVP 执行总纲](../mvp/README.md#42-明确不做)。

## 3. 已达到的要求

### 3.1 本地优先记录闭环

- Renderer 通过 typed IPC 提交文字记录。
- Capture 成功后原文和 Job 已经落入 SQLite，不等待 AI 才返回。
- AI、网络和配置失败不会回滚原文。
- Worker、任务恢复、手动重跑和幂等路径存在真实实现。

### 3.2 活书房真实数据

- 分类数量、列表、详情和搜索来自 SQLite，而非生产假数据。
- 列表标题和预览来自用户当前记录版本。
- 详情提供处理状态、结构化结果、洞察和整理依据。
- 分类、摘要和记录内容支持纠正或 revision。

### 3.3 数据治理与安全

- Provider 凭据使用 Main-only write-only 接口和 `safeStorage`。
- Renderer 不直接获得数据库、文件系统、凭据读取接口或原始 `ipcRenderer`。
- 单条删除、JSON/Markdown 导出、诊断导出和备份恢复均已接入。
- 设置页已经说明凭据与记录内容的不同加密边界。

### 3.4 视觉与运行完整性

- 桌面泡泡透明通道、边缘像素和拖动/点击竞争已有 E2E 证据。
- 活书房当前完整帧在 1180 x 720 测试视口无空白、资源失败或横向溢出。
- 搜索和设置工具位于窗口级安全区。
- 场景图片先解码再切换，当前运行报告未出现黑屏或加载错误。

## 4. 未达到的要求

### P0-01 公开发布门禁未关闭

Windows x64、macOS x64/arm64 干净机安装、升级、卸载、原生指针拖动、公开签名和 macOS notarization 尚未完成。当前发布物只能作为内部候选。

证据：[PROJECT-STATUS.md](../PROJECT-STATUS.md#7-验证状态)、[wave4-local-acceptance.md](../runbooks/wave4-local-acceptance.md#本机不能替代)。

最小收敛方向：先建立可从提交重建的候选，再按平台分别保存安装包、SHA-256、安装/重启/卸载记录和签名状态。

### P0-02 在线预览没有明确演示边界（RESOLVED IN WORKTREE）

`preview/` 固定展示“连续记录 12 天”“817 条记忆”、图片/链接/文件数量、周报、语音和文件入口。脚本实际使用内置样例和 `localStorage`，多模态入口只切换文本提示，聊天回复也是模板逻辑。

证据：[preview/index.html](../../preview/index.html)、[preview/script.js](../../preview/script.js)、[README.md](../../README.md#快速体验)。

2026-08-15 已在当前工作树增加顶部“概念演示 / 隔离模拟数据”声明，移除抬头中的虚构留存和总量指标，禁用链接、语音、文件和网页 AI 对话入口，并将周报明确标为未来概念稿。桌面和窄屏截图保存在 `test-results/preview-review/2026-08-15/`。

### P1-01 记录详情违反冻结术语（RESOLVED IN WORKTREE）

冻结术语要求：

- “记录内容”是用户当前认可的版本。
- “最初记录”只在发生编辑后作为历史依据显示。

审核时 [RecordContent.tsx](../../desktop-app/src/components/RecordContent.tsx) 始终先展示 `rawText`，标题为“原始记录”，修改后的当前版本放在后面。现有 [record-semantics.test.ts](../../desktop-app/test/record-semantics.test.ts) 还把“原始记录”断言为正确文案，因此自动化无法阻止该产品回归。

2026-08-15 已在当前工作树落实：主内容展示 `currentText` 并命名为“记录内容”；仅在 `revised` 时折叠展示 `rawText`，命名为“最初记录”；单元测试和 Electron E2E 已同步。

### P1-02 删除和导出缺少独立快照告知（RESOLVED IN WORKTREE）

冻结契约要求在导出和删除时说明：用户已经复制出去的旧导出是独立快照，删除当前记录不会远程修改这些副本。

审核时 [EntryGovernance.tsx](../../desktop-app/src/components/EntryGovernance.tsx) 的删除确认只说明进入删除状态，[DataManagement.tsx](../../desktop-app/src/components/DataManagement.tsx) 的导出区域也没有快照边界说明。

2026-08-15 已在当前工作树落实：导出区域常驻说明独立副本边界，删除二次确认明确已经复制到其他位置的旧导出不会被删除。

### P1-03 数据管理轮询可能永久停滞（RESOLVED IN WORKTREE）

导出、诊断和恢复状态轮询只在成功时更新状态。单次状态请求失败后，依赖对象不变，effect 不会安排下一轮，UI 可能永久停留在“等待处理”或“正在恢复”。

证据：[DataManagement.tsx](../../desktop-app/src/components/DataManagement.tsx#L32)。

2026-08-15 已在当前工作树落实：导出、诊断和恢复使用带 in-flight 防重入的持续轮询；临时失败显示局部错误且继续检查；恢复期间禁用并发操作，确认态提供取消动作。

### P1-04 设置读取失败被伪装为空态（RESOLVED IN WORKTREE）

设置、Provider 和飞书投递问题读取失败时，主区域仍可能显示“未配置”“还没有配置”或“当前没有投递异常”，错误只写入共用底部状态。用户无法区分真实空态和加载失败。

证据：[SettingsPanel.tsx](../../desktop-app/src/components/SettingsPanel.tsx#L146)。

2026-08-15 已为 AI 服务、飞书公开设置和投递异常建立独立的 loading/error/ready 状态；首次读取失败不再渲染业务空态，局部错误提供重试，已有数据刷新失败时继续保留可用数据。

### P1-05 模态层和场景键盘可达性不完整（RESOLVED IN WORKTREE）

- 阅读层有 `role=dialog`，但没有 `aria-modal`、焦点循环和触发点恢复。
- 设置层是普通 `aside`，打开时没有可靠接管焦点。
- 场景物件焦点轮廓被透明样式覆盖。
- 泡泡的可访问名称宣称双击打开书房，但 Enter/Space 只打开快速记录。

证据：[LibraryReaderSheet.tsx](../../desktop-app/src/components/LibraryReaderSheet.tsx)、[SettingsPanel.tsx](../../desktop-app/src/components/SettingsPanel.tsx)、[PetWindow.tsx](../../desktop-app/src/components/PetWindow.tsx)、[styles.css](../../desktop-app/src/styles.css)。

2026-08-15 已增加共享模态焦点循环与触发点恢复，阅读层和设置层使用 `aria-modal`，场景热点保留可见焦点，泡泡以 `Shift+Enter` 打开活书房；Electron E2E 覆盖焦点不逃逸和键盘动作。

### P1-06 在线预览不支持窄屏（RESOLVED IN WORKTREE）

`preview/styles.css` 在 `html`、`body` 和主场景上强制最小宽度 1180px，并隐藏溢出。390px 移动快照已出现数字、导航和正文裁切。

证据：[preview/styles.css](../../preview/styles.css)、[paopao-mobile.png](../../assets/paopao-mobile.png)。

2026-08-15 已选择桌面产品降级方案：小于 720px 时不渲染被裁切的桌面交互层，改为使用真实书房背景的可阅读产品状态视图。390 x 844 检查确认无横向溢出。

### P2-01 错误状态缺少局部降级（RESOLVED IN WORKTREE）

主书房错误只进入隐藏的 `aria-live` 文本，视觉用户没有直接可见的重试入口；单条详情读取失败会把整个 Library 状态切为 error，导致已有列表上下文丢失。

证据：[LibraryMasterScene.tsx](../../desktop-app/src/components/LibraryMasterScene.tsx#L260)、[LibraryWindow.tsx](../../desktop-app/src/components/LibraryWindow.tsx#L70)。

2026-08-15 已增加场景可见错误/降级提示与重试；分类数量和最近入口失败不再阻断真实列表；详情读取使用独立 loading/error 状态，失败时保留左侧列表和局部重试。

### P2-02 搜索空字符串的行为不明确（RESOLVED IN WORKTREE）

提交空字符串仍打开阅读层，并回退为“最近记录”。这会形成“看似执行搜索，实际打开全部记录”的行为偏差。

证据：[LibraryWindow.tsx](../../desktop-app/src/components/LibraryWindow.tsx#L92)。

2026-08-15 已统一 trim/空值判断；空搜索禁用提交并保持搜索控件打开，不再退化为最近记录。单元测试和 Electron E2E 均覆盖该行为。

### P2-03 指标体系与 MVP 版本脱节（REQUIREMENT RESOLVED）

现有指标仍以 `/profile`、Self Model 修正、主动提醒回流、多模态占比和周复盘为核心，但这些能力不在当前 MVP。当前文档也没有事件定义、采样周期、基线和目标阈值。

证据：[历史 V1 指标](../metrics.md)。

2026-08-15 已建立 [MVP 指标与事件口径](../mvp/metrics.md)，定义北极星、可靠性护栏、事件字段、分母、时间窗和隐私边界。当前尚未实现完整本地聚合与同意流程，因此真实留存和长期价值仍需受控试用验证。

## 5. 页面验收矩阵

| 页面/模块 | 当前结果 | 通过项 | 未关闭项 |
| --- | --- | --- | --- |
| 桌面泡泡 | 通过当前 MVP | 透明、置顶、拖动、单双击竞争；`Shift+Enter` 可打开书房 | 单击需等待双击判定窗口，属于当前交互取舍 |
| 快速记录 | 条件通过 | 空输入、保存中、恢复中、成功、去重、失败保留输入 | “记住/思考”差异仍可优化，后续处理完成状态主要依赖书房 |
| 活书房主场景 | 通过当前 MVP | 日夜主题、真实数量、对象入口、搜索、设置、无空帧、可见错误与焦点反馈 | 持续人工视觉评审不由工程测试关闭 |
| 阅读层 | 通过当前 MVP | 列表、空态、分页、详情、局部失败、焦点约束、依据及记录内容术语 | 无当前 Gate 缺口 |
| 记录治理 | 通过当前 MVP | 分类/摘要纠正、重跑、revision、删除和旧导出告知 | 更完整的删除进度反馈可继续优化 |
| Provider 设置 | 通过当前 MVP | Profile CRUD、激活、探活、write-only 凭据、局部 loading/error/empty | 无当前 Gate 缺口 |
| 数据管理 | 通过当前 MVP | 导出、诊断、备份、恢复、持续轮询、并发控制和快照告知 | 轮询异常仍可增加更深的集成故障注入 |
| 飞书设置 | 不参与 MVP 签收 | 已有实验实现和自动化 | 真实租户验收延期，公开产品不应默认承诺 |
| 在线预览 | 通过当前 MVP | 演示标识、能力边界、未开放控件、移动降级、dialog 语义、焦点约束、Escape 和焦点恢复 | 无当前 Gate 缺口 |
| 安装发布 | 不通过 | macOS arm64 内部候选 | Windows、macOS x64、干净机、签名、公证 |

## 6. 验证证据

本轮在审核时执行：

- `npm run typecheck`：通过。
- `npm run build`：通过。
- `npm test`：通过；最新计数与报告只在 [Gate Status](../mvp/gate-status.md) 维护，避免审核快照复制动态状态。
- `library-master-assets.test.ts`：P5 production manifest、运行 manifest、12 个场景帧尺寸和 approved hash 校验通过。
- `npm run test:e2e`：16 个 Electron 工程验收场景通过。
- Electron 报告：`test-results/e2e-wave4/2026-08-14T18-10-36-018Z/report.json`。
- Preview E2E：5 项通过，覆盖关闭态 inert/aria、初始焦点、Tab/Shift+Tab 约束、Escape、背景关闭、焦点恢复和 390px 无横向溢出；报告为 `test-results/preview-accessibility/2026-08-14T19-06-53-540Z/report.json`。

自动化通过证明工程链路可执行，不等于其余产品需求全部通过。记录语义测试已在本批次修正为冻结术语。

## 7. 收敛状态与后续顺序

1. 已完成：预览演示边界与弹层键盘可访问性、README 能力对账、记录术语、删除/导出告知、数据管理轮询、局部错误、桌面模态焦点、场景焦点和泡泡键盘动作。
2. 已完成：建立当前 MVP 指标口径，并将历史 V1 指标降为未来输入。
3. 已完成：资源白名单、显式旧资源删除、Git LFS 边界和按领域可审计提交。
4. 下一 Gate：推送提交和 annotated tag 后，由正式 release workflow 执行 Windows/macOS 干净 runner、签名、公证与不可变发布矩阵。
5. 多模态、报告、提醒和 Self Model 继续留在 V1 Backlog，未经新 ADR 不提前创建可用入口。

## 8. 审核维护规则

- 每条整改完成后，在本报告中将对应项标记为 `RESOLVED`，并链接测试或人工证据。
- 需求变化必须先更新 `docs/mvp/` 或新增 ADR，再调整实现和本报告。
- 截图和像素检查只证明渲染完整性，不替代人工产品与美术判断。
- 工作树未形成可重建提交前，不以本地截图或未提交源码宣布发布完成。
