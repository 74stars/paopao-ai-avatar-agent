# Paopao 非美术状态快照（2026-08-13）

> 生命周期：historical snapshot，不再作为动态状态源。
> 当前状态权威：[`docs/mvp/gate-status.md`](./mvp/gate-status.md)。
> 范围：项目除美术/视觉设计评审以外的工程、数据、验证、发布与治理状态。
> 本文只记录 2026-08-13 当日可核对的工程事实；不产出美术 PASS/FAIL，也不定义当前候选画面。

## 1. 项目定位与当前范围

Paopao 泡泡是一个本地优先的 macOS/Windows 桌面记忆 Agent。MVP 链路为：

```text
桌面文字 -> SQLite 原文落盘 -> 持久任务 -> AI 结构化整理 -> 活书房 -> 搜索/纠正/删除/导出
```

当前 MVP 只做：

- 桌面文字录入，默认 `remember`，可选 `think`。
- SQLite 本地权威数据、持久化任务、启动恢复、FTS5 搜索。
- 多个命名 AI Provider Profile、单 active Profile、OpenAI 兼容 Direct 或 Codex 渠道复用。
- 活书房真实列表/详情/状态/来源、分类与摘要纠正、revision、删除、导出、备份恢复。
- Windows 10/11 x64 NSIS 与 macOS 12+ x64/arm64 DMG/ZIP 发布目标。

明确不在当前 MVP：

- 飞书连接器正式发布与真实租户验收（已 DEFERRED，见 ADR 0004）。
- 语音、图片、链接、文件、日报、周报、向量检索、云同步、Self Model 自动画像。

## 2. Git 与工作树

- 分支：`main`，上游：`https://github.com/74stars/paopao-ai-avatar-agent.git`。
- `HEAD`：`17e2ba4 docs: add MVP status ADRs and non-art runbooks`。
- `origin/main`：仍为 `c08fa15`；本次本地整理尚未推送，远端还不能从源码重建当前候选。
- 非美术源码、测试、CI 与文档已按主题分 7 个本地提交；仅美术资源仍为未提交/未跟踪状态。
- 剩余未提交内容集中在：`desktop-app/design/`、`desktop-app/public/assets/`、`docs/design/`、`preview/assets/`。
- `.gitignore` 已忽略 `node_modules/`、构建产物、`desktop-app/release/`、`test-results/`、`*.log`、`.env`、`tmp/` 与 packages/adapters 的 `dist/`。

## 3. 工程基线

- Node 要求：`>=22.14.0 <25`；本机当前 `node v24.18.0`、`npm 11.16.0`。
- npm workspace：
  - `paopao-desktop`
  - `@paopao/domain`
  - `@paopao/contracts`
  - `@paopao/core`
  - `@paopao/infrastructure`
  - `@paopao/feishu-adapter`
- 依赖方向：`contracts -> domain`，`core -> contracts/domain`，`infrastructure -> core/contracts`，`feishu-adapter -> core/contracts`，`desktop Main -> core/infra/feishu/contracts`，`Renderer -> contracts`。
- 主要锁定工具：Electron `39.2.7`、TypeScript `5.9.3`、Vite `7.2.7`、React `19.2.0`、better-sqlite3 `12.6.2`、zod `4.2.1`。
- CI 文件：
  - `.github/workflows/ci.yml`：Linux checks、Windows x64 E2E + NSIS、macOS x64/arm64 package smoke。
  - `.github/workflows/pages.yml`：部署在线 `preview/`。

## 4. Gate 状态

| Gate | 状态 | 说明 |
| --- | --- | --- |
| G0 工程基线 | COMPLETE | workspace、lockfile、构建、CI、Electron 安全边界已建立 |
| G1 本地闭环 | COMPLETE | Capture、SQLite、持久任务、启动恢复、真实查询已接通 |
| G2 AI 与可治理记忆 | COMPLETE | Provider、整理、洞察、检索、纠正、删除、导出、备份已接通 |
| G3 飞书连接器 | DEFERRED | 自动化实现与验证已有，但真实企业租户验收未执行，不阻塞 MVP |
| G4 产品化发布 | ACTIVE | 仍有 Git 基线、跨平台包、签名/notarization 等发布阻塞 |

