/**
 * 地表片元着色器（第 23 轮 3A 画质地表分支）。
 *
 * 分工：
 * - `terrain.ts` 负责每格属性图集（颜色 / 属性 / 海岸 / 热度）与 uniform 绑定；
 * - 本文件只写着色逻辑：球面三平面采样（无立方体面接缝）、群落高度混合、水面、岩浆、
 *   未探索面纱。所有动画都只用 `swTime`，冻结时 `swTime = 0` 即固定相位。
 *
 * 信息诚实：纹理层号只由服务端 terrain 与行星 kind 决定；未知格不取任何地形色。
 */

export const SHADER_HEADER = /* glsl */`
  varying vec3 swSurfacePosition;
  // 世界空间法线（对象空间 = 世界空间：行星球面 mesh 无旋转/缩放）。
  varying vec3 swSurfaceWorldNormal;
  uniform sampler2D swOverviewColor;
  uniform sampler2D swOverviewProperties;
  uniform sampler2D swLocalColor;
  uniform sampler2D swLocalProperties;
  uniform sampler2D swOverviewCoast;
  uniform sampler2D swLocalCoast;
  uniform sampler2D swOverviewHeat;
  uniform sampler2D swLocalHeat;
  uniform sampler2D swOverviewSdf;
  uniform sampler2D swLocalSdf;
  uniform sampler2DArray swAlbedoArray;
  uniform sampler2DArray swPackedArray;
  uniform sampler2D swWaterNormal;
  uniform sampler2D swLavaEmissionMap;
  uniform vec2 swMapDimensions;
  uniform vec2 swLocalDimensions;
  uniform vec2 swOverviewDimensions;
  uniform float swTime;
  uniform float swFog;
  uniform vec4 swPatchBounds[7];
  uniform vec4 swPatchUV[7];
  // 星球群落（biome.ts）：色相/饱和/明度偏置与可建造地三种土的权重。
  uniform vec3 swSoilWeights;
  uniform vec3 swBiomeTint;
  uniform float swBiomeSaturation;
  uniform float swBiomeBrightness;
  uniform float swBiomeIce;
  uniform float swSeed;
  uniform float swDebug;
  // 对象空间太阳方向与相机位置（场景每帧写入；行星球面只有旋转，没有平移/缩放）。
  uniform vec3 swSunObject;
  uniform vec3 swCameraObject;
  // 片元内跨 include 段传递（map_fragment → roughness / normal / emissive）。
  float swWaterMask = 0.0;
  float swLavaMask = 0.0;
  // 水面世界空间法线扰动（xy），由 map_fragment 段写入、normal 段使用。
  vec2 swWaterNormalXY = vec2(0.0);
  float swWaveDetailOut = 0.0;
  vec3 swWaterSky = vec3(0.0);
  float swWaterFresnel = 0.0;
  float swWaterMetal = 0.02;
  vec3 swEastW = vec3(1.0, 0.0, 0.0);
  vec3 swSouthW = vec3(0.0, 0.0, 1.0);
  /** 到水边的连续场（格为单位，跨面邻接）：图集 coast 四向标志与格内坐标算出，
   *  水面深浅、泡沫线、岸边沙泥都用它，所以海岸线在格内是斜的、圆润的，不沿格边走方块。 */
  float swShoreDistance = 1.0;
  /** 高度（bump 来源）采样用的 mip 级别：逐像素由「一个像素覆盖几个 texel」算出。 */
  float swHeightLod = 0.0;
  float swHeightField = 0.0;
  vec3 swLavaEmissive = vec3(0.0);

  float swHash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.17, 0.43, 0.71));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float swNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(swHash(i), swHash(i + vec3(1,0,0)), f.x),
      mix(swHash(i + vec3(0,1,0)), swHash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(swHash(i + vec3(0,0,1)), swHash(i + vec3(1,0,1)), f.x),
      mix(swHash(i + vec3(0,1,1)), swHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float swFbm(vec3 p) {
    return swNoise(p) * 0.55 + swNoise(p * 2.03 + 13.7) * 0.27 + swNoise(p * 4.13 + 31.1) * 0.12 + swNoise(p * 8.31) * 0.06;
  }

  /** 球面三平面权重：对象空间坐标连续，所以立方体面接缝处纹理天然连续。 */
  vec3 swTriplanarWeights(vec3 p) {
    vec3 w = pow(abs(normalize(p)), vec3(7.0));
    return w / max(dot(w, vec3(1.0)), 0.0001);
  }

  struct SwSurface {
    vec3 albedo;
    float height;
    float rough;
  };

  /** 按层号取一张地表纹理（albedo + 打包通道），三平面混合。 */
  SwSurface swSampleLayer(float layer, vec3 pos, vec3 blend, float scale) {
    vec3 p = pos * scale;
    vec4 ax = texture2D(swAlbedoArray, vec3(p.zy, layer));
    vec4 ay = texture2D(swAlbedoArray, vec3(p.xz, layer));
    vec4 az = texture2D(swAlbedoArray, vec3(p.xy, layer));
    // 高度（bump 来源）按 swHeightLod 采样：贴地时纹理被放大到 1–2 texel/像素，
    // 逐像素高度差全是纹素级噪声，直接求导会得到逐像素乱跳的法线（L14 亮点）。
    // 至少滤到 2 texel 以上，bump 才是一条连续的表面起伏。
    vec4 px = textureLod(swPackedArray, vec3(p.zy, layer), swHeightLod);
    vec4 py = textureLod(swPackedArray, vec3(p.xz, layer), swHeightLod);
    vec4 pz = textureLod(swPackedArray, vec3(p.xy, layer), swHeightLod);
    SwSurface s;
    s.albedo = ax.rgb * blend.x + ay.rgb * blend.y + az.rgb * blend.z;
    s.height = px.a * blend.x + py.a * blend.y + pz.a * blend.z;
    s.rough = px.b * blend.x + py.b * blend.y + pz.b * blend.z;
    return s;
  }

  /** 高度混合：两层按各自的纹理高度互相「顶开」，得到自然的边界而不是线性糊。 */
  float swHeightBlend(float heightA, float heightB, float weightA, float weightB, float noise) {
    return smoothstep(-0.16, 0.16, (heightA - heightB) * 2.2 + (weightA - weightB) * 2.4 + (noise - 0.5) * 0.5);
  }

  /** 一次图集采样结果：类别权重已做亚格双线性（未知格权重恒为 0）。 */
  struct SwAtlasSample {
    vec4 props;
    vec3 color;
    vec4 coast;
    vec4 heat;
    /** 有符号距离场（格，±4 编码到 0..1，0.5 = 0）：R 水面、G 岩性、B 岩浆、A 到未知区。
     *  双线性插值后等值线在格内是斜的、跨格连续——这就是 L15 的亚格边界。 */
    vec4 sdf;
    /** 已探索度 0..1：只在已探索格内部上升，未探索格恒为 0（信息诚实）。 */
    float known;
    /** 格内坐标（0..1，含域扭曲），用于测绘网格与泡沫线。 */
    vec2 cellUV;
  };

  /**
   * 图集双线性采样（第 23 轮第二轮 L15）：四邻格按格心插值，让水/陆、阻挡/可建造、
   * 岩浆/可建造三类边界都是亚格过渡，不再沿格子走方块锯齿。
   *
   * 信息诚实：只有**已探索**的邻格参与加权（未知格权重为 0），并且 known 还要乘
   * 本格中心的已知位——域扭曲把采样点推进未知格时，那里依然是面纱而不是地形色。
   */
  SwAtlasSample swSampleAtlas(sampler2D propsTex, sampler2D colorTex, sampler2D coastTex, sampler2D heatTex,
    sampler2D sdfTex, vec2 cellIndex, vec2 dims, vec4 rect) {
    vec2 p = cellIndex - 0.5;
    vec2 base = floor(p);
    vec2 f = clamp(p - base, 0.0, 1.0);
    vec2 halfTexel = 0.5 / dims;
    vec2 low = rect.xy + halfTexel;
    vec2 high = rect.xy + rect.zw - halfTexel;
    vec2 uv00 = clamp((base + vec2(0.5, 0.5)) / dims, low, high);
    vec2 uv10 = clamp((base + vec2(1.5, 0.5)) / dims, low, high);
    vec2 uv01 = clamp((base + vec2(0.5, 1.5)) / dims, low, high);
    vec2 uv11 = clamp((base + vec2(1.5, 1.5)) / dims, low, high);
    vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
    vec4 p00 = texture2D(propsTex, uv00), p10 = texture2D(propsTex, uv10);
    vec4 p01 = texture2D(propsTex, uv01), p11 = texture2D(propsTex, uv11);
    vec4 known4 = step(vec4(0.5), vec4(p00.b, p10.b, p01.b, p11.b));
    vec4 wk = w * known4;
    float sum = dot(wk, vec4(1.0));
    float norm = 1.0 / max(sum, 0.0001);
    SwAtlasSample s;
    s.props = (p00 * wk.x + p10 * wk.y + p01 * wk.z + p11 * wk.w) * norm;
    s.color = (texture2D(colorTex, uv00).rgb * wk.x + texture2D(colorTex, uv10).rgb * wk.y
      + texture2D(colorTex, uv01).rgb * wk.z + texture2D(colorTex, uv11).rgb * wk.w) * norm;
    s.coast = (texture2D(coastTex, uv00) * wk.x + texture2D(coastTex, uv10) * wk.y
      + texture2D(coastTex, uv01) * wk.z + texture2D(coastTex, uv11) * wk.w) * norm;
    s.heat = (texture2D(heatTex, uv00) * wk.x + texture2D(heatTex, uv10) * wk.y
      + texture2D(heatTex, uv01) * wk.z + texture2D(heatTex, uv11) * wk.w) * norm;
    // SDF 图是每格 4×4 的超采样距离场：按连续的格坐标直接取一个点，硬件线性过滤
    // 就把 1/4 格精度的等值线插成平滑曲线（四邻权重只适用于逐格类别图）。
    s.sdf = texture2D(sdfTex, clamp(cellIndex / dims, low, high));
    // 本格中心的已知位（未加权、未归一化）：域扭曲不能把地形色带进未探索格。
    vec2 ownUV = clamp((floor(cellIndex) + 0.5) / dims, low, high);
    float own = step(0.5, texture2D(propsTex, ownUV).b);
    s.known = smoothstep(0.18, 0.86, sum) * own;
    s.cellUV = fract(cellIndex);
    return s;
  }

  vec3 swSaturate(vec3 color, float amount) {
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    return mix(vec3(luma), color, amount);
  }
`;

