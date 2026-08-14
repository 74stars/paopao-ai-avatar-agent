# Desktop Release 目录清单

> 盘点日期：2026-08-15
> 生命周期：dated artifact inventory
> 目录：`desktop-app/release/`，扫除后约 273MB
> 结论：仅保留作内部历史候选；不可视为当前提交的可重建公开发布物

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
