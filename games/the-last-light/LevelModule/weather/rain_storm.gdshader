shader_type canvas_item;
render_mode unshaded, blend_premul_alpha;

// Project the fullscreen overlay into the level's world space for rain sampling.
uniform vec2 viewport_size = vec2(640.0, 360.0);
uniform vec2 world_origin = vec2(0.0);
uniform vec2 world_axis_x = vec2(1.0, 0.0);
uniform vec2 world_axis_y = vec2(0.0, 1.0);
// Supplied by the scene so rain and lightning obey pause and restart together.
uniform float weather_time = 0.0;
uniform float rain_density : hint_range(0.0, 1.0) = 0.62;
uniform float rain_opacity : hint_range(0.0, 1.0) = 0.62;
uniform float rain_speed : hint_range(0.1, 3.0) = 1.0;
uniform float wind_slant : hint_range(-0.5, 0.5) = 0.16;
uniform vec4 rain_color : source_color = vec4(0.65, 0.79, 0.91, 1.0);
uniform float atmosphere_opacity : hint_range(0.0, 0.2) = 0.045;
uniform float lightning : hint_range(0.0, 1.0) = 0.0;
uniform vec4 lightning_color : source_color = vec4(0.86, 0.92, 1.0, 1.0);

float hash_cell(vec2 cell) {
	vec3 p = fract(vec3(cell.xyx) * 0.1031);
	p += dot(p, p.yzx + 33.33);
	return fract((p.x + p.y) * p.z);
}

float patch_noise(vec2 point) {
	vec2 cell = floor(point);
	vec2 weight = fract(point);
	weight = weight * weight * (3.0 - 2.0 * weight);
	return mix(mix(hash_cell(cell), hash_cell(cell + vec2(1.0, 0.0)), weight.x),
		mix(hash_cell(cell + vec2(0.0, 1.0)), hash_cell(cell + vec2(1.0, 1.0)), weight.x), weight.y);
}

float drop_mask(vec2 local, float width, float length_px, float aa) {
	float streak = 1.0 - smoothstep(max(0.0, width * 0.5 - aa),
		width * 0.5 + aa, abs(local.x));
	float ends = 1.0 - smoothstep(length_px * 0.5 - 0.6,
		length_px * 0.5 + 0.6, abs(local.y));
	float tail = mix(0.22, 1.0, smoothstep(-length_px * 0.5, length_px * 0.5, local.y));
	return streak * ends * tail;
}

float rain_layer(vec2 pixel, vec2 spacing, float speed, float drop_length,
		float width, float density, float seed) {
	// Shear creates a wind direction without tilting or stretching the scene.
	vec2 flow = vec2(pixel.x - pixel.y * wind_slant,
		pixel.y - weather_time * speed * rain_speed);
	flow += vec2(seed * 19.7, seed * 37.1);
	vec2 cell = floor(flow / spacing);
	vec2 center = vec2(
		mix(0.18, 0.82, hash_cell(cell + vec2(seed, 4.7))),
		mix(0.30, 0.70, hash_cell(cell + vec2(8.3, seed))));
	vec2 local = (fract(flow / spacing) - center) * spacing;
	float variation = hash_cell(cell + vec2(21.4, seed));
	float length_px = drop_length * mix(0.65, 1.25, variation);
	// Derivative AA keeps thin drops legible without turning them into thick bars.
	float aa = max(fwidth(flow.x) * 0.65, 0.25);
	float present = 1.0 - step(density, hash_cell(cell + vec2(seed, 73.9)));
	return drop_mask(local, width, length_px, aa) * present * mix(0.65, 1.0, variation);
}

float foreground_rain(vec2 pixel) {
	vec2 spacing = vec2(23.0, 49.0);
	vec2 flow = vec2(pixel.x - pixel.y * wind_slant,
		pixel.y - weather_time * 220.0 * rain_speed) + vec2(350.66, 660.38);
	float base_row = floor(flow.y / spacing.y);
	float aa = max(fwidth(flow.x) * 0.65, 0.25);
	float rain = 0.0;
	// Each row has a different horizontal offset. Full-height jitter removes the
	// evenly spaced bands; adjacent rows are sampled so long drops never get cut.
	for (int row_offset = -1; row_offset <= 1; row_offset++) {
		float row = base_row + float(row_offset);
		float stagger = (hash_cell(vec2(row, 11.1)) - 0.5) * spacing.x * 1.8;
		vec2 cell = vec2(floor((flow.x - stagger) / spacing.x), row);
		vec2 jitter = vec2(mix(0.12, 0.88, hash_cell(cell + vec2(17.8, 4.7))),
			hash_cell(cell + vec2(8.3, 17.8)));
		vec2 center = (cell + jitter) * spacing + vec2(stagger, 0.0);
		// Broad wet clusters and open pockets travel with the drops. Density is
		// sampled per drop, so a moving streak keeps its identity and brightness.
		float patch = smoothstep(0.25, 0.75,
			patch_noise(center / vec2(110.0, 145.0) + vec2(5.7, 13.2)));
		float chance = clamp(rain_density * mix(0.12, 1.75, patch), 0.0, 1.0);
		float present = 1.0 - step(chance, hash_cell(cell + vec2(17.8, 73.9)));
		float length_px = mix(5.5, 19.0, hash_cell(cell + vec2(21.4, 17.8)));
		float width = mix(0.45, 0.88, hash_cell(cell + vec2(43.9, 6.1)));
		float opacity = mix(0.40, 1.0, hash_cell(cell + vec2(3.6, 51.7)));
		float drop = drop_mask(flow - center, width, length_px, aa) * present * opacity;
		rain = 1.0 - (1.0 - rain) * (1.0 - drop);
	}
	return rain;
}

void fragment() {
	vec2 screen_pixel = UV * viewport_size;
	vec2 pixel = world_origin + world_axis_x * screen_pixel.x + world_axis_y * screen_pixel.y;
	float far_rain = rain_layer(pixel, vec2(18.0, 42.0), 125.0, 6.5,
		0.45, rain_density * 0.85, 3.1) * 0.38;
	float near_rain = foreground_rain(pixel);
	float rain = (1.0 - (1.0 - far_rain) * (1.0 - near_rain)) * rain_opacity;
	// A stronger cloud flash reaches the lower scene while preserving its detail.
	float flash = clamp(lightning, 0.0, 1.0) * mix(1.0, 0.78, UV.y);
	float alpha = atmosphere_opacity;
	vec3 premul = vec3(0.025, 0.055, 0.10) * alpha;
	premul = lightning_color.rgb * flash + premul * (1.0 - flash);
	alpha = flash + alpha * (1.0 - flash);
	vec3 drop_color = mix(rain_color.rgb, lightning_color.rgb, flash);
	premul = drop_color * rain + premul * (1.0 - rain);
	alpha = rain + alpha * (1.0 - rain);
	// blend_premul_alpha requires premultiplied RGB, not straight-alpha RGB.
	COLOR = vec4(premul, alpha);
}
