import type { Agent } from './agent';
import { AGENT_DRAW, GH, GW, PORTAL_DRAW, SPR, TILE } from './constants';
import { PAD } from './rooms';
import { ready, type OfficeImages } from './sprites';
import { drawTile } from './editor/placement';
import { propDef, tilePath, type Rotation } from './editor/tools';
import type { OfficePalette, Prop, Room } from './types';

export type RenderState = {
  images: OfficeImages;
  agents: Agent[];
  viewRoom: number;
  /** The floor being viewed, resolved by the caller. */
  room: Room | undefined;
  zoom: number;
  selectedKey: string | null;
  palette: OfficePalette;
  /** Tiles that the pending edit would strand, drawn red. Editor only. */
  stranded?: { x: number; y: number }[];
  /** Draw seat markers (edit mode), so desks are visible for editing. */
  showSeats?: boolean;
  /** Tint every blocked grid cell red (block-brush edit mode), so the invisible
   *  collision map is visible while painting. Off outside the editor. */
  showBlocks?: boolean;
};

/** Something drawable, sorted by its baseline so nearer things paint last. */
type Entity = { sy: number; draw: () => void };

// Rounded: fractional zoom yields sizes like 704.0000000000001, and a canvas
// with a non-integer backing store renders blurry.
export const canvasSize = (zoom: number) => ({
  width: Math.round(GW * TILE * zoom),
  height: Math.round(GH * TILE * zoom),
});

