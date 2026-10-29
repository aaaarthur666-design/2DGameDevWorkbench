# 2D production review

Use this guide when judging artwork or animation. Tool selection and execution belong to the [production Skill](../../.agents/skills/2d-game-workbench/SKILL.md); this document supplies visual criteria, not another workflow.

Judge against the user's current request and the actual selected asset. A preference is a valid editing goal even when the original is usable. Keep the user's goal separate from optional improvements.

| What is being reviewed | Look for |
| --- | --- |
| Character / prop | Requested identity, silhouette, proportions, equipment, facing and readable details at intended game scale; transparent edges on contrasting backgrounds |
| Animation | Required events and ending, coherent force and motion, stable appearance/equipment, intentional holds and transitions; loop seam only for a looping action |
| Local adjustment | The requested change, preserved context, both temporal or spatial seams, and whether the alternative improves the user's goal |
| Scene | Composition, scale, occlusion and placement in the saved version; inspect authored collision and behavior through their own data and checks |

For motion, inspect the complete ordered sequence at its actual FPS and examine relevant frames closely. A GIF first-frame response is insufficient. Compare an adjustment with its original and include neighboring frames or pixels. State what is visible, which frames or region support it, and any uncertainty.

Separate a clear defect from a stylistic preference or insufficient evidence. Use provider reports as additional evidence. When the user delegates selection, the main Agent can record its own observed conclusion and continue within that authorization; when the user retains the choice, present the comparison.

Technical checks establish dimensions, alpha, hashes or schema validity; visual review addresses the requested appearance and motion. Gameplay claims additionally need the relevant target-engine checks. Record the checks actually performed, with detail proportional to the task.

Use [review evaluation](../../docs/sprite-review-evaluation.md) only for experiments about reviewer accuracy or cost. Ordinary production does not require a frozen research sample or evaluation study.
