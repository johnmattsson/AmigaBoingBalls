// =============================================================================
// shaders.js — the small programs that run on the graphics card (GPU).
//
// Every object is drawn by a pair of shaders written in GLSL (a C-like
// language for GPUs):
//
//   vertex shader   – runs once per corner of each shape and decides
//                     WHERE on screen that corner goes.
//   fragment shader – runs once per pixel covered by the shape and decides
//                     WHAT COLOUR that pixel is.
//
// We draw these things, in this order:
//   0. the backdrop (optional "copper bars" behind everything)
//   1. the floor   (invisible itself: it only shows shadows)
//   2. the walls   (the purple grid lines of the box, and shadows on them)
//   3. the balls   (red/white etc. checkerboard spheres)
//   3b. the trails (optional fading lines behind the balls)
//   4. the picture is copied to the screen (see "Linear light" below)
//
// -----------------------------------------------------------------------------
// PERFECT SPHERES
// -----------------------------------------------------------------------------
// The balls are not built from triangles. Each ball is drawn as one flat
// square that faces the camera and just covers the ball. For every pixel of
// that square, the shader sends a ray from the camera through the pixel and
// works out exactly where it hits the ball (or how far it misses it). So the
// balls are perfectly round at any zoom, and their outlines are smoothed with
// the same rule as every other edge.
//
// -----------------------------------------------------------------------------
// SHADOWS (and why balls can shadow each other)
// -----------------------------------------------------------------------------
// Every object that casts a shadow is a perfect sphere, so for each pixel we
// simply ask: "standing on this spot and looking straight at the lamp, is a
// ball in the way?" The lamp is a single point, so shadows have sharp,
// old-school edges. The same test shades the floor, the grid lines AND the
// balls, which is what gives ball-on-ball shadows.
//
// -----------------------------------------------------------------------------
// SMOOTH BUT SHARP EDGES (anti-aliasing)
// -----------------------------------------------------------------------------
// A screen is a grid of square pixels. Colouring a pixel only by whether its
// centre is inside a shape gives stair-stepped edges that flicker. Instead,
// every edge — ball outlines, checker squares, grid lines and shadows — is
// blended across about one pixel (uEdgeWidth), according to how much of the
// pixel the shape covers. All edges go through smoothEdge(), so they are
// guaranteed to look the same.
//
// -----------------------------------------------------------------------------
// LINEAR LIGHT
// -----------------------------------------------------------------------------
// Colour values on screen are not proportional to brightness: a value of 50 %
// shows only about 20 % of the light. Mixing those values directly (as
// almost all old software did) makes the in-between pixels at an edge too
// dark, so edges look heavy. We therefore convert colours to "linear light"
// (real brightness), do every mix there, and convert back at the very end.
//
// The solid colours stay exactly those of release 1.3: the shadow is still
// "40 % darker" in screen values, and the grid's see-through purple still
// shows exactly the same shade. Only the in-between edge pixels change.
// =============================================================================

// The most balls the shaders can handle. Arrays in shaders need a fixed size.
export const MAX_BALLS = 128;

// The shadow grid (see "Shadows" below and fillShadowGrid in renderer.js).
export const SHADOW_GRID = 64;     // cells across and down
export const SHADOW_SLOTS = 32;    // most balls one cell can list

// The list of balls, needed by several shaders. It lives in a "uniform
// buffer": one block of memory that renderer.js fills once per frame and all
// shader programs share. (Plain uniform arrays only have guaranteed room for
// about 40 balls; a uniform buffer has room for at least 200.)
//
// The block's layout follows the "std140" rules, under which every entry of
// these arrays takes 16 bytes (a vec4), and a mat3 takes three of them.
// renderer.js packs the numbers in exactly this order.
const BALL_LIST = /* glsl */ `
  const int MAX_BALLS = ${MAX_BALLS};
  layout(std140) uniform Balls {
    vec4 uBalls[MAX_BALLS];          // xyz = centre of each ball, w = radius
    vec4 uBallColor[MAX_BALLS];      // rgb = colour, a = checker squares from pole to pole
    mat3 uBallRotation[MAX_BALLS];   // how each ball is turned
  };
  uniform int uBallCount;            // how many balls there are
`;

