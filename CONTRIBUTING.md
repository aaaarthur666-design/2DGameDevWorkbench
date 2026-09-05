# 贡献指南

感谢参与 2D Game Dev Workbench。项目把外部 Agent 接入、可视化工作台和独立生产工具分层维护；贡献时最重要的是保持三种入口共享同一份能力契约。

## 开始之前

1. 阅读 [README](README.md)、[系统架构](docs/architecture.md) 与 [开发指南](docs/development.md)。
2. 从最新 `main` 创建聚焦本次变更的分支。
3. 运行 `npm install`，按需从 `.env.example` 创建本地 `.env`。
4. 不要提交 API key、用户素材、`work/`、`outputs/` 或测试生成物。

## 变更原则

- `workbench/manifest.json` 是工作台能力的运行时来源，MCP、CLI 和 Web 不维护第二份模块目录。
- 外部 Agent 是主 Agent；Web 是任务、进度、编辑和人工操作界面，不在前端内嵌通用对话模型。
- 工具算法留在能力模块或外部服务中，工作台通过适配器和 HTTP 连接器集成。
- MCP、CLI 和 Web 的任务语义必须通过 `lib/workbench/runtime.mjs` 对齐。
- 保留输入文件；每个任务只向自己的 `outputs/<task-id>/` 写入新产物。
- 任务状态必须真实。`prepared` 和 `awaiting_configuration` 都不是完成。
- 对外部 API 的认证只存在于服务端环境，不进入客户端、日志或任务记录。

## 修改清单和 schema

能力名称、输入、输出、适配器、连接器或路由改变时，应同步更新：

- `workbench/manifest.json`；
- 对应适配器及测试；
- `AGENTS.md` 和 `.agents/skills/2d-game-workbench/SKILL.md`；
- [连接器契约](docs/connector-contract.md)、[系统架构](docs/architecture.md) 与功能文档。

交互物嵌套字段以 `features/interactable-editor/contract.mjs` 为编辑源。运行 `npm run schema:interactable` 生成清单片段，并把生成结果与实现一起提交。

## 测试

先执行与变更范围匹配的测试，再执行通用前端检查。完整矩阵见 [开发与验证指南](docs/development.md#验证矩阵)。常用基线为：

```powershell
npm run workbench -- doctor --json
npm run test:mcp
npm run test:adapters
npm run test:http
npm run lint
npm run typecheck
npm run build
```

功能变更还需运行对应的地图、交互物、工作台壳层或 SpritePipeline 测试。测试应验证真实输出和失败边界，不能只验证按钮存在。

## 文档

- 当前行为写入“当前维护”文档；完成的实施计划保留为历史快照并在顶部标注。
- 命令、端口、能力 ID 和状态名必须与源码一致。
- 上游 `Tools/SpritePipeline/` 内文档尽量随上游同步，工作台特有说明写在根目录 `docs/`。
- 新增复制代码、上游组件或行为兼容实现时更新 `THIRD_PARTY_NOTICES.md`。

## 提交与 Pull Request

提交应聚焦单一目的，并使用可读的祈使式摘要，例如：

```text
feat: add capability adapter
fix: preserve map template pixels
docs: align agent integration guide
chore: sync SpritePipeline upstream
```

Pull Request 描述应包含变更动机、用户可见行为、架构影响、验证命令与结果；涉及 UI 时附截图，涉及外部 API 时说明是否产生费用、数据出站和所需配置。不要把未经确认的任务描述成已经完成。

## 安全问题

疑似密钥泄漏、路径越界、未授权远程访问或其他安全问题请按 [安全策略](SECURITY.md) 私下报告，不要先发布包含利用细节的公开 Issue。
