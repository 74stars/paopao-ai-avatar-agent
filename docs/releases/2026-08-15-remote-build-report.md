# Paopao Remote Build Report

- **Date (remote)**: 2026-08-15 (UTC) · **Remote host**: admin@10.126.126.1 (Ubuntu 24.04 x86_64, 32 cores, 94G RAM)
- **Repo commit**: `bf5d91fa1721a8729dc45d46d1a47a7cba942122`
- **Remote workspace**: ~/workspace/cbyworkspace/paopao-remote
- **Toolchain**: node ~/node22/bin/node v22.14.0, npm 11.8.0, git-lfs ~/bin/git-lfs 3.6.1, xvfb-run present, wine 9.0 (installed during Task B)

## Task A — Sync + Linux smoke reproduction

### 1. rsync (本机 → 远程)
- **成功**。`rsync -az --exclude node_modules --exclude '.git/lfs' --exclude desktop-app/node_modules --exclude dist --exclude dist-electron --exclude release --exclude test-results --exclude tmp`
- .git 目录已同步（37M，LFS 指针保留，无 LFS 对象）；远程树结构完整；node_modules / dist 均按要求排除。

### 2. npm ci
- 尝试 1（npmjs registry 直连）：**失败** — npm 包安装正常，但 electron 39.2.7 postinstall 从 GitHub 下载二进制超时：`RequestError: connect ETIMEDOUT 20.205.243.166:443`（node_modules/electron 的 node install.js）。
- 尝试 2（加 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 等镜像环境变量）：**成功**，`added 577 packages in 50s`。better-sqlite3 原生模块编译完成（build/Release/better_sqlite3.node），electron v39.2.7 二进制就位。

### 3. 构建
- 初次 `build:electron` 失败：workspace 包（@paopao/contracts 等）未先构建，报 `Cannot find module '@paopao/contracts'` + 连带 TS7006 implicit any。
- 按正确顺序 `npm run build:packages && npm run build --workspace=paopao-desktop`：**成功**（renderer dist + dist-electron 全部产出，preload 沙箱校验通过）。

### 4. Linux 冒烟（xvfb）
- `npm run smoke:preload:runtime` 退出码 **0** — **通过（Linux 复现成功）**。
- 关键输出：
  ```
  [4167083:0815/232544.343154:ERROR:components/viz/service/main/viz_main_impl.cc:189] Exiting GPU process due to errors during initialization
  Effective webPreferences: {"allowRunningInsecureContent":false,...,"sandbox":true,...}
  Sandbox preload runtime smoke passed (bridge, typed IPC, isolation, preferences)
  ```
- 唯一的 GPU 进程错误为 xvfb 下无 GPU 的正常警告，不影响结果；无 Electron 启动失败/超时/断言失败。

### 5. e2e:preview（xvfb 同时运行）
- `npm run test:e2e:preview` 退出码 **0** — **通过**，报告 `test-results/preview-accessibility/2026-08-15T15-25-46-194Z/report.json`，result=PASS，6/6 用例 PASS（closed dialogs inert/aria-hidden、capture dialog focus、reader dialog focus trap、backdrop close+restore、mobile fallback）。

## Task B — Windows x64 NSIS 构建（Linux 上，electron-builder）

- 尝试 1：**失败** — `⨯ node-gyp does not support cross-compiling native modules from source.`（@electron/rebuild 需要 win32/x64 的 better-sqlite3 预编译包）。
  - 根因：`npm_config_better_sqlite3_binary_host` 值带**尾部斜杠**，prebuild-install 拼出 `…/better-sqlite3//v12.6.2/…` 双斜杠 URL → npmmirror 返回 **404**，回退 node-gyp 源码交叉编译 → 失败。
  - 修复：去掉尾部斜杠后 prebuild-install 命中缓存 `/home/admin/.npm/_prebuilds/0c4711-better-sqlite3-v12.6.2-electron-v140-win32-x64.tar.gz`（Electron 39.2.7 ABI=140），安装成功。
- 尝试 2：**失败** — `⨯ wine is required`（即使 `-c.win.signAndEditExecutable=false`，NSIS 目标在 Linux 上仍需 wine）。
  - 修复：`sudo apt-get install -y wine64`（wine 9.0，sudo 免密可用）。
- 尝试 3：**成功**，退出码 **0**。

### 产物（remote: ~/workspace/cbyworkspace/paopao-remote/desktop-app/release/）
| 文件 | 大小 (bytes) | sha256 |
|---|---|---|
| Paopao-Setup-0.1.0.exe | 152,783,053 (~145.7 MB) | `6e94072c5b3a29372b93d65d297411d5265641ff24de13554ecab6e2856161fc` |
| Paopao-Setup-0.1.0.exe.blockmap | 159,358 | `2f8fc14c526e1ca05e105e5704763a49f4ed716f6b9fadd15f96f79f2d34658d` |
| win-unpacked/ | 目录 | — |

- 打包校验：`win-unpacked/resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node` 为 **PE32+ x86-64 Windows DLL**（正确交叉产物）；asarUnpack 生效。
- 构建命令：`npx electron-builder --win nsis --x64 -c.win.signAndEditExecutable=false`，镜像环境变量：ELECTRON_MIRROR / ELECTRON_BUILDER_BINARIES_MIRROR / npm_config_better_sqlite3_binary_host（无尾部斜杠）/ CSC_IDENTITY_AUTO_DISCOVERY=false。Electron win32 zip 与 NSIS 二进制均从 npmmirror 镜像下载（约 10s）。

## Task C — 结论
- 同步：成功。
- Linux 冒烟：成功复现（smoke:preload:runtime 与 e2e:preview 均 PASS，退出码 0）。
- Windows NSIS 构建：成功，Setup 152,783,053 bytes，sha256 如上。
- 网络失败均已定位并解决（Electron 二进制走 npmmirror 镜像；better-sqlite3 prebuild URL 双斜杠 404；wine 缺失），无盲重试（每项失败重试次数 ≤ 1）。