// Code shared by every fragment (pixel) shader that draws the scene.
const PIXEL_TOOLS = /* glsl */ `
  ${BALL_LIST}
  uniform vec3  uLightPosition;     // the lamp (a single point)
  uniform vec3  uLightForward;      // the direction the lamp looks in (towards the scene),
  uniform vec3  uLightSide;         //   and two directions at right angles to it: these
  uniform vec3  uLightUp;           //   are "sideways" and "up" in the lamp's view
  uniform highp usampler2D uShadowGrid;   // which balls can shadow where (see below)
  uniform float uShadowRange;       // how much of the lamp's view the grid covers
  uniform float uShadowStrength;    // 0.4 = shadows are 40 % darker
  uniform float uEdgeWidth;         // how many pixels an edge is blended over

  // How a shadow is painted on the floor and on the walls between the grid
  // lines: as a see-through layer of this colour, this opaque where the
  // shadow is full. Over the plain grey backdrop it is the grey's shadowed
  // shade, fully opaque (exactly the classic look). Over the copper bars
  // there is no single colour to darken, so it is see-through black instead.
  uniform vec3  uShadowColor;       // in linear light
  uniform float uShadowOpacity;

  // ---- Colour ---------------------------------------------------------------

  // Screen colour (sRGB, what colour pickers show) → linear light.
  vec3 toLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }

  // The final colour of a surface with screen colour 'color', given how much
  // of this pixel is in shadow (0 = none, 1 = all). Like release 1.3, "in
  // shadow" means the screen colour times 0.6. The blend between lit and
  // shadowed (at a shadow's edge) happens in linear light.
  vec3 shade(vec3 color, float shadow) {
    vec3 lit      = toLinear(color);
    vec3 shadowed = toLinear(color * (1.0 - uShadowStrength));
    return mix(lit, shadowed, shadow);
  }

  // ---- Edges ----------------------------------------------------------------

  // THE edge rule used for everything in the scene.
  //
  // pixelsInside: how far this pixel's centre is inside a shape, measured in
  // pixels (negative = outside). Returns how much of the pixel the shape
  // covers: 1 when well inside, 0 when well outside, and a smooth blend
  // across the edge.
  float smoothEdge(float pixelsInside) {
    return clamp(pixelsInside / uEdgeWidth + 0.5, 0.0, 1.0);
  }

  // Turn a distance measured in the world into a distance in pixels.
  // fwidth() tells how much a value changes from one pixel to the next,
  // so dividing by it gives "how many pixels away".
  float inPixels(float worldDistance) {
    return worldDistance / max(fwidth(worldDistance), 1e-6);
  }

  // ---- Skipping hidden pixels ------------------------------------------------
  //
  // Before the main drawing, renderer.js draws all balls once very cheaply,
  // only to record how far away the nearest fully covering ball is at every
  // pixel (uFrontDepth). Anything farther away than that is hidden, so it can
  // skip its expensive colouring and shadow work.
  //
  // One rule makes this safe: dFdx/dFdy/fwidth compare neighbouring pixels,
  // so every pixel must still be running when they are used. So we always
  // measure everything that needs them first, and only then skip.
  uniform highp sampler2D uFrontDepth;

  bool hiddenBehindBall(float depth) {
    float front = texelFetch(uFrontDepth, ivec2(gl_FragCoord.xy), 0).r;
    return depth > front + 1e-5;
  }

  // How far a point moves from this pixel to the next, sideways (x) and
  // downwards (y). Call before any skipping, see above.
  void pixelSteps(vec3 p, out vec3 stepX, out vec3 stepY) {
    stepX = dFdx(p);
    stepY = dFdy(p);
  }

  // ---- Shadows --------------------------------------------------------------

  // How much of the pixel at point p is in shadow: 0 = lit, 1 = shadowed.
  //
  // skipBall: the ball this point belongs to (or -1). A ball never shadows
  // itself — the balls are drawn without lighting, so their "night side"
  // would otherwise turn dark too, which is not the classic look.
  //
  // THE SHADOW GRID. This runs for every pixel, so with 100 balls checking
  // every ball would be slow. Instead, picture standing at the lamp and
  // looking down: each ball covers a small patch of that view. Once per
  // frame, renderer.js divides the view into a grid of 64 × 64 cells and
  // lists, for every cell, the few balls that cover part of it. Here we find
  // which cell this point is in (seen from the lamp) and only check the
  // balls listed there.
  //
  // "Seen from the lamp" is measured as sideways distance divided by
  // distance away from the lamp (below it, for the usual lamp overhead), so
  // everything on one line from the lamp lands in the same spot. renderer.js works out how much of that view the scene
  // takes up (uShadowRange: about −0.4 … +0.4 for the box), and the grid
  // covers exactly that.
  //
  // stepX, stepY: how far p moves from this pixel to the next one, sideways
  // and downwards — get them with pixelSteps() below.
  float shadowAt(vec3 p, vec3 stepX, vec3 stepY, int skipBall) {
    float pixelReach = (length(stepX) + length(stepY)) * uEdgeWidth;

    vec3  toLight   = uLightPosition - p;
    float lightDist = length(toLight);
    vec3  lightDir  = toLight / lightDist;

    // Which grid cell is this point in, as seen from the lamp? (How far
    // sideways and up it is in the lamp's view, divided by how far away.)
    float ahead = -dot(toLight, uLightForward);
    if (ahead <= 0.0) return 0.0;   // behind the lamp
    vec2  seen = -vec2(dot(toLight, uLightSide), dot(toLight, uLightUp)) / ahead;
    ivec2 cell = ivec2(floor((seen / (2.0 * uShadowRange) + 0.5) * ${SHADOW_GRID}.0));
    if (any(lessThan(cell, ivec2(0))) || any(greaterThanEqual(cell, ivec2(${SHADOW_GRID})))) return 0.0;

    float shadow = 0.0;
    for (int slot = 0; slot < ${SHADOW_SLOTS}; slot++) {
      uint listed = texelFetch(uShadowGrid, ivec2(cell.x * ${SHADOW_SLOTS} + slot, cell.y), 0).r;
      if (listed == 255u) break;     // end of this cell's list
      int i = int(listed);
      if (i == skipBall) continue;   // never our own ball

      vec3  toBall = uBalls[i].xyz - p;
      float radius = uBalls[i].w;

      // How far along the line towards the lamp we get closest to the
      // ball's centre. Balls behind us, or beyond the lamp, are not in the way.
      float along = dot(toBall, lightDir);
      if (along <= 0.0 || along >= lightDist) continue;

      // The sideways distance from the line to the ball's centre.
      vec3  miss   = toBall - lightDir * along;
      float missSq = dot(miss, miss);
      // Quick skip: the line passes well clear of the ball (more than a
      // pixel's width outside it).
      if (missSq > (radius + pixelReach) * (radius + pixelReach)) continue;

      // How many pixels inside the shadow's edge we are. Moving p sideways
      // by 'step' changes the distance to the line by dot(direction, step),
      // so this is how much it changes from one pixel to the next.
      float missDist = sqrt(missSq);
      vec3  away     = miss / max(missDist, 1e-6);
      float perPixel = abs(dot(away, stepX)) + abs(dot(away, stepY));
      shadow = max(shadow, smoothEdge((radius - missDist) / max(perPixel, 1e-6)));

      // Several balls in a row don't make a shadow darker (just as with a
      // real lamp), so once fully in shadow there is nothing more to find.
      if (shadow >= 1.0) break;
    }

    return shadow;
  }
`;


