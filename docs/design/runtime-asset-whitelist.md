# Desktop 生产资源白名单

> 生成日期：2026-08-15
> 适用范围：`desktop-app/public/assets`、`desktop-app/build` 与活书房生产母版
> 原则：运行引用、构建输入、生产母版和历史归档分别判断；同 hash 不自动等于可删除

## 1. 结论

- 当前活书房运行主链是 `LibraryWindow -> LibraryScene -> LibraryMasterScene -> public/assets/library-master-v1`。
- `library-master-v1` 有 1 个 manifest 和 12 个完整场景帧，共 13 个文件；12 个帧总计 30,630,715 bytes，均能按 SHA-256 追溯到 production manifest 的 approved 候选。
- `LibraryWorld.tsx` 与 v4/v4.1 的 design/public 副本已在确认 Renderer 无引用后按显式清单删除；旧资源此前进入构建只因 Vite 整体复制 `public/`，不是运行时回退加载。
- 删除批次覆盖 221 个文件、49,925,560 bytes；逐路径 hash、字节数和替代链见 [legacy removal manifest](./2026-08-15-legacy-library-removal-manifest.md)。
- production manifest P5 已修正为真实相对路径；`library-master-assets.test.ts` 持续校验 manifest hash、12 个运行帧尺寸及 approved 来源，当前 E2E 证据为 `test-results/e2e-wave4/2026-08-14T18-10-36-018Z/report.json`。

## 2. 活书房运行帧

运行目录：`desktop-app/public/assets/library-master-v1/`

运行 manifest SHA-256：`c943b8911758ca3b69b064512f8656c717c4a7f5761993705cb97ba3511da94e`

| 文件 | Bytes | SHA-256 | approved 生产来源 |
| --- | ---: | --- | --- |
| `day-idle.png` | 2,911,500 | `9943bee444ffaaeb1e058f48767604514c3f67506a51d8f0b09507dfa803f693` | `working/p2-day-global-lighting-repair-v1.png` |
| `day-correspondence-letter-lift.png` | 2,619,638 | `a00758dfc41d8373f4834f93c09ff75e3c17b5021ffb939be65242005895475b` | `working/p3-day-rederive-letter-lift-day-v2.png` |
| `day-books-diary-pull.png` | 2,893,236 | `a35616975398c08a60907d537c833de3c123b7d35855184e068ef176f9118b41` | `working/p3-day-rederive-diary-pull-day-v2.png` |
| `day-books-memory-pull.png` | 2,532,619 | `62f71ac6e5b25f4dcf6384c2fb17f5d10a2ab1daa261b6797d95b92d4e6eddca` | `working/p3-day-rederive-memory-pull-day-v2.png` |
| `day-books-third-group-pull.png` | 2,496,487 | `fdc0c0c6e143249bc4b073d3324fc1bab10d215606f7d94767a4acef03fb9b78` | `working/p3-day-rederive-third-group-pull-day-v2.png` |
| `day-books-fourth-group-pull.png` | 2,522,379 | `58256e8cbb16d3513ddf5346e1930b1bd2bc356ff2ef680852521f50228a56f2` | `working/p3-day-rederive-fourth-group-pull-day-v2.png` |
| `night-idle.png` | 2,489,573 | `813d0a21444ff92ad00e4bf650881db9301056aeb3cda494d330c1b981af8019` | `working/normalized/p4-night-idle-v2-1800x1126.png` |
| `night-correspondence-letter-lift.png` | 2,435,254 | `00d46e0a0f5e99fe3d8e2e818c1dfd35ea8150cc8f95c1dc74beff984d8eb21f` | `working/p4-night-correspondence-letter-lift-v3.png` |
| `night-books-diary-pull.png` | 2,429,819 | `e6dbfc3394e794e899ae61b239e3a41842f2e363a88c2b6061877b373021804f` | `working/p4-night-category-books-diary-pull-v2.png` |
| `night-books-memory-pull.png` | 2,435,268 | `6ba8fc3e227c897273aa6657a185735c94500443e75d23afe51a05ae3a6fb343` | `working/p4-night-category-books-memory-pull-v2.png` |
| `night-books-third-group-pull.png` | 2,425,496 | `60d72669aa7747229c3459747903be4e0fa3604291ac8558e67d4cf660fb8a37` | `working/p4-night-category-books-third-group-pull-v2.png` |
| `night-books-fourth-group-pull.png` | 2,439,446 | `9ec57448e1e55f19026d8732bfceeef5732282eadf55264c35683cdde7ce40ec` | `working/p4-night-category-books-fourth-group-pull-v2.png` |

保护规则：上述 13 个文件、production manifest 及表中 approved 来源在替代运行包完成同等级验证前不得删除或改名。

## 3. 顶层 public 与打包资源

| 文件或分组 | 结论 | 证据/下一动作 |
| --- | --- | --- |
| `public/assets/app-icon.png` | 必须保留 | BrowserWindow、开发态 Dock 和打包运行引用；与 `build/icon.png` 同 hash 是有意的部署副本 |
| `public/assets/trayTemplate.png`、`trayTemplate@2x.png` | 必须保留 | macOS tray 运行资源及高 DPR 配套 |
| `public/assets/tray.ico` | 必须保留 | Windows tray 运行资源 |
| `public/assets/tray.png` | 必须保留 | Linux/其他平台 tray 运行资源 |
| `public/assets/trayTemplate.svg`、`trayWindows.svg` | 必须保留 | `generate-icons.mjs` 的可再生母版输入 |
| `build/icon.svg`、`icon.png`、`icon.icns`、`icon.ico` | 必须保留 | electron-builder 的 `buildResources` 和平台打包输入，不是普通 dist |
| `public/assets/library-day.webp`、`library-night.webp` | 已删除 | 未被产品调用的 `libraryThemeAsset` helper 与对应路径断言已移除；design 母版继续保留 |
| `public/assets/paopao.png`、`paopao.webp` | 已删除 | 当前泡泡由 `BubbleLife` SVG 渲染；preview 使用自己的独立视觉资产 |
| `public/assets/tray.svg` | 已删除 | 无运行、生成脚本或产品文档引用；2026-08-15 删除后 `icons:check`、全量测试和 E2E 通过 |
| public `library-world-v4`、`library-world-v4-1` | 已删除 | 与 dead `LibraryWorld.tsx` 和 design 历史副本同批处理；逐文件证据见 removal manifest |

## 4. Design 工作区分层

| 分层 | 处置 |
| --- | --- |
| `source/`、`manifest.production.json`、approved candidates | 生产母版与决策事实，必须保留；二进制媒体进入 Git LFS |
| approved 状态对应 masks/prompts/reviews | 承担可复现与审计职责；文本普通 Git，PNG/WebP 进入 Git LFS |
| reference-only/failed/superseded working 输出 | v0.1.0 基线暂保留于 Git LFS；未来删除前生成逐路径、hash、bytes 和替代物清单 |
| design v4/v4.1 | 已与 public 的 108 个逐字节副本和 dead Renderer 一并删除；证据见 removal manifest |

## 5. 删除批次状态

1. [x] 删除 dead `LibraryWorld.tsx`；`LibraryShelf.tsx` 继续作为共享业务元数据保留。
2. [x] 移除 `libraryThemeAsset`、旧路径断言和两张 public 顶层 library WebP。
3. [x] 对 v4/v4.1、public paopao 和相关源码生成精确删除清单后删除；无引用的 `tray.svg` 也已删除。
4. [ ] 在最终 release gate 中再次完成 Renderer build、资源检查和 Electron E2E。
5. [x] design 生产工作区采用 Git LFS；public 运行资源继续使用普通 Git。
