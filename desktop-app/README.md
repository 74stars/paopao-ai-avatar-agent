# 泡泡桌面应用

一个 macOS/Windows 桌面常驻的本地优先文字记录入口。泡泡先把原文保存在本机，再自动整理进活书房。

## 三个窗口

- 桌面泡泡：透明、置顶、可拖动靠边，单击记录、双击打开活书房。
- 快速记录：`Ctrl+Shift+Space` 唤起，支持“记住”和“思考”两种模式。
- 活书房：日记、思想、人物、阅读和目标按真实书脊生长。

## 本地开发

```powershell
cd ..
npm.cmd install
npm.cmd run dev --workspace=paopao-desktop
```

macOS/Linux：

```bash
cd ..
npm install
npm run dev --workspace=paopao-desktop
```

构建 Windows 安装包：

```powershell
cd ..
npm.cmd run dist:win
```

构建 macOS DMG/ZIP（x64 与 arm64）：

```bash
npm run dist:mac
```

## 图标与封装资源

- `build/icon.svg` 是应用图标矢量母版，生成的 `icon.icns` 和 `icon.ico` 分别用于 macOS 与 Windows。
- `public/assets/trayTemplate.svg` 是 macOS 状态栏图标母版，使用 16px/32px Template Image 自动适配深浅菜单栏；Windows 从独立的彩色 `trayWindows.svg` 生成多尺寸 `tray.ico`，避免深色任务栏黑边。
- 在 macOS 上运行 `npm run icons:generate --workspace=paopao-desktop` 可重新生成全部图标产物。
- `npm run icons:check --workspace=paopao-desktop` 检查格式、尺寸和多尺寸容器；正式封装前会自动执行。
- 应用产品名固定为“泡泡”，Windows 使用 `com.paopao.desktop` 作为 AppUserModelID；开发模式的任务管理器仍可能显示 Electron 宿主进程名。

仓库已具备未签名安装包的构建配置。对外发布前仍需配置 Windows 代码签名，以及 macOS Developer ID 签名、公证和 Stapling。

## 数据与隐私

- SQLite 数据库保存在 Electron `userData` 目录。
- API 密钥使用当前操作系统的 Electron `safeStorage` 加密。
- 凭据只以密文写入 `userData/secrets/credentials.v1.json`，渲染进程只能读取配置状态，永远读不回 Key。
- 剪贴板建议默认关闭，只询问是否收藏，绝不自动保存。
- MVP 不包含云同步；SQLite 是本地唯一权威数据源。

## 实验性飞书增量（MVP 之外）

- 飞书不属于当前桌面 MVP 的发布或验收范围。
- 设置页通过 write-only IPC 保存 App ID/App Secret，只公开脱敏配置和连接状态。
- 官方 Node SDK 长连接只在桌面应用运行期间在线，不提供 HTTP callback 或离线代收承诺。
- 一次性绑定、p2p 文字记录、ack/insight 回复和 delivery issue 人工处理复用本地 SQLite 与现有 CaptureService。
- 现有实现和自动化证据保留；真实企业租户验收与正式支持延期，状态见 `../docs/runbooks/feishu-tenant-acceptance.md`。