// -----------------------------------------------------------------------------
// 1. FLOOR
//
// A big square below the box. It is invisible itself: all you see is the
// shadows on it.
//
// A shadow that would land beyond a side wall that is shown is drawn on that
// wall instead (see WALLS below), so the floor leaves it out.
// -----------------------------------------------------------------------------
export const FLOOR_VERTEX_SHADER = /* glsl */ `#version 300 es
  precision highp float;
  layout(location = 0) in vec2 aCorner;   // (-1,-1) … (1,1)
  uniform mat4  uViewProjection;
  uniform float uFloorY;          // height of the floor
  uniform float uFloorHalfSize;   // half its width
  out vec3 vWorld;
  void main() {
    vWorld = vec3(aCorner.x * uFloorHalfSize, uFloorY, aCorner.y * uFloorHalfSize);
    gl_Position = uViewProjection * vec4(vWorld, 1.0);
  }
`;

export const FLOOR_FRAGMENT_SHADER = /* glsl */ `#version 300 es
  precision highp float;
  precision highp int;
  ${PIXEL_TOOLS}
  uniform float uHalfSize;      // half the box's width
  uniform vec4  uWallShown;     // is the left, right, back, front wall drawn? (1/0)
  in vec3 vWorld;
  out vec4 outColor;
  void main() {
    vec3 stepX, stepY;
    pixelSteps(vWorld, stepX, stepY);
    if (hiddenBehindBall(gl_FragCoord.z)) discard;   // a ball covers this spot

    // Beyond a side wall that is shown: that wall has the shadow. (This
    // also holds past the wall's ends, because a shown wall catches shadows
    // there too — see uExtend in the wall shader.)
    if ((vWorld.x < -uHalfSize && uWallShown.x > 0.5) || (vWorld.x > uHalfSize && uWallShown.y > 0.5) ||
        (vWorld.z < -uHalfSize && uWallShown.z > 0.5) || (vWorld.z > uHalfSize && uWallShown.w > 0.5)) discard;

    float shadow = shadowAt(vWorld, stepX, stepY, -1);
    if (shadow <= 0.0) discard;
    outColor = vec4(uShadowColor, shadow * uShadowOpacity);
  }
`;


