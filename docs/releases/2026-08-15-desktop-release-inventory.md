# Desktop Release 目录清单

> 盘点日期：2026-08-15
> 生命周期：dated artifact inventory
> 目录：`desktop-app/release/`（正式发布后已清空，见第 9 节）
> 当前状态：Paopao v0.1.0 已通过 GitHub Release 正式发布；本文档保留各批内部候选的 SHA-256 与轮转记录

## 0. 从可重建提交生成的新候选（2026-08-15 第二批次）

> 生命周期：dated artifact inventory
> 来源：`v0.1.0` annotated tag（`15571a4a2ac2afed0fd67adf728318c062e233ef`）本地重建，与 main 当前 HEAD 一致
> 签名：未签名（本机无 Developer ID 证书）；仅用于可重建性、安装/卸载与结构验证
> 构建命令：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run dist:mac`（本机 macOS arm64，electron-builder 26.0.12）

| 文件 | Bytes | SHA-256 | 架构 | 状态 |
| --- | ---: | --- | --- | --- |
| `Paopao-0.1.0-arm64.dmg` | 180,553,022 | `3fe57f0894a64dcba9da33c5afa3ef918485f91bfce478c3dd26fe6a72963c4c` | arm64 | 内部候选，待签名/公证 |
| `Paopao-0.1.0-arm64.zip` | 174,585,315 | `e8c6bd70d01a0a56275b05dc4dacfdd3146dc1e160df84629425f292e5a947fb` | arm64 | 内部候选，待签名/公证 |
| `Paopao-0.1.0-x64.dmg` | 185,538,771 | `7e25f3cca5ac9cee295506b8abc12ffc7433709dc812a3fed7e6d690c08e4aaf` | x64 | 内部候选，待签名/公证 |
| `Paopao-0.1.0-x64.zip` | 179,492,160 | `1ad4463378d5864d62ffc76846e86ca63943033da36ed37cb71fb9232e735191` | x64 | 内部候选，待签名/公证 |
| `Paopao-0.1.0-arm64.dmg.blockmap` | 189,787 | — | arm64 | 更新元数据 |
| `Paopao-0.1.0-x64.dmg.blockmap` | 194,492 | — | x64 | 更新元数据 |
| `Paopao-0.1.0-arm64.zip.blockmap` | 179,232 | — | arm64 | 更新元数据 |
| `Paopao-0.1.0-x64.zip.blockmap` | 186,230 | — | x64 | 更新元数据 |
| `mac-arm64/泡泡.app` | 目录 | — | arm64 | electron-builder 展开暂存，安装验证后清理 |
| `mac/泡泡.app` | 目录 | — | x64 | electron-builder 展开暂存，安装验证后清理 |


## 0b. Windows x64 NSIS 候选（2026-08-15 第三批次）

> 来源：`v0.1.0` tag（`15571a4`）对应源码，本机 macOS arm64 上 electron-builder 交叉构建
> 签名：未签名（无 Windows 证书，`signAndEditExecutable=false`）；结构验证通过（PE32+ x64 DLL 已正确打入 asar.unpacked）
> 构建命令：`ELECTRON_MIRROR=... ELECTRON_BUILDER_BINARIES_MIRROR=... npx electron-builder --win nsis --x64 -c.npmRebuild=false -c.win.signAndEditExecutable=false`（better-sqlite3 使用 npmmirror 的 electron-v140-win32-x64 预编译二进制预置）

| 文件 | Bytes | SHA-256 | 架构 | 状态 |
| --- | ---: | --- | --- | --- |
| `Paopao-Setup-0.1.0.exe` | 152,724,043 | `81c9afef9b1fbf8d3ff250c12e3a38d5c1db0091f8e2c84a41f72deaac81308a` | x64 | 内部候选，待签名 |
| `Paopao-Setup-0.1.0.exe.blockmap` | 159,520 | — | x64 | 更新元数据 |
| `win-unpacked/泡泡.exe` | 目录 | — | x64 | 展开暂存，验证后清理 |

> 注意：正式 Windows 候选以 release workflow 的 `windows-package` 作业为准（在 windows-latest 干净 runner 上构建并执行安装/卸载矩阵）。

## 0c. 远程 Linux 原生构建候选与冒烟矩阵（2026-08-15）

> 远程机：admin@10.126.126.1（Ubuntu 24.04 x86_64，32 核），源码 rsync 自本机（commit `bf5d91f`）
> 环境：node v22.14.0、npm 11.8.0、git-lfs 3.6.1、xvfb、wine 9.0（仅 NSIS 需要）

### Linux 冒烟（xvfb-run）

- `npm run smoke:preload:runtime`：PASS（退出码 0，sandbox preload runtime smoke passed）。
- `npm run test:e2e:preview`：PASS（6/6 用例，report `test-results/preview-accessibility/2026-08-15T15-25-46-194Z/report.json`）。
- 注：GitHub Linux runner 上该冒烟需要 `chrome-sandbox` SUID 修复（`sudo chown root:root && sudo chmod 4755`），见 ci.yml 步骤。

### Windows x64 NSIS（Linux 原生 electron-builder）

| 文件 | Bytes | SHA-256 | 架构 | 状态 |
| --- | ---: | --- | --- | --- |
| `Paopao-Setup-0.1.0.exe` | 152,783,053 | `6e94072c5b3a29372b93d65d297411d5265641ff24de13554ecab6e2856161fc` | x64 | 内部候选，待签名 |
| `Paopao-Setup-0.1.0.exe.blockmap` | 159,358 | — | x64 | 更新元数据 |

完整报告见 `tmp/REMOTE-REPORT.md`（gitignored 工作产物）。
## 1. 当前候选

顶层安装/更新文件生成于 2026-08-09，版本 `0.1.0`，早于当前 `main@962213f` 和未提交工作树。它们不能证明当前源码状态。

| 文件 | Bytes | SHA-256 | 状态 |
| --- | ---: | --- | --- |
| `Paopao-0.1.0-arm64.dmg` | 145,605,944 | `df5b81179419029077db4dcf52ec407347d9b901b4630fc90c9dca047c8ce300` | macOS arm64 内部安装候选 |
| `Paopao-0.1.0-arm64.dmg.blockmap` | 153,101 | `764fbdfaaf3ac261f9d825e5bf35a8cb9a00c9f94a2bbf9a94825cc9682c35ae` | 对应更新元数据 |
| `Paopao-0.1.0-arm64.zip` | 140,306,202 | `3bc3afaa98758f2b4dae47429283f0e3c40edb1bc5d1421bccfbb5f6fc864f64` | macOS arm64 内部归档候选 |
| `Paopao-0.1.0-arm64.zip.blockmap` | 146,931 | `a32a78ba398588cde7387b04cd8eb20e265ab9fe5cdca187ca9eca1fb4464ceb` | 对应更新元数据 |

以上四项已在删除展开暂存目录后重新计算并确认 SHA-256 不变。

## 2. 已清理的展开和调试输出

| 路径 | 原体量 | 处置 |
| --- | ---: | --- |
| `release/mac-arm64/泡泡.app` | 约 410MB | 2026-08-15 删除；它是 DMG/ZIP 的 electron-builder 展开暂存副本，不承担独立发布证据 |
| `release/mac/Electron.app` | 约 183MB | 2026-08-15 删除；目录不完整、缺少主可执行文件且未签名 |
| `release/builder-debug.yml` | 879 bytes | 2026-08-15 删除；本地 builder 调试记录不作为发布证明 |

当前 `release/` 顶层只保留上一节四个内部候选文件，没有展开应用或中间构建目录。

## 3. 缺失发布证据

- 没有与当前 HEAD/工作树绑定的 commit SHA 或构建 provenance。
- 没有 Windows x64、macOS x64 和当前源码 macOS arm64 的干净机矩阵。
- 没有 Developer ID/Windows 代码签名、macOS notarization 或 Gatekeeper 验证记录。
- 没有安装、重启、升级、卸载和用户数据保留记录。
- 没有远端 CI 产物、release tag 或外部归档位置。

因此当前目录只支持“曾生成内部 arm64 候选”的结论，不支持公开发布。

## 4. 轮转规则

1. 在当前工作树形成可审计提交后，从提交重新构建候选。
2. 新候选记录版本、commit、平台、架构、SHA-256、签名、公证和干净机结果。
3. 新 arm64 候选通过安装验证并完成外部归档后，才可删除 2026-08-09 的 DMG/ZIP 与 blockmap。
4. 展开应用、中间目录和 builder 调试文件不长期保留；本轮已完成清理。
5. 不把 `release/` 加入提交；发布物应由 CI 或明确的外部制品库管理。

## 9. 正式发布与本地清退（2026-08-15）

- **Paopao v0.1.0 已正式发布**：https://github.com/74stars/paopao-ai-avatar-agent/releases/tag/v0.1.0（17 个资产，含 Windows/macOS 安装包、校验和、签名状态与安装冒烟证据；分发策略为 GitHub Release、未签名）。
- 本地 `desktop-app/release/`（约 2.3GB，含本机重建候选与 electron-builder 展开暂存）已按轮转规则清空：正式候选由 GitHub Release 承载，SHA-256 已在本文档第 0/0b/0c 节留存。
- `tmp/REMOTE-REPORT.md` 已迁入版本库：`docs/releases/2026-08-15-remote-build-report.md`。
- `test-results/` 已轮转：每类只保留文档引用与最新报告（e2e-wave4 ×2、e2e-ai-provider ×1、preview-accessibility ×2）。
