# 序列帧生成工作区

当前项目把 `NativeFramesGeneration` 的完整本地工作台保存在 `Tools/SpritePipeline/`，并通过 `/tools/sprite-generator` 嵌入统一导航。上游来源为 `https://github.com/flxBurnOut/NativeFramesGeneration.git`，本次接入基于提交 `4254eb5`。

## 本地启动

环境要求：Node.js 22.13+、Python 3.11+。

首次使用安装 Python 依赖：

```powershell
npm run sprite-pipeline:setup
```

随后分别启动序列帧管线和主站：

```powershell
npm run sprite-pipeline
npm run dev
```

管线默认监听 `http://127.0.0.1:7860`。如需连接另一个可信地址，在本地 `.env` 中设置：

```dotenv
NEXT_PUBLIC_SPRITE_PIPELINE_UI_URL=https://your-private-sprite-pipeline.example
```

## 功能边界

嵌入界面保留上游的六阶段流程：指引与示例、生成动画、播放检查、逐帧修补、导出、API 与项目设置。生成服务使用 PixelLab Animate with Text V3；像素级手工修补、已有 Sheet 导入与离线诊断不依赖收费生成。

通过根目录 npm 命令启动时，Python 管线只监听回环地址，任务和角色包写入 `work/sprite-pipeline/`，成品写入 `outputs/sprite-pipeline/`；两者都不会提交到 Git。直接使用上游启动器时仍沿用其用户数据与文档导出目录。公开部署的 Cloudflare 页面不能启动本机 Python；若要远程使用，需要把管线单独部署到可信 HTTPS 服务，并补充访问控制和持久存储。

上游当前没有提供 LICENSE、COPYING 或 NOTICE 文件。公开再分发或商业发布前应由仓库所有者补充明确许可证或书面授权。