// -----------------------------------------------------------------------------
// 2. WALLS
//
// Each wall is a single square. Instead of drawing every grid line as a
// separate GL line (always 1 pixel thin and jagged), the fragment shader
// works out how close each pixel is to the nearest grid line and blends it in
// with the shared edge rule.
//
// The four side walls and the ceiling also catch the balls' shadows, like
// the back wall in the original Amiga demo. Between the lines a wall is see-through, so there
// a shadow is painted as a see-through dark layer (uShadowColor above).
//
// The walls between the camera and the box are hidden, and a shadow passes
// straight through a hidden wall. So that it still lands on something
// sensible, a shown wall catches shadows a good way past the end where its
// hidden neighbour would be (uExtend), as if it carried on towards you.
// Only shadows are drawn there, no grid lines — and the balls still bounce
// off the hidden wall.
// -----------------------------------------------------------------------------
export const WALL_VERTEX_SHADER = /* glsl */ `#version 300 es
  precision highp float;
  layout(location = 0) in vec2 aCorner;   // (-1,-1) … (1,1)

  uniform mat4  uViewProjection;
  uniform vec3  uWallCenter;   // middle of this wall
  uniform vec3  uWallAxisU;    // the wall's two in-plane directions
  uniform vec3  uWallAxisV;
  uniform float uHalfSize;     // half the wall's width
  uniform vec4  uExtend;       // how far shadows are caught past the +U, -U, +V, -V edge

  out vec2 vGrid;    // position on the wall, in box units (-6 … 6)
  out vec3 vWorld;

  // The lines along the edges of a wall sit exactly on the wall's border, so
  // half of their width would fall outside the square and get cut off. We
  // make the square a little bigger than the wall so those lines fit; the
  // fragment shader trims everything else back to the wall's real size.
  const float MARGIN = 0.25;

  void main() {
    vec2 high = uHalfSize + MARGIN + uExtend.xz;   // how far the square reaches each way
    vec2 low  = uHalfSize + MARGIN + uExtend.yw;
    vGrid = mix(-low, high, aCorner * 0.5 + 0.5);
    vWorld = uWallCenter + uWallAxisU * vGrid.x + uWallAxisV * vGrid.y;
    gl_Position = uViewProjection * vec4(vWorld, 1.0);
  }
`;