export const SHADER_COLOR = /* glsl */`
  vec3 swP = normalize(swSurfacePosition);
  vec3 swA = abs(swP);
  float swFace; vec2 swFaceUV;
  if (swA.z >= swA.x && swA.z >= swA.y) {
    swFace = swP.z >= 0.0 ? 0.0 : 2.0;
    swFaceUV = vec2(swP.z >= 0.0 ? swP.x : -swP.x, -swP.y) / swA.z;
  } else if (swA.x >= swA.y) {
    swFace = swP.x >= 0.0 ? 1.0 : 3.0;
    swFaceUV = vec2(swP.x >= 0.0 ? -swP.z : swP.z, -swP.y) / swA.x;
  } else {
    swFace = swP.y >= 0.0 ? 4.0 : 5.0;
    swFaceUV = vec2(swP.x, swP.y >= 0.0 ? swP.z : -swP.z) / swA.y;
  }
  swFaceUV = atan(swFaceUV) / 1.57079632679 + 0.5;
  // 概览图集的格坐标（P1-1）：面内 0..1 坐标先按**单面**格数换算（swFaceSize = 总宽/3），
  // 再加上该面在 3×2 图集里的原点格；直接乘整张图集的格数会让 6 个面全部错位
  // （只有面 0 的左上角恰好在原点时才对齐）。与 shared-client/surface.ts 的
  // surfaceNormal / surfaceCoordinate 同一口径：面内 u 线性对应格坐标，格心在 +0.5。
  vec2 swFaceSize = swOverviewDimensions / vec2(3.0, 2.0);
  vec2 swFaceOrigin = vec2(mod(swFace, 3.0), floor(swFace / 3.0)) * swFaceSize;
  vec2 swFaceCell = swFaceOrigin + clamp(swFaceUV, 0.000001, 0.999999) * swFaceSize;
  // 像素脚印（世界单位）：分类之前就要用（域扭曲按它淡出），后面纹理细节也用同一个值。
  float swPixelFootprintEarly = length(fwidth(swSurfacePosition));
  // 每格世界尺寸：格边界的双线性只在已探索格之间生效，所以邻格查表要跨面（atan 面内坐标）。
  float swCellWorld = 3.3321622036 * length(swSurfacePosition) / max(1.0, swMapDimensions.x);
  // 亚格边界（L15）：格内坐标先做域扭曲（幅度 ≤ .35 格、确定性、与时间无关），
  // 再在四邻格之间双线性混合类别权重——海岸线圆润不规则，不再沿格子走方块锯齿。
  // 频率按「格」定：贴地时一格 ≈ 0.3 世界单位，所以 8–20 的球面频率约 2–6 格一个起伏；
  // 再高就会让岸线变成细锯齿（噪声本身就是逐像素的高频）。
  // 域扭曲（L15）：类别权重本身是二值的，双线性插值只会把 0.5 等值线整体挪半格，
  // 仍是沿格边的直线段。真正让边界「圆润不规则」的是把采样点按亚格噪声抖动：
  // 幅度 ≤ .35 格、波长 1–2 格，于是等值线在每个格子里都弯一下，方块阶梯被抹掉。
  // 远景（一格不到几个像素）时扭曲会退化成亚像素抖动，按像素脚印淡出即可。
  float swWarpFade = 1.0 - smoothstep(0.18, 0.9, swPixelFootprintEarly / max(1e-5, swCellWorld));
  vec3 swCellSpace = swSurfacePosition / max(1e-5, swCellWorld);
  vec2 swWarp = vec2(swFbm(swCellSpace * 0.9 + 5.7), swFbm(swCellSpace * 1.7 + 17.3)) - 0.5;
  vec2 swCellCoord = swFaceCell + swWarp * (0.70 * swWarpFade);
  vec4 swOverviewRect = vec4(vec2(mod(swFace,3.0),floor(swFace/3.0)) / vec2(3.0,2.0), vec2(1.0) / vec2(3.0,2.0));
  SwAtlasSample swAtlas = swSampleAtlas(swOverviewProperties, swOverviewColor, swOverviewCoast, swOverviewHeat,
    swOverviewSdf, swCellCoord, swOverviewDimensions, swOverviewRect);
  vec4 swProps = swAtlas.props;
  vec3 swAlbedo = swAtlas.color;
  vec4 swCoast = swAtlas.coast;
  vec4 swHeat = swAtlas.heat;
  vec4 swSdf = swAtlas.sdf;
  vec2 swCellUV = swAtlas.cellUV;
  vec2 swUV = (vec2(mod(swFace,3.0),floor(swFace/3.0)) + swFaceUV) / vec2(3.0,2.0);
  // 已探索度取「本次实际采样的那张图集」（全局 overview 或场景窗口 local）：
  // 大行星的局部曲面只覆盖场景窗口，全局图集在窗口里可能还是占位（全未探索）。
  float swAtlasKnown = swAtlas.known;
  // Fog boundary glow: an unknown cell that touches an explored cell in the local
  // scene window. Sampled from the same atlas the surface reads, so a fog edge can
  // never imply undiscovered terrain data.
  float swKnownEdge = 0.0;
  for(int i=0;i<7;i++) {
    vec4 bounds = swPatchBounds[i];
    if(bounds.z <= 0.0) continue;
    vec2 uv = (swUV - bounds.xy) / bounds.zw;
    if(all(greaterThanEqual(uv,vec2(0))) && all(lessThanEqual(uv,vec2(1)))) {
      vec4 rect = swPatchUV[i];
      vec2 texel = 0.5 / swLocalDimensions;
      // 局部窗口：格内坐标换成该补片自己的行列，再做同一套域扭曲 + 双线性。
      // 局部图集里 1 个纹素 = 1 格，所以补片内格偏移直接加到 rect 的格偏移上。
      vec2 localCell = clamp(swUV, bounds.xy, bounds.xy + bounds.zw) * swMapDimensions;
      vec2 packedCell = rect.xy * swLocalDimensions + (localCell - bounds.xy * swMapDimensions);
      SwAtlasSample local = swSampleAtlas(swLocalProperties, swLocalColor, swLocalCoast, swLocalHeat,
        swLocalSdf, packedCell + swWarp * (0.70 * swWarpFade), swLocalDimensions, rect);
      swProps = local.props;
      swAlbedo = local.color;
      swCoast = local.coast;
      swHeat = local.heat;
      swSdf = local.sdf;
      swCellUV = local.cellUV;
      swAtlasKnown = local.known;
      vec2 packedUV = clamp(rect.xy + uv * rect.zw, rect.xy + texel, rect.xy + rect.zw - texel);
      if(local.props.b < 0.5) {
        vec2 low = rect.xy+texel, high = rect.xy+rect.zw-texel;
        for(int dy=-1;dy<=1;dy++) {
          for(int dx=-1;dx<=1;dx++) {
            if(dx==0 && dy==0) continue;
            float neighbor = texture2D(swLocalProperties, clamp(packedUV + vec2(float(dx),float(dy))*texel, low, high)).b;
            swKnownEdge = max(swKnownEdge, smoothstep(0.05,0.95,neighbor));
          }
        }
      }
    }
  }
  float swMapWidth = swMapDimensions.x;
  float swTileWorldSize = 3.3321622036 * length(swSurfacePosition) / swMapWidth;
  // 已探索度直接取平滑场的 known（只在已探索格内部上升，未知格恒为 0）：
  // 已探索/未探索的过渡由面纱的 swKnown 混合完成，没有沿格走的压暗方块（L15）。
  float swKnown = swAtlasKnown;
  // 分类权重（L15）：双线性后是 0..1 的连续场，用较宽的 smoothstep 交叉，
  // 让水/陆、阻挡/可建造、岩浆/可建造三类边界都在**格内部**完成过渡（而不是在格边硬切）。
  // 平滑场解码：0.5 = 等值线；值是覆盖度（0..1 之间），乘以 8 换算成「格」的量级，
  // 方便下面与噪声（同样以格为单位）相加。
  float swSdfWater = (swSdf.r - 0.5) * 8.0;
  float swSdfRock = (swSdf.g - 0.5) * 8.0;
  float swSdfLava = (swSdf.b - 0.5) * 8.0;
  // 距离场只解决「等值线在哪」，形状仍是格子的；真正的圆润来自把噪声加进距离场本身：
  // 幅度 ±0.45 格、波长 2–4 格，等值线就被推成不规则的湾与岬（L15 的域扭曲，作用在 SDF 上
  // 比作用在采样坐标上更可控——不会把地形色推进未知格）。
  vec3 swSdfCellSpace = swSurfacePosition / max(1e-5, swCellWorld);
  float swCoastNoise = (swFbm(swSdfCellSpace * 0.28 + 3.9) - 0.5) * 0.9
    + (swFbm(swSdfCellSpace * 0.75 + 11.7) - 0.5) * 0.35;
  float swRockNoise = (swFbm(swSdfCellSpace * 0.33 + 27.1) - 0.5) * 0.8;
  float swLavaNoise = (swFbm(swSdfCellSpace * 0.55 + 41.3) - 0.5) * 0.7;
  float swWater = smoothstep(-0.45, 0.45, swSdfWater + swCoastNoise);
  float swRock = smoothstep(-0.45, 0.45, swSdfRock + swRockNoise);
  float swLava = smoothstep(-0.40, 0.40, swSdfLava + swLavaNoise) * swKnown;
  // 焦土：到岩浆格的连续距离场（heat.r 在 5 格内线性衰减），再乘 (1 - 岩浆本体)。
  float swLavaNear = smoothstep(0.02, 0.85, swHeat.r) * (1.0 - swLava);
  // 连续离岸距离（L15）：直接取水面距离场（含上面叠的噪声），
  // 所以浅滩、泡沫线、岸边沙泥都与同一条平滑岸线对齐，不会在格边留暗边。
  // 水面侧为正、陆地侧为负；离岸距离 = 到岸线的格数。
  // 水面侧为正（SDF 内正外负）：水里的离岸距离就是 SDF 本身。
  // 场值是覆盖度：斜率约 0.45/格，除以它换算成格（只用于深浅/沙泥的衰减尺度，不需要精确）。
  swShoreDistance = max(0.0, swSdfWater) * 2.2;
  // 陆地侧的「到水距离」：岸边沙泥用（2.2 格内由沙泥过渡到土壤）。
  float swInlandDistance = max(0.0, -swSdfWater) * 2.2;
  float swShoreNear = smoothstep(2.2, 0.15, swInlandDistance) * (1.0 - swWater);
  float swContinental = swFbm(swP * 8.0);
  float swPixelFootprint = swPixelFootprintEarly;
  float swMicroDetail = 1.0 - smoothstep(0.09, 0.42, swPixelFootprint);
  float swGrain = mix(0.5, swFbm(swSurfacePosition * 2.4), swMicroDetail);
  float swFine = mix(0.5, swNoise(swSurfacePosition * 13.0), 1.0 - smoothstep(0.025, 0.12, swPixelFootprint));
  float swRidges = abs(swNoise(swSurfacePosition * 1.7 + swContinental) * 2.0 - 1.0);
  // 纹理一次重复 ≈ 3 格（1K 纹理铺 3 格时近景细节够，又不会细到成噪点）；
  // 贴地时脚下一格约 300px，故在「每格像素覆盖 > 0.3 格」就开始淡出，
  // 远景（全球视角）只剩图集宏观色，避免摩尔纹闪烁。
  float swTexScale = 1.0 / max(0.0001, swTileWorldSize * 3.0);
  float swTexDetail = 1.0 - smoothstep(0.25, 1.1, swPixelFootprint / max(0.0001, swTileWorldSize));
  // 法线（bump）的尺度：地表纹理一张 1024² 铺 3 格，所以 1 texel = swTexelWorld。
  // - 一个像素覆盖的 texel 数决定高度该取哪级 mip：贴地 1–2 texel/像素时至少滤到 2 texel；
  // - bump 强度按同一尺度衰减：像素跨过 2–7 texel 后高度差已是纹素噪声，再参与光照就是闪烁。
  float swTexelWorld = swTileWorldSize * 3.0 / 1024.0;
  float swTexelsPerPixel = swPixelFootprint / max(0.000001, swTexelWorld);
  swHeightLod = clamp(log2(max(swTexelsPerPixel, 1.0)), 0.0, 8.0);
  float swBumpDetail = 1.0 - smoothstep(1.5, 7.0, swTexelsPerPixel);
  // 近景用第二尺度采样打散平铺重复感（低频大块 + 细节层）。
  float swTexMacro = 1.0 / max(0.0001, swTileWorldSize * 11.0);
  vec3 swTriW = swTriplanarWeights(swSurfacePosition);
  float swBiomeNoise = swFbm(swP * 5.3 + swSeed * 17.0);
  float swBiomeNoise2 = swFbm(swP * 15.7 + swSeed * 31.0 + 7.0);
  // 服务端 height（0..1）只做颜色/潮湿度变化，不抬升几何（建筑与拾取都在数学球面上）。
  float swElevation = swHeat.b;
  vec3 swSurfaceAlbedo = swAlbedo;
  float swSurfaceRough = 0.92;
  float swSurfaceHeight = 0.0;

  if (swKnown > 0.001) {
    if (swWater > 0.5) {
      // 水面：深青底 + 近岸浅色（离岸距离是连续场，浅滩沿真实海岸线渐变）。
      float swDepth = smoothstep(0.0, 0.55, swShoreDistance);
      vec3 swDeep = vec3(0.008, 0.038, 0.055);
      vec3 swShallow = vec3(0.020, 0.100, 0.110);
      vec3 swWaterAlbedo = mix(swShallow, swDeep, swDepth);
      // 两层滚动法线（细节用高度扰动交给 normal 段；冻结时 swTime 固定相位）。
      vec3 swWavePosition = swSurfacePosition / max(0.0001, swTileWorldSize);
      float swWaveDetail = 1.0 - smoothstep(0.025, 0.16, swPixelFootprint / swTileWorldSize);
      float swWaveA = sin(dot(swWavePosition, vec3(14.0, 8.0, 19.0)) - swTime * 1.3);
      float swWaveB = sin(dot(swWavePosition, vec3(-31.0, 17.0, 12.0)) + swTime * 1.7);
      float swWaveC = sin(dot(swWavePosition, vec3(53.0, 26.0, -39.0)) - swTime * 2.1);
      // 水波 UV 用球面三平面（与地形纹理同一套，无接缝），两个不同尺度各自滚动。
      // 水面用球面 UV（经度/纬度）：球面上处处连续，没有三平面在 45° 处的混合带。
      // 重复次数按格宽定：约 1.6 格一次（贴地时一格约 300px，浪纹尺度接近真实水面；
      // 再稀疏就会读成大片云影），远处交给 mipmap。
      float swWaveRepeat = max(4.0, swMapWidth / 3.0 / 1.6);
      vec2 swSphereUV = vec2(atan(swP.z, swP.x) / 6.2831853 + 0.5, asin(clamp(swP.y, -1.0, 1.0)) / 3.14159265 + 0.5);
      // 极点处经度会挤压：按纬度补偿横向重复次数。
      float swLat = max(0.25, cos(asin(clamp(swP.y, -1.0, 1.0))));
      vec2 swWaveUV1 = vec2(swSphereUV.x * swWaveRepeat / swLat, swSphereUV.y * swWaveRepeat) + vec2(swTime * 0.012, swTime * 0.007);
      vec2 swWaveUV2 = vec2(swSphereUV.x * swWaveRepeat * 0.47 / swLat, swSphereUV.y * swWaveRepeat * 0.47) - vec2(swTime * 0.007, swTime * 0.015);
      vec3 swWaterN1 = texture2D(swWaterNormal, swWaveUV1).rgb;
      vec3 swWaterN2 = texture2D(swWaterNormal, swWaveUV2).rgb;
      // 水波法线：两层法线图 xy 的偏差（z 分量用作强度包络），按细节距离淡出。
      float swRipple = ((swWaterN1.r - 0.5) + (swWaterN2.g - 0.5)) * swWaveDetail * 1.6;
      swWaterNormalXY = vec2(swWaterN1.r - 0.5, swWaterN2.g - 0.5) * 2.0 * swWaveDetail;
      swEastW = normalize(cross(vec3(0.0, 1.0, 0.0), swP) + vec3(0.0001));
      swSouthW = cross(swP, swEastW);
      swWaveDetailOut = swWaveDetail;
      // 波纹明暗 + 轻微浪峰高光（确定性：只依赖 swTime）。
      float swWaveCrest = swRipple * 3.2 + (swWaveA * swWaveB) * 0.08 * swWaveDetail;
      swSurfaceAlbedo = swWaterAlbedo * (0.92 + swWaveCrest * 0.18);
      swSurfaceAlbedo += vec3(0.06, 0.10, 0.115) * max(0.0, swWaveCrest) * 0.45 * swWaveDetail;
      // 泡沫线：只在已知陆/水相邻处出现（跨面邻接规则不变），沿连续岸线走。
      float swFoamEdge = 0.045 + 0.012 * swWaveA;
      float swFoamAA = max(fwidth(swShoreDistance), 0.003);
      float swFoam = (1.0-smoothstep(swFoamEdge,swFoamEdge+swFoamAA,swShoreDistance)) * swKnown;
      swSurfaceAlbedo += vec3(0.10, 0.17, 0.17) * swFoam * (0.6 + swWaveB * 0.2);
      // 菲涅尔 + 假环境反射：反射方向由扰动法线决定，天空色按反射仰角从地平线雾色渐变到天顶深青，
      // 再叠一个太阳镜面高光（对象空间计算：太阳相对相机固定，世界旋转时高光跟着转）。
      vec3 swViewDir = normalize(swCameraObject - swSurfacePosition);
      float swGrazing = 1.0 - clamp(dot(swViewDir, swP), 0.0, 1.0);
      float swFresnel = 0.02 + 0.98 * pow(swGrazing, 5.0);
      // 水面在 PBR 上是「粗糙介质 + 自定义天空反射」：环境图（程序化房间）会给光滑面
      // 映出大片云状亮斑，这里把粗糙度压高让环境项几乎不贡献，反射由 swWaterSky 负责。
      swSurfaceRough = mix(0.40, 0.60, swGrazing);
      // 水体视为电介质：金属度 0（默认 metalnessFactor 0.02 在 ACES 下也会把环境图拉成亮斑）。
      swWaterMetal = 0.0;
      swWaterFresnel = swFresnel;
      swSurfaceHeight = (swWaveA * 0.0012 + swWaveB * 0.0006 + swWaveC * 0.0003) * swTileWorldSize * swWaveDetail
        + swRipple * swTileWorldSize * 0.0016;
      swWaterMask = swKnown;
    } else if (swLava > 0.5) {
      // 岩浆：冷却硬壳（玄武质板块）+ 裂缝里的热熔体 + 橙红自发光。
      // 纹理一律用**球面三平面**采样（与陆地同一套）：熔岩图沿世界轴向的 UV 拉伸会在
      // 近景变成纵向条带，三平面没有这个问题。流动用不同相位/尺度的两层叠加。
      // 三层噪声：板块（硬壳厚薄）、裂缝（交界）、熔体流动。
      float swPlateNoise = swFbm(swSurfacePosition * 1.7 + 3.3);
      float swPlateNoise2 = swFbm(swSurfacePosition * 4.3 + 17.1);
      // 硬壳板块：阈值偏「多壳」；壳越厚越黑。
      float swCrustMask = smoothstep(0.34, 0.60, swPlateNoise * 0.72 + swPlateNoise2 * 0.38);
      // 板块交界（Voronoi 式细缝）：两层噪声等值线附近形成网状裂缝，缝隙里透热。
      float swSeamA = 1.0 - smoothstep(0.0, 0.045, abs(swPlateNoise - 0.52));
      float swSeamB = 1.0 - smoothstep(0.0, 0.030, abs(swPlateNoise2 - 0.48));
      float swSeam = max(swSeamA, swSeamB * 0.85);
      // 硬壳表面：玄武岩纹理（球面三平面，无 UV 拉伸），压得很暗。
      vec3 swFlow = swSurfacePosition * swTexScale * 1.15;
      vec3 swCrust = texture2D(swAlbedoArray, vec3(swFlow.xz, 6.0)).rgb * swTriW.x
        + texture2D(swAlbedoArray, vec3(swFlow.zy, 6.0)).rgb * swTriW.y
        + texture2D(swAlbedoArray, vec3(swFlow.xy, 6.0)).rgb * swTriW.z;
      // 熔体：自发光图两层（不同尺度、缓慢反向漂移），只出现在裂缝与薄壳处。
      vec2 swMeltUV = vec2(dot(swSurfacePosition, vec3(0.91, 0.37, 0.19)), dot(swSurfacePosition, vec3(-0.28, 0.86, 0.43)));
      vec3 swEmitA = texture2D(swLavaEmissionMap, swMeltUV * (swTexScale * 1.1) + vec2(swTime * 0.004, -swTime * 0.003)).rgb;
      vec3 swEmitB = texture2D(swLavaEmissionMap, swMeltUV.yx * (swTexScale * 2.3) - vec2(swTime * 0.007, swTime * 0.005)).rgb;
      vec3 swEmit = mix(swEmitA, swEmitB, 0.42);
      float swMelt = clamp((1.0 - swCrustMask) * 0.55 + swSeam * 0.85, 0.0, 1.0);
      // 壳色：暗玄武岩（近黑但有细节），裂缝/薄壳处是暗红熔体反照率。
      vec3 swCrustAlbedo = swCrust * 0.09 + vec3(0.014, 0.012, 0.012);
      vec3 swMeltAlbedo = swEmit * swEmit * vec3(0.30, 0.065, 0.02);
      // 反照率只在裂缝/薄壳处透一点暗红；壳面保持黑玄武岩。
      swSurfaceAlbedo = mix(swCrustAlbedo, swMeltAlbedo, swMelt * 0.7);
      // 自发光：取纹理亮度（luma）当热强度，再乘橙红色温——不直接用图里的 RGB，
      // 否则 8-bit 图的红通道饱和后色温被拉偏、bloom 只吃到一片浅橙。
      // 只有薄壳/裂缝处的热熔体发光（壳面几乎不发光），bloom 阈值 2.5 才能吃到。
      float swHeat = dot(swEmit, vec3(0.299, 0.587, 0.114));
      float swHeatContrast = pow(clamp(swHeat, 0.0, 1.0), 2.2);
      float swMeltHeat = clamp((1.0 - swCrustMask) * 0.30 + swSeam, 0.0, 1.0);
      vec3 swLavaGlow = vec3(1.0, 0.22, 0.045) * swHeatContrast * swMeltHeat * 1.6;
      swLavaGlow += vec3(1.2, 0.20, 0.04) * swSeam * 0.22;
      swLavaEmissive = swLavaGlow * swKnown;
      swSurfaceRough = mix(0.52, 0.95, swCrustMask);
      swSurfaceHeight = (swCrustMask * 0.34 + swSeam * 0.12) * swTileWorldSize * 0.004;
      swLavaMask = swKnown;
    } else {
      // 陆地：苔草 / 火山土 / 碎石按噪声混合；岩性权重（swRock）双线性后是连续场，
      // 在 0.28–0.72 之间与玄武岩/地衣岩交叉淡化——阻挡格边界不再是沿格线的硬切方块（L15）。
      float swRockMix = smoothstep(0.28, 0.72, swRock);
      float swTexLod = clamp(swPixelFootprint / max(0.0001, swTileWorldSize), 0.6, 2.6);
      float swTexScaleLod = swTexScale * mix(0.72, 1.25, (swTexLod - 0.6) / 2.0);
      vec3 swTextured = vec3(0.0);
      float swRoughTextured = 0.9;
      float swLandHeight = 0.0;
      if (swRockMix < 0.999) {
        // 按权重取两种纹理做高度混合。
        float swLayerA; float swLayerB; float swWeightA; float swWeightB;
        if (swBiomeIce > 0.5) {
          // 雪 / 蓝冰 / 裸岩：三个权重归一化后取前两名，避免同分时选层不稳定。
          float wSnow = swSoilWeights.x * (0.5 + swBiomeNoise * 0.7);
          float wBare = swSoilWeights.y * (0.5 + (1.0 - swBiomeNoise) * 0.5);
          float wIce = swSoilWeights.z * (0.6 + swBiomeNoise2 * 0.6);
          float total = wSnow + wBare + wIce;
          wSnow /= total; wBare /= total; wIce /= total;
          float wTop = max(wSnow, max(wBare, wIce));
          swWeightA = wTop;
          swWeightB = 1.0 - wTop;
          if (wTop == wSnow) { swLayerA = 8.0; swLayerB = wIce >= wBare ? 9.0 : 7.0; }
          else if (wTop == wIce) { swLayerA = 9.0; swLayerB = wSnow >= wBare ? 8.0 : 7.0; }
          else { swLayerA = 7.0; swLayerB = wSnow >= wIce ? 8.0 : 9.0; }
        } else {
          // 苔草 / 火山土 / 碎石：大尺度噪声决定区块，纹理高度决定交界。
          float wMoss = swSoilWeights.x * (0.45 + swBiomeNoise * 0.9);
          float wSoil = swSoilWeights.y * (0.35 + swBiomeNoise2 * 0.9);
          float wGravel = swSoilWeights.z * (0.4 + (1.0 - swBiomeNoise) * 0.8);
          float total = wMoss + wSoil + wGravel;
          wMoss /= total; wSoil /= total; wGravel /= total;
          float wTop = max(wMoss, max(wSoil, wGravel));
          swWeightA = wTop;
          swWeightB = 1.0 - wTop;
          if (wTop == wMoss) { swLayerA = 0.0; swLayerB = wSoil >= wGravel ? 2.0 : 3.0; }
          else if (wTop == wSoil) { swLayerA = 2.0; swLayerB = wMoss >= wGravel ? 0.0 : 3.0; }
          else { swLayerA = 3.0; swLayerB = wMoss >= wSoil ? 0.0 : 2.0; }
        }
        // 贴地极近时一格占满半屏，同一张贴图重复次数太多会闪成高频噪点：
        // 按像素脚印把采样尺度在 0.72–1.25 之间收放（近处纹理放大、远处略缩），
        // 远处仍按距离淡出到宏观色。
        SwSurface swA = swSampleLayer(swLayerA, swSurfacePosition, swTriW, swTexScaleLod);
        SwSurface swB = swSampleLayer(swLayerB, swSurfacePosition, swTriW, swTexScaleLod);
        // 宏观尺度再采一次主层（另一相位），用低频权重混合，破坏同一张贴图的周期性重复。
        SwSurface swMacro = swSampleLayer(swLayerA, swSurfacePosition + vec3(0.37, 0.11, 0.53), swTriW, swTexMacro);
        // 第三层：不同旋转相位的中尺度采样，进一步打散「同一朵花纹重复出现」的观感。
        vec3 swRotated = swSurfacePosition * swTexScaleLod;
        swRotated = vec3(swRotated.z * 0.94 + swRotated.x * 0.34, swRotated.y, -swRotated.x * 0.34 + swRotated.z * 0.94) + vec3(5.1, 3.7, 8.9);
        vec3 swMacroTint = texture2D(swAlbedoArray, vec3(swRotated.xz, swLayerA)).rgb * 0.5
          + texture2D(swAlbedoArray, vec3(swRotated.zy, swLayerA)).rgb * 0.5;
        float swMacroMix = 0.30 + 0.18 * swBiomeNoise2;
        float swBlend = swHeightBlend(swA.height, swB.height, swWeightA, swWeightB, swBiomeNoise2);
        // 群落交界处打散成 1–3 格宽的斑块，而不是沿噪声等值线的整片边界。
        swBlend = smoothstep(0.22, 0.78, swBlend + (swBiomeNoise2 - 0.5) * 0.55);
        swTextured = mix(swB.albedo, swA.albedo, swBlend);
        swTextured = mix(swTextured, swTextured * (swMacro.albedo * 2.1 + 0.45), swMacroMix * swTexDetail);
        // 中尺度调制：只改明暗（约 ±12%），不引入第二种颜色，避免近景发花。
        swTextured *= mix(vec3(1.0), 0.82 + swMacroTint * 0.36, swTexDetail * 0.35);
        swRoughTextured = mix(swB.rough, swA.rough, swBlend);
        // 潮湿度：低洼（height 小）更湿、颜色偏冷偏暗；高处更干更亮。
        float swWet = (1.0 - swElevation) * (0.35 + swBiomeNoise * 0.35);
        swTextured *= mix(1.0, 0.78, swWet) * mix(0.92, 1.10, swElevation);
        swTextured = mix(swTextured, swTextured * vec3(0.86, 0.94, 1.0), swWet * 0.5);
        swLandHeight = (swA.height * swBlend + swB.height * (1.0 - swBlend) - 0.5) * 0.02;
      }
      if (swRockMix > 0.001) {
        // 玄武岩 / 地衣岩：同一套三平面与高度混合，边界处与土壤交叉淡化。
        SwSurface swRockA = swSampleLayer(6.0, swSurfacePosition, swTriW, swTexScaleLod);
        SwSurface swRockB = swSampleLayer(7.0, swSurfacePosition, swTriW, swTexScaleLod);
        float swRockWeight = 0.55 + swBiomeNoise * 0.45;
        float swRockBlend = smoothstep(0.22, 0.78, swHeightBlend(swRockA.height, swRockB.height, swRockWeight, 1.0 - swRockWeight, swBiomeNoise2));
        vec3 swRockAlbedo = mix(swRockB.albedo, swRockA.albedo, swRockBlend);
        float swRockRough = mix(swRockB.rough, swRockA.rough, swRockBlend);
        float swRockHeight = (swRockA.height * swRockBlend + swRockB.height * (1.0 - swRockBlend) - 0.5) * 0.02;
        swTextured = mix(swTextured, swRockAlbedo, swRockMix);
        swRoughTextured = mix(swRoughTextured, swRockRough, swRockMix);
        swLandHeight = mix(swLandHeight, swRockHeight, swRockMix);
      }
      // 近景至少保留 72% 纹理，宏观色只做色相底；否则近景会被旧图集色压回「纯色平面」。
      swSurfaceAlbedo = mix(swAlbedo, swTextured, mix(0.72, 1.0, swTexDetail));
      // 陆地粗糙度：纹理 B 通道在 0.0–0.7（苔草只有 .27），直接当 PBR 粗糙度会把太阳镜面
      // 打成一颗颗亮斑。重映射到 0.84–1.0：只保留「哪里更潮更亮」的相对差异，不再有镜面。
      swSurfaceRough = mix(0.92, mix(0.84, 1.0, clamp(swRoughTextured, 0.0, 1.0)), swTexDetail);
      swSurfaceHeight = mix(0.0, swLandHeight, swTexDetail * swBumpDetail);
      // 临水一圈沙泥；临岩浆一圈焦土/火山灰。两者都来自连续距离场（见 swShoreCells / heat.r），
      // 边界随海岸线圆润过渡，不沿格线走方块。
      float swSand = swShoreNear;
      vec3 swSandAlbedo = swSampleLayer(5.0, swSurfacePosition, swTriW, swTexScale).albedo;
      swSurfaceAlbedo = mix(swSurfaceAlbedo, swSandAlbedo, clamp(swSand * 0.75, 0.0, 1.0));
      float swScorch = swLavaNear;
      swSurfaceAlbedo = mix(swSurfaceAlbedo, swSurfaceAlbedo * vec3(0.30, 0.26, 0.24), clamp(swScorch * 0.85, 0.0, 1.0));
    }
    // 群落偏色（按星球种子）：只微调色相/饱和/明度，不改变纹理结构。
    swSurfaceAlbedo = swSaturate(swSurfaceAlbedo * swBiomeTint, swBiomeSaturation) * swBiomeBrightness;
  }
  // 远景宏观色：像素覆盖过大时纹理已退回图集色，仍保持原有的土壤色差。
  vec3 swSoilTint = mix(vec3(0.82, 0.91, 0.91), vec3(1.03, 1.03, 0.94), swContinental);
  swSurfaceAlbedo *= mix(swSoilTint * (0.94 + swGrain * 0.08 + swFine * 0.04), vec3(0.95 + swContinental * 0.1), swWater);
  swSurfaceAlbedo *= 1.0 - swRock * smoothstep(0.64, 0.95, swRidges) * 0.25;
  if (swWaterMask > 0.001) {
    vec3 swPerturbed = normalize(swP - swWaterNormalXY.x * 0.30 * swEastW - swWaterNormalXY.y * 0.30 * swSouthW);
    vec3 swRefl = reflect(-normalize(swCameraObject - swSurfacePosition), swPerturbed);
    float swUp = clamp(swRefl.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 swSkyHorizon = vec3(0.022, 0.042, 0.058);
    vec3 swSkyZenith = vec3(0.004, 0.012, 0.026);
    vec3 swSky = mix(swSkyHorizon, swSkyZenith, pow(swUp, 1.2));
    vec3 swSunDir = normalize(swSunObject);
    float swGlint = pow(max(dot(swRefl, swSunDir), 0.0), 140.0) * 0.55;
    float swGlintWide = pow(max(dot(swRefl, swSunDir), 0.0), 24.0) * 0.02;
    // 反射只取半球以上的天空（法线朝下时反射看到的是「地面」，不该发亮）。
    // 只有反射方向朝上（看到天空）才有反射；朝下（看到岸/自己）不发光。
    float swSkyAbove = smoothstep(0.0, 0.5, swRefl.y);
    swWaterSky = (swSky + vec3(1.0, 0.86, 0.68) * (swGlint + swGlintWide)) * (0.10 + swWaterFresnel * 0.7) * swSkyAbove;
  }
  // 未探索面纱：深石板 + 细测绘网格 + 淡等高线式程序纹理（与真实地形无关）。
  float swVeilPatch = swFbm(swP * 6.5 + 3.1);
  float swVeilGrain = mix(0.5, swFbm(swSurfacePosition * 1.6 + 11.0), swMicroDetail);
  float swVeilRelief = mix(0.5, swNoise(swSurfacePosition * 24.0 + 5.0), 1.0 - smoothstep(0.03, 0.14, swPixelFootprint));
  // Tile-scale grid: one line per map cell, only legible while a cell spans a
  // reasonable pixel footprint (close range); fades out well before the globe view.
  float swGridCell = max(1.0, swMapWidth * 0.02);
  vec2 swGridUV = swCellUV * max(1.0, 1.0 / swGridCell);
  vec2 swGridWidth = fwidth(swGridUV);
  vec2 swGridLine = 1.0 - smoothstep(vec2(0.0), swGridWidth * 1.6, abs(fract(swGridUV + 0.5) - 0.5));
  float swGridFade = 1.0 - smoothstep(0.02, 0.10, swPixelFootprint);
  float swSurveyGrid = max(swGridLine.x, swGridLine.y) * swGridFade;
  // 等高线式程序纹理：与真实地形无关的缓慢条带，只用来读「这是未知测绘区」。
  float swContour = abs(fract(swFbm(swP * 9.0 + 4.7) * 6.0) - 0.5);
  float swContourLine = (1.0 - smoothstep(0.02, 0.10, swContour)) * swGridFade;
  vec3 swVeil = vec3(0.046, 0.062, 0.088) * (0.82 + swContinental * 0.08 + swVeilPatch * 0.10 + swVeilGrain * 0.10 + swVeilRelief * 0.07);
  swVeil += vec3(0.030, 0.052, 0.062) * swSurveyGrid * 0.75;
  swVeil += vec3(0.012, 0.026, 0.030) * swContourLine * 0.6;
  // Fog frontier edge light: a soft band where the unknown region meets explored
  // land, so the boundary reads as a scan frontier instead of a hard cut.
  swVeil += vec3(0.050, 0.115, 0.130) * swKnownEdge * (0.25 + 0.75 * (1.0 - smoothstep(0.0, 0.5, length(swCellUV - 0.5))));
  // layers.fog = off：不盖测绘面纱。未探索格没有地形数据（未知格），仍用面纱的不透明
  // 填充当底色，只是去掉网格/前沿光/浮雕——否则会露出球体背面的天体，画面读成「星球消失」。
  vec3 swUnknownBase = vec3(0.046, 0.062, 0.088);
  swAlbedo = swSurfaceAlbedo;
  swAlbedo = mix(mix(swAlbedo, mix(swUnknownBase, swVeil, swFog), swFog), swAlbedo, swKnown);
  // 水色偏深：水体反照率不能压过天空反射，否则近景一大片青绿。
  swAlbedo = mix(swAlbedo, swAlbedo * vec3(0.72, 0.86, 0.92), swWaterMask * 0.55);
  swAlbedo = mix(swAlbedo * vec3(0.71, 0.78, 0.86), swAlbedo, mix(0.4, 1.0, swProps.a));
  diffuseColor.rgb *= swAlbedo;
  swHeightField = mix(swSurfaceHeight + (swGrain * 0.004 + swFine * 0.001 + swRidges * swRock * 0.010) * swBumpDetail, swSurfaceHeight, swWater) * swKnown;
  // Unknown cells keep a shallow tile-scale relief so the close ground view has
  // horizon/relief cues (gated by (1 - swKnown), never leaks explored terrain).
  swHeightField += swVeilRelief * 0.010 * (1.0 - swKnown) * swFog;
`;