export function render(ctx: CanvasRenderingContext2D, state: RenderState): void {
  const { images, agents, viewRoom, room, zoom, palette } = state;
  const px = (n: number) => n * zoom;
  const { width, height } = canvasSize(zoom);

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);

  if (!room) {
    ctx.fillStyle = palette.emptyBg;
    ctx.fillRect(0, 0, width, height);
    return;
  }

  const bg = images.backgrounds[room.bg];
  if (ready(bg)) {
    ctx.drawImage(bg, 0, 0, width, height);
  } else {
    ctx.fillStyle = palette.emptyBg;
    ctx.fillRect(0, 0, width, height);
  }

  // Decorative tiles: over the background, under everything that moves.
  for (const tile of room.tiles) {
    const path = tilePath(tile.kind);
    const img = path ? images.backgrounds[path] : undefined;
    if (ready(img)) {
      drawTile(ctx, img, tile.x, tile.y, tile.rotation as Rotation, zoom);
    }
  }

  // Flat portal pad, painted under everything that walks over it.
  const padSmall = images.assets.portalSmall;
  if (ready(padSmall)) {
    ctx.drawImage(
      padSmall,
      px(PAD[0] * TILE + PORTAL_DRAW.small.dx),
      px(PAD[1] * TILE + PORTAL_DRAW.small.dy),
      px(PORTAL_DRAW.small.w),
      px(PORTAL_DRAW.small.h)
    );
  }

  const entities: Entity[] = [];
  room.props.forEach((prop) => entities.push(propEntity(ctx, state, prop)));
  entities.push(portalEntity(ctx, state));
  agents
    .filter((a) => a.room === viewRoom)
    .forEach((agent) =>
      entities.push({ sy: agent.py, draw: () => drawAgent(ctx, state, agent) })
    );

  entities.sort((a, b) => a.sy - b.sy).forEach((entity) => entity.draw());

  // Seat markers (edit mode): a ring on each desk tile — amber if free, grey if
  // occupied — so seats can be seen and edited.
  if (state.showSeats) {
    const cell = TILE * zoom;
    for (const seat of room.seats) {
      const cx = seat.x * cell + cell / 2;
      const cy = seat.y * cell + cell / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.3, 0, Math.PI * 2);
      ctx.strokeStyle = seat.occupied ? 'rgba(160,160,160,0.9)' : '#f0a832';
      ctx.lineWidth = Math.max(2, zoom * 1.5);
      ctx.stroke();
      ctx.fillStyle = seat.occupied
        ? 'rgba(120,120,120,0.35)'
        : 'rgba(240,168,50,0.25)';
      ctx.fill();

      // Label: the desk's name, or "seat <index>" as a fallback, above the ring.
      const label = seat.name?.trim() || `seat ${seat.seat}`;
      ctx.font = `${Math.max(8, Math.round(9 * zoom))}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const ty = cy - cell * 0.32;
      ctx.lineWidth = Math.max(2, zoom * 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(label, cx, ty);
      ctx.fillStyle = seat.occupied ? 'rgba(200,200,200,0.95)' : '#f0c060';
      ctx.fillText(label, cx, ty);
    }
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  // Collision map (block-brush edit mode): tint every blocked grid cell so the
  // otherwise-invisible walls are visible while painting. Original walls and
  // painted cells look the same — it is one grid.
  if (state.showBlocks) {
    const cell = TILE * zoom;
    ctx.fillStyle = 'rgba(224,85,85,0.28)';
    const grid = room.M;
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[y].length; x++) {
        if (grid[y][x] === 1) ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  }

  // Stranded-region warning: cells the pending edit would cut off from the
  // portal, painted translucent red over everything.
  if (state.stranded && state.stranded.length) {
    const cell = TILE * zoom;
    ctx.fillStyle = 'rgba(224,85,85,0.4)';
    for (const s of state.stranded) {
      ctx.fillRect(s.x * cell, s.y * cell, cell, cell);
    }
  }
}

function propEntity(
  ctx: CanvasRenderingContext2D,
  state: RenderState,
  prop: Prop
): Entity {
  const { images, zoom } = state;
  const px = (n: number) => n * zoom;
  const def = propDef(prop.kind);
  const box = def?.foot ?? { dx: 0, dy: 0, w: TILE, h: TILE };
  const worldX = prop.x * TILE;
  const worldY = prop.y * TILE;

  return {
    // Sort by the base of the footprint so taller props occlude correctly.
    sy: (prop.y + 1) * TILE,
    draw: () => {
      const img = def ? images.backgrounds[def.path] : undefined;
      if (!ready(img)) return;
      ctx.drawImage(img, px(worldX + box.dx), px(worldY + box.dy), px(box.w), px(box.h));
    },
  };
}

function portalEntity(ctx: CanvasRenderingContext2D, state: RenderState): Entity {
  const { images, zoom } = state;
  const px = (n: number) => n * zoom;
  const box = PORTAL_DRAW.big;

  return {
    sy: (PAD[1] + 1) * TILE + box.sortOffset,
    draw: () => {
      const img = images.assets.portalBig;
      if (!ready(img)) return;
      ctx.drawImage(
        img,
        px(PAD[0] * TILE + box.dx),
        px(PAD[1] * TILE + box.dy),
        px(box.w),
        px(box.h)
      );
    },
  };
}

function drawAgent(
  ctx: CanvasRenderingContext2D,
  state: RenderState,
  agent: Agent
): void {
  const { images, zoom, selectedKey, palette } = state;
  const px = (n: number) => n * zoom;
  const sprite = images.sprites[agent.key];
  if (!ready(sprite)) return;

  ctx.fillStyle = palette.shadow;
  ctx.beginPath();
  ctx.ellipse(
    px(agent.px),
    px(agent.py - AGENT_DRAW.shadowYOffset),
    px(AGENT_DRAW.shadowRx),
    px(AGENT_DRAW.shadowRy),
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();

  // `dir` is a logical facing; each sheet stores its directions in its own row
  // order, so it has to be translated before slicing.
  ctx.drawImage(
    sprite,
    agent.frame * SPR,
    agent.rowLookup[agent.dir] * SPR,
    SPR,
    SPR,
    px(agent.px - SPR / 2),
    px(agent.py - SPR + AGENT_DRAW.spriteYOffset),
    px(SPR),
    px(SPR)
  );

  if (agent.key === selectedKey) {
    ctx.strokeStyle = palette.selection;
    ctx.lineWidth = zoom;
    ctx.strokeRect(
      px(agent.px + AGENT_DRAW.selectionX),
      px(agent.py + AGENT_DRAW.selectionY),
      px(AGENT_DRAW.selectionW),
      px(AGENT_DRAW.selectionH)
    );
  }

  // "Running a task" (an open thread/run) takes precedence over idle chatter —
  // a steady marker so you can spot who is on a task at a glance.
  if (agent.running) {
    drawBubble(ctx, state, agent, '▸', palette.selection, palette.bubbleBg);
  } else if (agent.status === 'working' && !agent.isWalking) {
    const dots = 1 + (Math.floor(agent.bubblePhase * 2) % 3);
    drawBubble(ctx, state, agent, '·'.repeat(dots), palette.bubbleFg, palette.bubbleBg);
  } else if (agent.status === 'waiting') {
    drawBubble(ctx, state, agent, '!', palette.bubbleWaitingFg, palette.bubbleWaitingBg);
  }
}

function drawBubble(
  ctx: CanvasRenderingContext2D,
  state: RenderState,
  agent: Agent,
  text: string,
  fg: string,
  bg: string
): void {
  const px = (n: number) => n * state.zoom;
  const x = px(agent.px + AGENT_DRAW.bubbleX);
  const y = px(agent.py + AGENT_DRAW.bubbleY);
  const w = px(AGENT_DRAW.bubbleW);
  const h = px(AGENT_DRAW.bubbleH);

  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, px(AGENT_DRAW.bubbleRadius));
  ctx.fill();

  // Tail
  ctx.beginPath();
  ctx.moveTo(x + px(3), y + h);
  ctx.lineTo(x + px(8), y + h);
  ctx.lineTo(x + px(4), y + h + px(4));
  ctx.fill();

  ctx.fillStyle = fg;
  ctx.font = `${px(AGENT_DRAW.bubbleFont)}px ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.trim(), x + w / 2, y + h / 2 + px(0.5));
}