## 5. 非美术源码模块

### 5.1 包与适配器

- `packages/domain/src/index.ts`：Entry/Job 状态机和合法转换。
- `packages/contracts/src/index.ts`：Zod v1 契约、DTO、错误码、IPC 请求/响应 Schema、fixtures 与契约测试。
- `packages/core/src/ports/*`：
  - `capture.ts`：CaptureService/UnitOfWork。
  - `jobs.ts`：JobRepository、租约、重试、等待、失败终态。
  - `processing.ts`、`insight.ts`：分析/洞察执行端口。
  - `binding.ts`、`external-delivery.ts`：飞书绑定与投递端口。
  - `runtime.ts`：Clock、IdGenerator、DomainEventPublisher。
- `packages/core/src/services/*`：
  - `capture-service.ts`、`worker.ts`、`analyze-job-executor.ts`、`insight-job-executor.ts`。
  - `binding-service.ts`、`external-delivery-service.ts`。
- `packages/infrastructure/src/database/*`：
  - SQLite 初始化/迁移、Capture UoW、分析/洞察 UoW、Entry 查询、治理、删除、导出、飞书 binding/delivery repository。
  - migrations：`001_initial.sql`、`002_wave3_binding_delivery.sql`、`003_binding_operation_outcomes.sql`，当前 schema version 为 3。
- `packages/infrastructure/src/ai/*`：
  - OpenAI 兼容 Provider、结构化输出 + 一次 repair、Prompt Registry、分析和洞察 service、错误脱敏。
- `packages/infrastructure/src/backup/*`：
  - 文件备份、启动/迁移前/恢复前备份、恢复 journal 与回滚。
- `packages/infrastructure/src/scheduler/sqlite-job-repository.ts`：
  - SQLite 持久队列、fencing、租约恢复、网络/配置等待。
- `adapters/feishu/src/*`：
  - 官方 SDK 长连接、消息幂等、绑定、回复与 delivery；保留为 post-MVP 增量。

### 5.2 Electron Main

- `desktop-app/electron/main.ts`：窗口生命周期、托盘、快捷键、启动失败处理、窗口 IPC。
- `desktop-app/electron/composition.ts`：唯一 composition root，组装数据库、服务、Worker、Provider、飞书 Adapter、备份恢复。
- `desktop-app/electron/ipc.ts`：typed IPC 路由与 `Result<T>` 边界。
- `desktop-app/electron/preload.ts` + `preload-shared/`：隔离 preload、可验证 sandbox bundle、窗口/AI/维护契约。
- `desktop-app/electron/credential-store.ts`：safeStorage 凭据文件。
- `desktop-app/electron/provider-profile-store.ts`：最多 32 个命名 Profile、active 单例、generation 缓存失效。
- `desktop-app/electron/ai-provider-services.ts`：Profile 解析、Direct/Codex Provider factory、探活。
- `desktop-app/electron/codex-provider.ts`：受限 Codex 子进程结构化输出。
- `desktop-app/electron/pet-gesture.ts`：泡泡整窗原生拖动下的 Main 侧点击/双击识别。

### 5.3 Renderer

- `desktop-app/src/App.tsx`：按 `surface` 路由到 pet/capture/library。
- `PetWindow.tsx`、`CaptureWindow.tsx`、`LibraryWindow.tsx`：三窗口交互。
- `LibraryState.tsx`、`LibraryShelf.tsx`、`LibraryReaderSheet.tsx`、`RecordContent.tsx`：书房列表、详情与阅读。
- `EntryGovernance.tsx`、`DataManagement.tsx`、`SettingsPanel.tsx`：纠正、数据控制、Provider 与飞书设置。
- `library-detail.ts`、`library-theme.ts`、`error-messages.ts`：状态推导、主题与错误文案。

### 5.4 测试与评测