export const WALL_FRAGMENT_SHADER = /* glsl */ `#version 300 es
  precision highp float;
  precision highp int;
  ${PIXEL_TOOLS}

  // The colour of a line where it fully covers a pixel. In release 1.3 the
  // lines were 60 % see-through purple over the grey; renderer.js works out
  // that resulting shade, so the lines look exactly as before.
  uniform vec3  uColor;
  uniform float uLineOpacity;  // 1 = solid lines; less = backdrop shows through
  uniform float uCatchShadows; // 1 = shadows fall on this wall, 0 = they don't
  uniform float uLineWidth;    // in screen pixels
  uniform float uHalfSize;     // half the wall's width
  uniform vec4  uDrawEdge;     // draw the line on the +U, -U, +V, -V edge? (1/0)
  uniform vec4  uExtend;       // how far shadows are caught past the +U, -U, +V, -V edge

  in vec2 vGrid;
  in vec3 vWorld;
  out vec4 outColor;

  // How much of this pixel a line covers, given the distance (in pixels)
  // from the pixel's centre to the line's centre.
  float lineCoverage(float pixelsAway) {
    return smoothEdge(0.5 * uLineWidth - pixelsAway);
  }

  void main() {
    // fwidth() = how many box units one screen pixel covers here. Dividing
    // by it turns distances in box units into distances in pixels.
    vec2 unitsPerPixel = fwidth(vGrid);

    // There is a line at every whole number. Find the nearest one.
    vec2 nearestLine = floor(vGrid + 0.5);
    // (The tiny nudge settles ties. Without it, a hard-edged line lying
    // exactly between two rows of pixels would be shared half-and-half by
    // both, and show up pale and twice as thick.)
    vec2 toLine = abs((vGrid - nearestLine) / unitsPerPixel + 0.03);

    // Leave out the lines on edges that the neighbouring wall draws instead.
    float keepX = nearestLine.x >= uHalfSize ? uDrawEdge.x : nearestLine.x <= -uHalfSize ? uDrawEdge.y : 1.0;
    float keepY = nearestLine.y >= uHalfSize ? uDrawEdge.z : nearestLine.y <= -uHalfSize ? uDrawEdge.w : 1.0;

    float coverage = max(lineCoverage(toLine.x) * keepX, lineCoverage(toLine.y) * keepY);

    // Trim the extra margin: lines may stick out past the wall's edge by
    // half their width (so the edge line is whole), but no further.
    vec2 pastEdge = (abs(vGrid) - uHalfSize) / unitsPerPixel;
    coverage *= lineCoverage(max(pastEdge.x, pastEdge.y));

    // How much of this pixel lies on the part of the wall that catches
    // shadows (the wall itself plus uExtend). How far past each of the four
    // edges are we, in pixels?
    vec4 pastCatch = vec4(vGrid.x - uHalfSize - uExtend.x, -vGrid.x - uHalfSize - uExtend.y,
                          vGrid.y - uHalfSize - uExtend.z, -vGrid.y - uHalfSize - uExtend.w) / unitsPerPixel.xxyy;
    // Unlike every other edge, this border is NOT smoothed but cut exactly.
    // Where two walls meet (or a wall and the floor), a shadow carries
    // straight on from one to the other, and two smoothed borders meeting
    // there would leave a faint light seam. Cut exactly, each pixel belongs
    // to one surface or the other, never half to each. (A tenth of a pixel
    // of overlap makes sure rounding never leaves a pixel belonging to
    // neither.)
    vec4 inside = step(pastCatch, vec4(0.1));
    float onWall = uCatchShadows * min(min(inside.x, inside.y), min(inside.z, inside.w));

    vec3 stepX, stepY;
    pixelSteps(vWorld, stepX, stepY);

    // Nothing to draw here, or behind a ball: skip.
    if ((coverage <= 0.0 && onWall <= 0.0) || hiddenBehindBall(gl_FragCoord.z)) discard;

    float shadow = shadowAt(vWorld, stepX, stepY, -1);

    // Two layers: the grid line on top, the shadow on the wall beneath it.
    float lineLayer   = coverage * uLineOpacity;
    float shadowLayer = onWall * shadow * uShadowOpacity * (1.0 - lineLayer);
    float opacity     = lineLayer + shadowLayer;
    if (opacity <= 0.0) discard;

    // The graphics card blends this over what's behind, using 'opacity' —
    // in linear light, because of how renderer.js set up the picture.
    vec3 color = (shade(uColor, shadow) * lineLayer + uShadowColor * shadowLayer) / opacity;
    outColor = vec4(color, opacity);
  }
`;


// -----------------------------------------------------------------------------
// 3. BALLS
//
// One square per ball, all drawn in a single call ("instancing"):
// gl_InstanceID says which copy is being drawn. renderer.js sorts the balls
// from far to near (uDrawOrder), so the smooth outline of a near ball blends
// over a ball behind it.
// -----------------------------------------------------------------------------
export const BALL_VERTEX_SHADER = /* glsl */ `#version 300 es
  precision highp float;
  precision highp int;
  ${BALL_LIST}

  layout(location = 0) in vec2 aCorner;    // (-1,-1) … (1,1)

  uniform mat4 uViewProjection;            // camera: world → screen
  uniform vec3 uCameraPosition;
  uniform int  uDrawOrder[MAX_BALLS];      // ball numbers, farthest first

  out vec3 vWorld;          // this corner of the square, in the world
  flat out int vBall;       // which ball ("flat" = same for the whole square)

  void main() {
    int i = uDrawOrder[gl_InstanceID];
    vBall = i;
    vec3  center = uBalls[i].xyz;
    float radius = uBalls[i].w;

    vec3  toBall   = center - uCameraPosition;
    float distance = length(toBall);

    // Camera inside the ball: draw nothing (all corners on one spot).
    if (distance <= radius * 1.001) {
      vWorld = center;
      gl_Position = vec4(0.0);
      return;
    }

    // Two directions at right angles to the line of sight, so the square
    // faces the camera.
    vec3 forward = toBall / distance;
    vec3 helper  = abs(forward.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 right   = normalize(cross(forward, helper));
    vec3 up      = cross(right, forward);

    // Seen up close, a ball's outline is a bit wider than its radius
    // (you see "around" it less, but it covers more of the view). This is
    // its exact size at the ball's centre, plus 10 % room for the smoothed
    // edge.
    float halfSize = radius * distance / sqrt(distance * distance - radius * radius) * 1.1;

    vWorld = center + (right * aCorner.x + up * aCorner.y) * halfSize;
    gl_Position = uViewProjection * vec4(vWorld, 1.0);
  }
`;

