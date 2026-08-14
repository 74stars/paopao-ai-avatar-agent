# Paopao 项目收敛与清理计划

> 建立日期：2026-08-15
> 当前阶段：Phase 5，桌面产品与资源收敛已完成，正在形成 `v0.1.0` 可重建发布基线
> 原则：保护用户改动、先证明引用再删除、生产资产与过程资产分离、可再生物不进入版本库

## 1. 当前状态摘要

### Git

- 分支和文件数量属于动态事实，只在 [当前 Gate 状态](./mvp/gate-status.md) 与有日期的 [工作树变更清单](./reviews/2026-08-15-worktree-change-manifest.md) 中记录。
- 本轮核对确认没有额外本地分支可清理；当前主要风险仍是单一分支的工作树混合了产品文案、UI、AI、备份、旧机器人和大体积美术资产变更。
- 本计划只维护清理原则、阶段和执行记录，不再复制 HEAD、远端 SHA 或文件计数。

### 本轮体量快照

| 路径 | 扫除后体量 | 初步分类 |
| --- | ---: | --- |
| `node_modules/` | 962MB | 可再生依赖，开发期间保留 |
| `desktop-app/release/` | 273MB | 仅保留已记录 SHA-256 的 DMG/ZIP 与 blockmap，展开暂存目录已删除 |
| `desktop-app/design/` | 396MB | 生产母版、评审和生成过程；PNG/WebP 由 Git LFS 管理，禁止直接整目录清理 |
| `test-results/` | 37MB | 保留当前成功、最近失败、静态设计和 Preview 证据 |
| `tmp/` | 17MB | 5 个已有正式副本的重复文件已删除，其余 28 个独有生图输入待归档决策 |
| `desktop-app/public/assets/` | 29MB | 运行与部署资源；旧 v4/v4.1 和未引用顶层资源已按清单删除 |
| `assets/` | 1.9MB | 根 README 和历史截图，需区分当前展示与历史原型 |
| `preview/assets/` | 492KB | 在线预览运行资源 |
| `prototype/` | 32KB | 早期原型，当前已明确为历史材料 |

## 2. 清理分类

### A. 必须保留

- 当前 MVP 源码、测试、Schema、migration 和 Prompt Registry 使用的 Prompt 版本。
- `desktop-app/public/assets/library-master-v1/` 中运行 manifest 引用的完整帧。
- 图标生成母版、构建检查脚本和打包需要的 icon/tray 资源。
- `docs/mvp/`、ADR、当前 runbook、产品审核报告和当前项目状态。
- 至少一份可复现的当前 Electron E2E 报告和一份 Provider E2E 报告。
- 当前内部发布候选，直到其版本、SHA-256、平台和替代产物已经记录。

### B. 可直接清理候选

以下仅在确认没有正在运行的构建/测试后处理：

- `.DS_Store`、`Thumbs.db`。
- `desktop-app/dist/`、`desktop-app/dist-electron/`，但当前 workspace 开发解析依赖构建输出，只能在紧接完整 rebuild 的批次中清理。
- `packages/*/dist/`、`adapters/*/dist/`，同样必须在删除后按依赖顺序立即重建，否则桌面类型检查和 Vitest 无法解析 workspace package。
- 已被后续同类 E2E 完整替代的失败或中间测试运行目录。

这些内容均已在 `.gitignore` 中，不应成为提交的一部分。

### C. 需要清单后再清理

- `test-results/`：先选定每类证据的“当前保留 run”，再删除更早重复运行。
- `desktop-app/release/`：先生成 release manifest，再按版本和架构去重。
- `tmp/`：先排除仍被美术生产文档、mask 或恢复流程引用的输入。
- `desktop-app/design/assets/library-world-master-v1/working/`：多数是生成过程资产，但需与 production manifest 和评审文档逐一核对。
- `reviews/` 下的并排图和过程截图：v0.1.0 基线保留，二进制媒体进入 Git LFS；未来精简仍需逐文件清单。
- 根 `assets/paopao-dashboard.png` 和 `assets/paopao-mobile.png`：属于早期 Web 方案，不能继续当作当前桌面产品截图，但可作为历史设计记录。

### D. 当前禁止清理

- 任何 tracked 或 untracked 的源码、测试、Prompt、migration、manifest 和图标生成脚本。
- [工作树变更清单](./reviews/2026-08-15-worktree-change-manifest.md) 记录的全部 tracked 差异；在逐 hunk 确认归属前，全部按用户工作保护。
- `desktop-app/design/assets/library-world-master-v1/manifest.production.json`、`regions.production.json` 及其引用资源。
- 尚未建立替代证据的最新 E2E 和内部发布候选。
- 未确认是否需要迁移的 `feishu-bot/` 历史实现。它应先被明确标记为 legacy，再决定归档或删除。

