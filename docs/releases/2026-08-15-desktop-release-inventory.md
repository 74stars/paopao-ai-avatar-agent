# Desktop Release 目录清单

> 盘点日期：2026-08-15
> 生命周期：dated artifact inventory
> 目录：`desktop-app/release/`，扫除后约 273MB
> 结论：仅保留作内部历史候选；不可视为当前提交的可重建公开发布物

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