export const BALL_FRAGMENT_SHADER = /* glsl */ `#version 300 es
  precision highp float;
  precision highp int;
  ${PIXEL_TOOLS}

  uniform mat4 uViewProjection;
  uniform vec3 uCameraPosition;

  in vec3 vWorld;
  flat in int vBall;
  out vec4 outColor;

  const float PI = 3.14159265359;

  // A smoothed "square wave": +1 on even squares, -1 on odd squares.
  //
  // 'blur' is how many squares the edge blend spans (about one pixel).
  // Instead of a hard jump we average the wave over that width. At an edge
  // that gives exactly the same blend as smoothEdge(); the advantage of
  // averaging is that near the poles, where the squares get smaller than a
  // pixel, they melt into an even colour instead of shimmering.
  //
  // Trick: the running total of a square wave is a zig-zag, and the
  // average over a window is (zig-zag at one end − at the other) / width.
  float zigzag(float x) { return 2.0 * abs(fract(x * 0.5) - 0.5); }
  float squareWave(float x, float blur) {
    blur = max(blur, 1e-4);
    return (zigzag(x - 0.5 * blur) - zigzag(x + 0.5 * blur)) / blur;
  }

  void main() {
    vec3  center = uBalls[vBall].xyz;
    float radius = uBalls[vBall].w;

    // ---- Where does the ray through this pixel meet the ball? ----
    vec3  rayDir   = normalize(vWorld - uCameraPosition);
    vec3  toCenter = center - uCameraPosition;
    float along    = dot(toCenter, rayDir);   // closest approach to the centre
    float missDist = sqrt(max(0.0, dot(toCenter, toCenter) - along * along));

    // The outline: inside where the ray passes closer than the radius.
    float coverage = smoothEdge(inPixels(radius - missDist));

    // The point where the ray enters the ball (Pythagoras again). For the
    // few pixels just outside the outline we use the nearest point on the
    // outline instead, so the smoothed edge still gets the right colour.
    float halfChord = sqrt(max(0.0, radius * radius - missDist * missDist));
    vec3  hit       = uCameraPosition + rayDir * (along - halfChord);
    vec3  normal    = normalize(hit - center);
    vec3  surface   = center + normal * radius;

    // Tell the depth test how far away this point really is (the flat
    // square itself sits at the ball's centre).
    vec4 clip = uViewProjection * vec4(surface, 1.0);
    float depth = 0.5 * (clip.z / clip.w) + 0.5;
    gl_FragDepth = depth;

    // ---- Checker pattern ----
    // Turn the point back into the ball's own, un-rotated coordinates, then
    // find its latitude / longitude (both 0..1).
    // How many checker squares this ball has: from pole to pole, and twice
    // as many around the equator.
    float SQUARES_DOWN   = uBallColor[vBall].a;
    float SQUARES_AROUND = 2.0 * SQUARES_DOWN;

    vec3 n = transpose(uBallRotation[vBall]) * normal;
    float around = atan(n.z, n.x) / (2.0 * PI) + 0.5;
    float down   = acos(clamp(n.y, -1.0, 1.0)) / PI;
    vec2 square  = vec2(around * SQUARES_AROUND, down * SQUARES_DOWN);

    vec2 blur = fwidth(square);
    // At the back of the ball 'around' jumps from 1 back to 0, which would
    // look like a huge change. Measuring a copy that jumps somewhere else
    // instead, and keeping the smaller answer, avoids a visible seam.
    blur.x = min(blur.x, fwidth(fract(around + 0.5) * SQUARES_AROUND));
    blur *= uEdgeWidth;

    // Multiply the two waves: same sign = coloured square, else white.
    float checker = 0.5 + 0.5 * squareWave(square.x, blur.x) * squareWave(square.y, blur.y);

    vec3 stepX, stepY;
    pixelSteps(surface, stepX, stepY);

    // Outside the ball, or hidden behind another ball: nothing to draw.
    if (coverage <= 0.0 || hiddenBehindBall(depth)) discard;

    // ---- Final colour, mixed in linear light ----
    float shadow = shadowAt(surface, stepX, stepY, vBall);
    vec3 color = mix(shade(vec3(1.0), shadow), shade(uBallColor[vBall].rgb, shadow), checker);

    outColor = vec4(color, coverage);
  }
`;