- `packages/contracts/test/contract.test.ts`
- `packages/domain/test/status.test.ts`
- `packages/infrastructure/test/ai|backup|database/*.test.ts`
- `adapters/feishu/test/*.test.ts`
- `desktop-app/test/*.test.ts`
- `tests/integration/wave3-g3.test.mts`
- `tests/security/wave3-boundaries.test.mts`
- `tests/e2e/electron-wave4.e2e.cjs`
- `tests/e2e/electron-ai-provider.e2e.cjs`
- `evals/runners/offline.mts` + 6 组 fixtures，硬门禁含 schema、证据、检索、引用与注入副作用。

## 6. 数据与安全

- SQLite 是本地唯一权威数据源；Entry、revision、Job、derivation、memory、FTS5、AI run、导出、备份均以事务边界维护。
- `rawText` 不可变，编辑创建 revision；`currentText` 为当前认可版本。
- 所有 ID 为 UUID，跨进程时间为 UTC ISO 8601，IPC 使用 `Result<T>`，错误码冻结为 v1 枚举。
- Renderer 边界：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`、`webviewTag: false`、`webSecurity: true`。
- 凭据写路径只进 Main；Provider API Key 使用 Electron `safeStorage`，Renderer 无读回接口。
- 日志与诊断导出要求脱敏，禁止回显原文、Prompt、Key、Secret、Token、飞书正文。
- 数据删除走 `deleting -> purged` 与 canary purge 检查；导出包含 manifest 与 SHA-256。

## 7. 验证状态

以下结果来自当前仓库内已有报告，本次整理未重跑全量测试：

- Desktop：136 项通过（现存报告口径）。
- Infrastructure：79 项通过。
- Feishu Adapter：38 项通过。
- G3 跨层与安全：4 项通过。
- Offline eval：1 项通过。
- Electron Wave 4 E2E：11 项通过；最新报告 `test-results/e2e-wave4/2026-08-11T12-16-11-691Z/report.json` 为 `PASS`。
- AI Provider E2E：`PASS`；报告 `test-results/e2e-ai-provider/2026-08-11T08-01-50-504Z/report.json`。

现有 E2E 证据覆盖：Renderer 安全边界、泡泡透明像素、书房渲染完整性、三窗口拖动/点击、Provider write-only、Capture 落库、书房重开、资源加载无错。平台为 `darwin/arm64`。

仍缺少的可执行验证：

- Windows 10/11 x64 干净机安装/启动/卸载。
- macOS x64 干净机验证。
- macOS arm64 干净机验证（当前只有本机运行，不等于干净机）。
- 操作系统原生 app-region 指针拖动。
- 公共代码签名与 macOS notarization。
- 当前工作树的远端 CI 重跑（因为本地提交尚未推送到远端）。

## 8. 发布产物

当前 `desktop-app/release/` 只有内部 macOS arm64 候选：

- `Paopao-0.1.0-arm64.dmg`
- `Paopao-0.1.0-arm64.zip`

缺少：

- Windows x64 NSIS。
- macOS x64 DMG/ZIP。
- 正式签名/notarization 与公开 Release 标记。

## 9. 当前阻塞项

- 本地非美术 Git 基线已建立，但尚未推送：`origin/main` 仍停留在 `c08fa15`，远端不能重建当前候选。
- 跨平台发布矩阵未完成。
- 签名与 notarization 未完成。
- `tmp/` 已加入 `.gitignore`，但临时生图/参考目录仍保留在磁盘上，尚未物理清理。
- 飞书为 DEFERRED，非阻塞项；真实租户验收留待 post-MVP。

## 10. 下一步建议

1. 确认本地 7 个非美术提交无误后，再决定是否推送；推送前继续核对 `tmp/`、`desktop-app/release/`、`test-results/` 与美术临时产物的物理清理策略。
2. 在干净环境中执行 `npm ci`、`npm run typecheck`、`npm test`、`npm run build`、`npm run smoke:preload:runtime`，把现有本机报告升级为可复现远端证据。
3. 补 Windows x64 与 macOS x64/arm64 的安装包、SHA-256 与干净机 smoke。
4. 产品签收前完成 README 能力对账、签名/notarization 决策和已知限制记录。
5. 飞书连接器继续作为 post-MVP 增量维护，不进入当前发布门禁。