## 3. 文档信息架构

文档入口统一由 [docs/README.md](./README.md) 维护。

| 层级 | 文档 | 作用 |
| --- | --- | --- |
| L0 当前执行契约 | `docs/mvp/README.md`、`contracts.md`、`implementation-plan.md` | 冻结当前 MVP 做什么、接口和施工顺序 |
| L1 当前范围 | `PAOPAO-MVP-PLAN.md` | 产品范围与验收口径 |
| L2 未来规格 | `PAOPAO-V1-PROJECT-SPEC.md` | 成熟 V1 参考，不覆盖 MVP 契约 |
| L3 当前状态与评审 | `PROJECT-STATUS.md`、`mvp/gate-status.md`、`reviews/` | 记录事实、Gate 和审核结论 |
| L4 决策 | `adr/` | 跨模块和范围变化 |
| L5 操作证据 | `runbooks/` | 验收和运行步骤 |
| L6 设计生产 | `design/` | 当前活书房美术生产与交互约束 |
| 历史方向 | `product-architecture.md`、`prompt-design.md`、`coze-workflow.md`、`metrics.md` | 早期方向，需增加历史/未来标签 |
| 历史实现 | `prototype/`、`feishu-bot/` | 不进入当前运行路径 |

## 4. 分批施工

### Phase 0：固化事实

- [x] 保存产品需求审核报告。
- [x] 建立 docs 权威索引。
- [x] 记录 Git、目录体量和清理分类。
- [x] 为当前未提交改动生成按领域分组的 change manifest，见 [工作树变更清单](./reviews/2026-08-15-worktree-change-manifest.md)。
- [x] 标记当前最新 E2E、Provider E2E 和 release 候选。

退出条件：任何人都能判断一个文件是当前生产输入、历史材料、过程资产还是可再生输出。

### Phase 1：收敛工作树

建议按以下顺序形成独立提交，不把工作树中的跨领域差异压成一个混合提交：

1. 契约、Prompt 与基础设施修复。
2. 数据导出、备份和安全修复。
3. Electron 窗口、手势和 preload。
4. Renderer 产品文案、状态和可访问性。
5. 图标、运行时美术资源和 manifest。
6. 在线 preview 边界修复。
7. 文档、状态与审核记录。
8. legacy feishu-bot 修复或归档声明。

每组提交前后运行对应测试；全部完成后再运行全量 `typecheck`、`test`、`build` 和 Electron E2E。

### Phase 2：关闭产品审核问题

- [x] P0 在线预览能力边界。
- [x] P1 记录内容语义。
- [x] P1 删除/导出独立快照告知。
- [x] P1 数据管理轮询和恢复并发控制。
- [x] P1 设置局部错误态。
- [x] P1 桌面模态焦点和场景键盘可达性。
- [x] P2 局部错误降级、空搜索和 MVP 指标。
- [x] Preview 弹层 dialog 语义、inert 关闭态、焦点约束、Escape 和焦点恢复。

### Phase 3：资源归档和去重

- [x] 从 production manifest 固化运行时资源白名单，并用测试校验 P5 路径、manifest hash、12 个帧和 approved 来源。
- [x] 对 public、preview、design master 与 tmp 计算 SHA-256，标记完全重复项和职责边界。
- [ ] 将 working/masks/prompts/reviews 与最终生产帧分离。
- [x] 决定大体积过程资产的归属：design PNG/WebP 使用 Git LFS，public 运行资源使用普通 Git。
- [x] 首个显式删除批次先生成路径、hash 和总字节数，再删除 dead `LibraryWorld.tsx`、v4/v4.1 design/public 副本及未引用顶层资源。
- [ ] 后续每个删除批次继续先生成路径清单和总字节数，再执行删除。

### Phase 4：快照与发布产物轮转

- [x] `test-results/e2e-wave4` 只保留当前通过基线和最近失败样本。
- [x] `test-results/e2e-ai-provider` 只保留当前通过基线和最近失败样本。
- [ ] 视觉评审只保留当前最终图和必要决策对照。
- [x] release 产物按版本/平台/架构建立清单和 SHA-256，并删除不完整或可再生的展开暂存目录。
- [ ] 清理其余可再生 dist、旧日志和已完成迁移的临时目录。

### Phase 5：分支和远端基线

当前没有分支可扫除。本阶段重点是：