// The cheap first pass for the balls (see "Skipping hidden pixels" above):
// same square per ball, but it only works out the depth of the ball's
// surface, and only where the ball fully covers the pixel. (Its smoothed
// edge pixels must not hide what is behind them.)
export const BALL_DEPTH_FRAGMENT_SHADER = /* glsl */ `#version 300 es
  precision highp float;
  precision highp int;
  ${BALL_LIST}
  uniform mat4 uViewProjection;
  uniform vec3 uCameraPosition;
  uniform float uEdgeWidth;
  in vec3 vWorld;
  flat in int vBall;

  void main() {
    vec3  center   = uBalls[vBall].xyz;
    float radius   = uBalls[vBall].w;
    vec3  rayDir   = normalize(vWorld - uCameraPosition);
    vec3  toCenter = center - uCameraPosition;
    float along    = dot(toCenter, rayDir);
    float missDist = sqrt(max(0.0, dot(toCenter, toCenter) - along * along));

    // Fully covered = far enough inside the outline that the smoothed edge
    // (half the edge width) has been passed, with a little margin.
    float pixelsInside = (radius - missDist) / max(fwidth(missDist), 1e-6);
    if (pixelsInside < 0.5 * uEdgeWidth + 0.1) discard;

    float halfChord = sqrt(max(0.0, radius * radius - missDist * missDist));
    vec4 clip = uViewProjection * vec4(uCameraPosition + rayDir * (along - halfChord), 1.0);
    gl_FragDepth = 0.5 * (clip.z / clip.w) + 0.5;
  }
`;


// -----------------------------------------------------------------------------
// 3b. TRAILS
//
// A trail is the path a ball has just flown, drawn as a line that fades out
// towards its old end. The path is a chain of short straight pieces; each
// piece is drawn as a thin rectangle that always faces the camera. All
// pieces of all balls go to the graphics card in one list and are drawn
// with a single call.
// -----------------------------------------------------------------------------
export const TRAIL_VERTEX_SHADER = /* glsl */ `#version 300 es
  precision highp float;
  layout(location = 0) in vec2 aCorner;   // x: -1 = start of the piece, +1 = end; y: which side
  layout(location = 1) in vec3 aStart;    // the piece's two ends, in the world
  layout(location = 2) in vec3 aEnd;
  layout(location = 3) in vec3 aColor;
  layout(location = 4) in vec2 aFade;     // how visible the start and the end are (0 … 1)

  uniform mat4  uViewProjection;
  uniform vec2  uViewport;     // size of the picture in pixels
  uniform float uWidth;        // width of the line in pixels

  out vec3  vColor;
  out float vFade;
  out float vSide;             // distance from the line's centre, in pixels

  void main() {
    vec4 start = uViewProjection * vec4(aStart, 1.0);
    vec4 end   = uViewProjection * vec4(aEnd, 1.0);
    // A piece that reaches behind the camera is left out.
    if (start.w < 0.05 || end.w < 0.05) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

    // Where the two ends are on screen (in pixels), and the direction across
    // the line there.
    vec2 a = start.xy / start.w * uViewport * 0.5;
    vec2 b = end.xy / end.w * uViewport * 0.5;
    vec2 along = b - a;
    float len = length(along);
    along = len > 1e-4 ? along / len : vec2(1.0, 0.0);
    vec2 across = vec2(-along.y, along.x);

    // One extra pixel on each side leaves room for the smoothed edge.
    float t = aCorner.x * 0.5 + 0.5;
    vSide = aCorner.y * (0.5 * uWidth + 1.0);
    vFade = mix(aFade.x, aFade.y, t);
    vColor = aColor;

    vec4 p = mix(start, end, t);
    p.xy += across * vSide / (uViewport * 0.5) * p.w;
    gl_Position = p;
  }
`;

