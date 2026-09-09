shader_type canvas_item;
render_mode unshaded, blend_mix;

uniform vec2 canvas_size = vec2(640.0, 360.0);
uniform vec2 focus_center = vec2(320.0, 180.0);
uniform float focus_radius = 63.0;
uniform float outside_brightness : hint_range(0.0, 1.0) = 0.08;
uniform float inner_darkness : hint_range(0.0, 0.4) = 0.12;
uniform float falloff_power : hint_range(1.0, 8.0) = 4.0;
uniform float reveal_radius = 0.0;

void fragment() {
	// Measure distance in pixels, not raw UVs, to keep a circle at any aspect ratio.
	float distance_px = length(UV * canvas_size - focus_center);
	// The original radius is a lightly shaded reference, not a painted boundary.
	// A fourth-power falloff stays gentle inside it, then darkens rapidly outside.
	float gradient_radius = max(focus_radius - reveal_radius, 1.0);
	float ratio = max(distance_px - reveal_radius, 0.0) / gradient_radius;
	float max_darkness = 1.0 - outside_brightness;
	float inner_fraction = clamp(inner_darkness / max(max_darkness, 0.0001), 0.0, 0.9999);
	float coefficient = -log(1.0 - inner_fraction);
	float darkness = max_darkness * (1.0 - exp(-coefficient * pow(ratio, falloff_power)));
	// During dismissal, the fully clear center grows outward without a final jump.
	COLOR = vec4(vec3(0.0), darkness);
}