- [x] 审阅原有本地提交及本轮按领域提交的范围和生成物边界。
- [x] 把当前工作树收敛为数据、Feishu、Electron、Desktop/Library、Preview、release 和文档提交。
- [x] design PNG/WebP 使用 Git LFS，public 运行资源保持普通 Git；LFS authenticated dry-run 通过。
- [ ] 推送后由远端 CI 重建并验证候选。
- [ ] 在发布节点建立 annotated version tag，而不是依赖本地目录名判断版本。

## 5. 2026-08-15 首批执行记录

### 已清理

- 操作系统元数据：仓库内已发现的 `.DS_Store`。
- 临时环境与检查副本：`tmp/imagegen/.venv`、`tmp/inspect`、`tmp/library-review`、`desktop-app/tmp`。
- 外部参考副本：`tmp/imagen-reference`、`tmp/frp-reference`；它们不承担项目知识或运行职责。
- 旧测试运行：Wave 4 与 Provider 的重复时间戳目录，只保留当前成功和最近失败；保留静态设计检查并新增 Preview 检查。
- 编译输出曾清理后按仓库依赖顺序完整重建，确认这些目录当前不能长期缺失。

### 空间变化

- `test-results`：169MB -> 39MB。
- `tmp`：68MB -> 23MB。
- 本批净释放约 175MB，不含曾删除后重新生成的 build/dist。
- `desktop-app/release` 866MB、`desktop-app/design` 420MB、`node_modules` 962MB 均未处理。

### 验证

- `npm run build`：通过。
- `npm test`：153 Desktop、82 Infrastructure、40 Feishu Adapter、4 跨层安全和 1 Offline eval 全部通过。
- `npm run test:e2e`：15 个工程验收场景通过。
- Preview：桌面演示声明可见；10 个未来能力控件禁用；390px 窄屏无横向溢出。

## 6. 2026-08-15 第二批执行记录

### 已固化

- P5 `runtimeManifest` 与 `runtimeAssetDirectory` 修正为从 production manifest 可解析的真实 `desktop-app/public/assets/library-master-v1` 路径。
- `library-master-assets.test.ts` 校验运行 manifest SHA-256、12 个帧尺寸与 approved candidate hash；production manifest 中 180 条路径核对为 180 条存在、0 条缺失。
- 确认 `LibraryMasterScene` 是当前 library surface 唯一可达场景；旧资源进入构建源于 Vite 复制 `public/`，不是运行时回退。随后按 [显式删除清单](./design/2026-08-15-legacy-library-removal-manifest.md) 移除 `LibraryWorld.tsx`、v4/v4.1 design/public 副本及未引用顶层资源。
- 建立 [生产资源白名单](./design/runtime-asset-whitelist.md) 与 [release 清单](./releases/2026-08-15-desktop-release-inventory.md)。
- 最终 E2E 首轮暴露窗口可见性时序抖动，次轮暴露阅读层下一帧焦点竞态；后者改为 `useLayoutEffect` 同步聚焦后，当前 16 项 E2E 全部通过，报告为 `test-results/e2e-wave4/2026-08-14T18-10-36-018Z/report.json`。

### 已清理

- 删除 `release/mac-arm64` 的 410MB electron-builder 展开暂存目录；保留并重新核对 DMG/ZIP 与 blockmap SHA-256。更早的不完整 `release/mac` 和 `builder-debug.yml` 也已移除。
- Wave 4 E2E 删除两个被最新 16 项 PASS 完整替代的中间 PASS run，只保留最近失败样本与当前成功基线。
- `tmp` 删除 5 个已有 design/public 正式同 hash 副本的文件，共 6,227,062 bytes；其余 28 个独有文件不直接删除。
- 本批体量由 `release 683MB + test-results 64MB + tmp 23MB` 收敛为 `273MB + 37MB + 17MB`，净释放约 443MB。

### 后续顺序

1. 按 change manifest 完成剩余文档与 release 自动化提交。
2. 上传 Git LFS 对象、推送提交并建立 annotated `v0.1.0` tag。
3. 运行完整 release gate，并从 tag 生成 Windows/macOS 产物与 checksums。
4. 在签名、公证和干净 runner 安装证据满足前，将产物明确标记为未签名内部候选，不宣称正式发布。

## 7. 每批清理的安全规则

1. 删除前记录路径、引用搜索、hash、体量和替代物。
2. 不对当前 dirty worktree 执行 `reset`、`checkout --`、`clean -fd` 或全仓格式化。
3. 不把“已被 ignore”当作“可以删除”的充分条件。
4. 生产 manifest、构建脚本和 README 引用任一命中时，默认保留并人工复核。
5. 大体积二进制先移入明确归档位置或确认可再生，再删除原件。
6. 清理后至少运行资源存在性检查、Renderer build 和相关 E2E。
7. 每轮更新本计划的已完成项、释放空间和残余风险。