export const TRAIL_FRAGMENT_SHADER = /* glsl */ `#version 300 es
  precision highp float;
  uniform float uWidth;
  uniform float uEdgeWidth;
  in vec3  vColor;
  in float vFade;
  in float vSide;
  out vec4 outColor;

  vec3 toLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }

  void main() {
    // The same edge rule as everywhere else: blend across about one pixel.
    float coverage = clamp((0.5 * uWidth - abs(vSide)) / uEdgeWidth + 0.5, 0.0, 1.0);
    outColor = vec4(toLinear(vColor), coverage * vFade);
  }
`;


// -----------------------------------------------------------------------------
// 0. COPPER BARS (optional backdrop)
//
// The Amiga had a chip called the "Copper" that could change colours while
// the picture was being drawn, line by line. Demos used it to fill the
// background with colour gradients and with glowing horizontal bars that
// glide up and down: "copper bars". Here the same look is worked out per
// pixel. Two details make it look right:
//   - the colour only changes once per screen line of a 256-line Amiga screen;
//   - the Amiga had 16 levels each of red, green and blue (4096 colours),
//     so gradients show visible steps.
// -----------------------------------------------------------------------------
export const COPPER_FRAGMENT_SHADER = /* glsl */ `#version 300 es
  precision highp float;
  uniform float uTime;      // seconds
  uniform float uHeight;    // height of the picture in pixels
  out vec4 outColor;

  const float LINES = 256.0;    // screen lines of a European (PAL) Amiga
  const float LEVELS = 15.0;    // 16 levels per colour channel: 0 … 15

  vec3 toLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }

  // Lay one bar over the colour so far. A bar is brightest in the middle
  // and fades to black at its edges, which makes it look like a round tube.
  vec3 addBar(vec3 color, float y, float center, vec3 barColor) {
    float d = abs(y - center) / 0.055;          // 0 in the middle, 1 at the edge
    if (d >= 1.0) return color;
    float glow = 1.0 - d * d;
    return barColor * glow + vec3(0.6) * pow(glow, 6.0);   // with a white highlight
  }

  void main() {
    // Which Amiga screen line is this pixel on? (0 = bottom, 1 = top)
    float y = (floor(gl_FragCoord.y / uHeight * LINES) + 0.5) / LINES;

    // The sky: dark blue at the top, Workbench blue at the bottom.
    vec3 color = mix(vec3(0.4, 0.53, 0.73), vec3(0.0, 0.0, 0.27), y);

    // Three bars gliding up and down, each a little out of step.
    color = addBar(color, y, 0.5 + 0.40 * sin(uTime * 0.9),       vec3(0.9, 0.1, 0.1));
    color = addBar(color, y, 0.5 + 0.40 * sin(uTime * 0.9 + 0.7), vec3(0.1, 0.8, 0.2));
    color = addBar(color, y, 0.5 + 0.40 * sin(uTime * 0.9 + 1.4), vec3(0.2, 0.3, 1.0));

    // Round to the Amiga's 16 levels per channel.
    color = floor(min(color, 1.0) * LEVELS + 0.5) / LEVELS;
    outColor = vec4(toLinear(color), 1.0);
  }
`;


// -----------------------------------------------------------------------------
// 4. COPY TO SCREEN
//
// The scene is drawn into an off-screen picture that stores linear light.
// This last step copies it to the canvas, converting back to screen colours.
// A single triangle big enough to cover the whole screen does the job; its
// corners are made up from gl_VertexID, so no vertex data is needed.
// -----------------------------------------------------------------------------
export const PRESENT_VERTEX_SHADER = /* glsl */ `#version 300 es
  void main() {
    vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));  // (0,0) (2,0) (0,2)
    gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
  }
`;

export const PRESENT_FRAGMENT_SHADER = /* glsl */ `#version 300 es
  precision highp float;
  uniform highp sampler2D uScene;
  uniform float uColorLevels;   // 0 = all colours; 15 = the Amiga's 16 levels per channel
  out vec4 outColor;

  // Linear light → screen colour (sRGB). The inverse of toLinear().
  vec3 toScreen(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }

  void main() {
    // Reading the off-screen picture gives linear light back automatically.
    vec3 linear = texelFetch(uScene, ivec2(gl_FragCoord.xy), 0).rgb;
    vec3 color = toScreen(linear);
    // "Pixels" mode: round each of red, green and blue to the nearest of
    // the few levels the Amiga had.
    if (uColorLevels > 0.0) color = floor(color * uColorLevels + 0.5) / uColorLevels;
    outColor = vec4(color, 1.0);
  }
`;
