/** User-copyable instructions for an exact, already-saved delivery. */
export function gameHandoff(delivery, manifest) {
  if (!delivery) return {summary:'',prompt:''};
  const animation = manifest?.kind === 'animation';
  const detail = manifest?.details || {};
  const summary = animation
    ? `请把「${delivery.title}」的本次动画接入「${delivery.project.name}」，保留其他动作和现有角色控制器，完成脚本连接并验收。`
    : `请把「${delivery.title}」接入「${delivery.project.name}」，完成场景与脚本连接，并验收。保留现有玩法和其他资产。`;
  const steps = animation
    ? `这是单个动作的 SpriteFrames 包（动作 ${detail.animation ?? '以包内清单为准'}，候选 ${detail.candidateIndex ?? '以包内清单为准'}，${detail.frameCount ?? '?'} 帧，FPS ${detail.fps ?? '?'}，loop=${detail.loop ?? '以包内清单为准'}）。核对包内作业、候选与真实资源，找到现有角色的 Sprite/AnimatedSprite2D 和控制器，只合并或替换本次动作，保留其他动作及现有动作别名、朝向、缩放、脚底偏移、碰撞和攻击时序。按项目实际代码完成动作映射与播放触发，不要重建人物系统，不要生成新美术。`
    : '完成场景挂载、动画与交互脚本连接，保留现有玩法和其他资产。';
  const prompt = `请接入刚导出的 ${delivery.title}，目标项目是 ${delivery.project.path}。先用 workbench_get_game_export 读取 ${delivery.deliveryId}，按 forge-game-engineering Skill 检查目标项目并用 workbench_install_game_export 安装校验后的资源。${steps} 使用目标项目的 Godot 4.7.x 验证资源加载和实际运行；没有执行引擎就明确记录未验收。最后用 workbench_complete_game_export 记录真实改动文件与验证结果。`;
  return {summary,prompt};
}
