# Windows / macOS 兼容性

本轮检查覆盖凭据保存、服务初始化与管理、数据和导出路径、编辑器快捷键、鼠标与触控板缩放、字体和 CI。检查与修复在 Windows 完成；macOS 分支有模拟测试和原生 CI 测试入口，但本轮未在 Mac 实机运行，也未触发远程 CI。

## 已修复的差异

| 范围 | 发现的问题 | 当前行为 |
| --- | --- | --- |
| 地图 API | macOS 使用普通本地文件 | 钥匙串保管随机加密密钥，本地配置使用 AES-256-GCM；重启恢复，旧本地格式读取时迁移 |
| 原图、序列帧与视觉服务凭据 | SpritePipeline 在 macOS 使用权限文件回退 | 原生 Keychain 保存凭据，配置文件保存引用；替换/清除后清理旧引用，保存失败保留旧值 |
| 独立 SpritePipeline 数据 | macOS 默认使用 Linux 风格目录 | 新安装使用 `~/Library/Application Support/SpritePipeline`；旧 `.local/share/SpritePipeline` 仍优先兼容，显式目录配置继续有效；工作台继续使用 `work/sprite-pipeline` |
| 编辑器键盘 | 部分单键操作响应 Cmd/Ctrl/Alt 组合，例如地图 Cmd+C 可能完成区域草稿 | 先处理明确支持的组合键，再屏蔽单键操作；中文输入法组合输入不触发编辑操作 |
| 地图触控板 | 每个事件固定缩放，细小/横向输入也改变比例 | 按滚动幅度归一化，横向零增量不缩放；主画布使用可取消的 wheel 监听器避免页面同时缩放 |
| 字体 | 壳层、像素编辑器部分字体只列 Windows 字体 | 系统字体、PingFang SC 与 SFMono 回退，保留 Windows 字体 |
| 双平台 CI | 桌面矩阵以启动测试为主 | Windows/macOS 增加地图、HTTP、场景、壳层、凭据、lint、typecheck 和 build |

macOS 地图保存通过 `/usr/bin/security -i` 的标准输入提交短的十六进制加密密钥，API 密钥不进入命令参数；其交互解析方式依据 [Apple SecurityTool 源码](https://github.com/apple-oss-distributions/Security/blob/main/SecurityTool/macOS/security.c)。SpritePipeline 通过系统 Security framework 读取与写入凭据，无额外 Python 包依赖。钥匙串锁定或拒绝访问会报错，不回退到明文。

## 已检查的既有兼容设计

- 初始化与启动均使用 Node.js 入口；Windows 使用 `.venv/Scripts/python.exe`，macOS 使用 `.venv/bin/python`，不复用跨系统虚拟环境。
- 服务默认绑定回环地址，已健康服务会复用；Windows 的进程树终止命令位于平台分支，macOS 使用信号。
- 导出与源包使用相对路径和 `/` 分隔符，运行时使用 Node/Python 路径 API；未发现主流程硬编码用户的 `C:` 或 `/Users/` 路径。
- 地图和场景的撤销、保存等已有 Ctrl/Cmd 支持；删除接受 Delete/Backspace；画布支持空格拖动或工具模式，不要求鼠标中键。
- 文件导入导出使用网页文件输入和下载，未依赖 Chromium 专有的目录选择 API。

## 验证方式与边界

`npm run test:map-stitcher` 包含地图配置新进程恢复、macOS 密钥不进入 argv、认证密文防篡改、钥匙串失败、触控板增量和滚轮单位归一化检查。Windows 实际运行 DPAPI；macOS CI 会实际调用 Keychain。

`npm run test:platform-credentials` 使用当前系统的项目 Python 环境验证旧凭据迁移、重启恢复、替换/清除和失败保留。原生 Keychain 测试在非 macOS 平台明确跳过。桌面 CI 矩阵定义在 [ci.yml](../.github/workflows/ci.yml)。

仍需 Mac 实机验收：

- 钥匙串首次授权、锁定后重试、关闭工作台再打开后的配置恢复。
- Safari 和 Chrome 的触控板捏合/滚动、空格拖动、Cmd 快捷键与中文输入法组合。
- Retina 缩放下的画布清晰度、字体排版和下载文件名。
- 从正常终端退出开发服务后是否完全释放端口；目前仅完成代码检查和自动化启动测试。

跨平台移交应使用项目源代码和导出包，在目标机器重新运行安装命令并配置凭据。不要复制 `.venv`，也不要把操作系统账户绑定的凭据文件当作可移植配置。
