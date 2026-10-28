# Forge 项目任务导航

Forge 是资产制作、共享编辑与 Godot 交付工作台。先按当前任务选择入口，再读取涉及的主题；无需预先读完整文档集。

| 当前任务 | 从这里开始 |
| --- | --- |
| 制作、修改、查看或交付实际素材 | [资产制作 Skill](.agents/skills/2d-game-workbench/SKILL.md) |
| 把已有素材接入游戏，或编写 Godot 代码 | [游戏工程 Skill](.agents/skills/forge-game-engineering/SKILL.md)，以及目标工程自身的指导文件 |
| 修改工作台代码、接口、测试或配置 | [开发导航](workbench/guides/development.md)，按受影响模块查契约和测试 |
| 修改 Agent 指导或 Skill | [指导文档维护](workbench/guides/guidance-maintenance.md) |
| MCP 连接、指导读取或宿主工具排错 | [客户端接入](docs/agent-clients.md) |
| 安装、启动、服务排错或数据恢复 | [操作手册](docs/operations-manual.md)中的对应章节 |
| 讨论方案、解释功能或梳理需求 | [对话指南](workbench/conversation-guide.md)，按需要查询现状 |

用户要求决定执行范围。在已有目标、对象和预算内处理常规选择并完成工作；关键目标不明、超出授权范围或出现实际冲突时再询问。纯讨论按讨论交付；获准实施时继续到可验证的结果。

产品制作规则描述当前接口的用法，不限制用户授权的代码开发。例如 MCP 没有某项地图操作时，可修改其实现或使用用户明确指定的网页工具，而不是虚构一个现成 MCP 能力。

工作区中的 `work/`、`outputs/`、`games/` 是本地任务、素材或游戏数据。开发验证使用隔离目录；提交范围由任务决定，避免把私人数据或凭据带入源码。修改共享编辑与异步执行时，保留版本冲突检查、原请求身份及恢复记录。

能力和参数从 `workbench/manifest.json` 及对应契约读取；按主题文档理解语义。若文档与代码不同，检查当前实现和相关测试，并在本次修改涉及的范围内修正文档。

## Cursor Cloud specific instructions

日常安装与启动仍按 [操作手册](docs/operations-manual.md)：在仓库根目录执行 `npm ci`、`npm run sprite-pipeline:setup`、`npm run dev`。Node.js 需 22.13+。

Ubuntu 基础镜像里的 `python3` 没有 `ensurepip`。`python3 -c 'import ensurepip'` 失败时先安装 `python3-venv`，再跑 SpritePipeline setup。CI 与本机虚拟环境使用 Python 3.12。SpritePipeline 的 pytest 要在 `Tools/SpritePipeline` 目录用 `.venv/bin/python -m pytest -q` 运行。

`npm run dev` 会拉起三个服务：前端 http://localhost:3000，Runtime Bridge http://127.0.0.1:8790/health，SpritePipeline http://127.0.0.1:7860。当前 Vite 开发服务器只监听 IPv6 `::1`，用 `http://127.0.0.1:3000` 会连接失败。

`.env` 里的生图密钥可以留空。界面、`npm run workbench -- doctor --json` 和本地编辑器不依赖它们。`npm run test:engineering` 的 Godot 引擎检查只在 `GODOT_47_BIN` 指向 Godot 4.7.x 时执行，未配置时该部分会跳过。
