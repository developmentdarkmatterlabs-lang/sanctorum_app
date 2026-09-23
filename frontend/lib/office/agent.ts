import {
  ANIM_FRAMES,
  ANIM_FRAME_TIME,
  DEFAULT_ROW_ORDER,
  DIR,
  GH,
  GW,
  PORTAL_COOLDOWN,
  SPEED_BASE,
  SPEED_JITTER,
  THINK_INITIAL_MIN,
  THINK_INITIAL_SPREAD,
  THINK_MIN,
  THINK_SPREAD,
  toRowLookup,
} from './constants';
import { tileToWorld, walkable } from './grid';
import { bfs } from './pathfinding';
import { PAD, otherRoom } from './rooms';
import type {
  AgentStatus,
  Direction,
  Point,
  Room,
  RosterEntry,
  SpriteKey,
} from './types';

type ArrivalAction = 'work' | null;

type PendingMove = { room: number; gx: number; gy: number; then: ArrivalAction };

/**
 * Resolves an agent's desk tile. Prefers the stable seatId (so a moved seat
 * follows the agent); falls back to the seat index, then to the pad if the
 * floor has no such seat (an agent whose desk was deleted stands on the lift).
 */
function deskTile(
  room: Room | undefined,
  seatId: string | null,
  seatIndex: number
): [number, number] {
  const seats = room?.seats ?? [];
  const byId = seatId ? seats.find((s) => s.id === seatId) : undefined;
  const seat = byId ?? seats[seatIndex];
  return seat ? [seat.x, seat.y] : [PAD[0], PAD[1]];
}

export type AgentHost = {
  onStatusChanged: () => void;
  onLog: (name: string, message: string) => void;
  onRoomChanged: () => void;
  isAutoEnabled: () => boolean;
  /** Live floor list, owned by the simulation. */
  rooms: () => Room[];
};

export class Agent {
  readonly key: SpriteKey;
  readonly name: string;
  readonly homeRoom: number;
  readonly seat: number;
  /** Stable desk handle. Position still derives from room/seat for now; this
   *  is carried through for the editor phases. */
  readonly seatId: string | null;

  room: number;
  /** Current tile. */
  tx: number;
  ty: number;
  /** Current world position (centre-bottom of the sprite). */
  px: number;
  py: number;

  dir: Direction = DIR.up;
  frame = 0;
  status: AgentStatus = 'working';
  /** True while a REAL run is in flight for this agent (its thread has an
   *  activeRunId). Drives the working animation and suppresses the idle
   *  auto-scheduler, so a busy agent stays at its desk. */
  running = false;
  /** True while a real run is PAUSED waiting on a human decision — the thread has
   *  a pendingRunId. Distinct from `running`: the agent is on a task but cannot
   *  proceed, which is exactly what the 'waiting' status is for. */
  blocked = false;
  /** Direction -> spritesheet row, per this agent's own sheet. */
  readonly rowLookup: Direction[];

  private animT = 0;
  private path: Point[] = [];
  private then: ArrivalAction = null;
  private readonly speed: number;
  private bubbleT = 0;
  private holdAuto = 0;
  private thinkT: number;
  private pending: PendingMove | null = null;
  private travelling = false;
  private portalCD = 0;

  private readonly host: AgentHost;

  constructor(cfg: RosterEntry, host: AgentHost) {
    this.key = cfg.key;
    this.name = cfg.name;
    this.homeRoom = cfg.room;
    this.seat = cfg.seat;
    this.seatId = cfg.seatId ?? null;
    this.room = cfg.room;
    this.host = host;

    const [sx, sy] = deskTile(host.rooms()[this.homeRoom], this.seatId, this.seat);
    this.tx = sx;
    this.ty = sy;
    const world = tileToWorld(sx, sy);
    this.px = world.px;
    this.py = world.py;

    this.rowLookup = toRowLookup(cfg.rowOrder ?? DEFAULT_ROW_ORDER);
    this.speed = SPEED_BASE + Math.random() * SPEED_JITTER;
    this.thinkT = THINK_INITIAL_MIN + Math.random() * THINK_INITIAL_SPREAD;
  }

  /** Walkability grid of the room this agent is currently in. */
  private grid(room = this.room): number[][] {
    return this.host.rooms()[room]?.M ?? [];
  }

  get bubblePhase(): number {
    return this.bubbleT;
  }

  get isWalking(): boolean {
    return this.path.length > 0;
  }

  /** Suppress the auto-scheduler for a while after a manual command. */
  holdFor(seconds: number): void {
    this.holdAuto = seconds;
  }

  private setStatus(status: AgentStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.host.onStatusChanged();
  }

  private setPathTo(gx: number, gy: number, then: ArrivalAction = null): boolean {
    const path = bfs(this.grid(), this.tx, this.ty, gx, gy);
    if (!path) return false;
    this.path = path;
    this.then = then;
    this.setStatus('walking');
    return true;
  }

  /** Route to a tile in any room, walking to the portal first when needed. */
  commandTo(room: number, gx: number, gy: number, then: ArrivalAction = null): void {
    if (room === this.room) {
      this.pending = null;
      this.setPathTo(gx, gy, then);
      return;
    }
    this.pending = { room, gx, gy, then };
    this.travelling = true;
    this.setPathTo(PAD[0], PAD[1]);
  }

  goDesk(): void {
    const [sx, sy] = deskTile(this.host.rooms()[this.homeRoom], this.seatId, this.seat);
    this.commandTo(this.homeRoom, sx, sy, 'work');
  }

  travelRooms(): void {
    this.travelling = true;
    this.setPathTo(PAD[0], PAD[1]);
  }

  wander(): void {
    const grid = this.grid();
    for (let attempt = 0; attempt < 50; attempt++) {
      const x = 1 + Math.floor(Math.random() * (GW - 2));
      const y = 1 + Math.floor(Math.random() * (GH - 2));
      const onPad = x === PAD[0] && y === PAD[1];
      const inPlace = x === this.tx && y === this.ty;
      if (walkable(grid, x, y) && !onPad && !inPlace) {
        this.setPathTo(x, y);
        return;
      }
    }
  }

  private teleport(): void {
    const to = otherRoom(this.host.rooms(), this.room);
    const [padX, padY] = PAD;

    this.room = to;
    this.tx = padX;
    this.ty = padY;
    const world = tileToWorld(padX, padY);
    this.px = world.px;
    this.py = world.py;

    this.portalCD = PORTAL_COOLDOWN;
    this.travelling = false;
    this.host.onLog(this.name, `took the portal to ${this.host.rooms()[to]?.name ?? 'the next floor'}`);

    if (this.pending && this.pending.room === this.room) {
      const { gx, gy, then } = this.pending;
      this.pending = null;
      this.setPathTo(gx, gy, then);
    } else {
      this.pending = null;
      this.wander();
    }

    this.host.onRoomChanged();
  }

  update(dt: number): void {
    if (this.holdAuto > 0) this.holdAuto -= dt;
    if (this.portalCD > 0) this.portalCD -= dt;

    if (this.path.length) {
      this.advance(dt);
    } else {
      this.frame = 0;
      this.think(dt);
    }

    this.bubbleT += dt;
  }

  private advance(dt: number): void {
    const next = this.path[0];
    const target = tileToWorld(next.x, next.y);
    const dx = target.px - this.px;
    const dy = target.py - this.py;
    const dist = Math.hypot(dx, dy);
    const step = this.speed * dt;

    if (Math.abs(dx) > Math.abs(dy)) {
      this.dir = dx > 0 ? DIR.right : DIR.left;
    } else if (Math.abs(dy) > 0.5) {
      this.dir = dy > 0 ? DIR.down : DIR.up;
    }

    if (dist <= step) {
      this.px = target.px;
      this.py = target.py;
      this.tx = next.x;
      this.ty = next.y;
      this.path.shift();

      if (!this.path.length) {
        this.arrive();
        return;
      }
    } else {
      this.px += (dx / dist) * step;
      this.py += (dy / dist) * step;
    }

    this.animT += dt;
    if (this.animT > ANIM_FRAME_TIME) {
      this.animT = 0;
      this.frame = (this.frame + 1) % ANIM_FRAMES;
    }
  }

  private arrive(): void {
    const onPad = this.tx === PAD[0] && this.ty === PAD[1];

    if ((this.travelling || this.pending) && onPad && this.portalCD <= 0) {
      this.teleport();
      return;
    }

    const action = this.then;
    this.then = null;

    if (action === 'work') {
      this.dir = DIR.up;
      this.setStatus('working');
    } else {
      this.setStatus('idle');
    }
  }

  /**
   * Applies REAL run state to the status. Called every frame from the sim.
   *
   * This outranks the auto-scheduler below: while a run is live the status is a
   * fact, not a dice roll. `waiting` means the run is genuinely parked on a
   * decision (or on a child agent's report), not that a random tick decided the
   * agent looked blocked.
   *
   * Walking is left alone — an agent crossing the floor to its desk is walking,
   * and it will settle into `working` on arrival.
   */
  applyRunState(running: boolean, blocked: boolean): void {
    this.running = running;
    this.blocked = blocked;
    if (this.status === 'walking') return;

    if (blocked) this.setStatus('waiting');
    else if (running) this.setStatus('working');
    else if (this.status === 'working' || this.status === 'waiting') this.setStatus('idle');
  }

  /** Idle behaviour: occasionally pick something to do. An agent on a REAL run is
   *  driven by `applyRunState`, not by this — it stays at its desk and its status
   *  reflects the run, so skip the random wander/break/block entirely. */
  private think(dt: number): void {
    if (!this.host.isAutoEnabled() || this.holdAuto > 0 || this.running || this.blocked) return;

    this.thinkT -= dt;
    if (this.thinkT > 0) return;

    this.thinkT = THINK_MIN + Math.random() * THINK_SPREAD;
    const roll = Math.random();

    if (this.status === 'working') {
      if (roll < 0.18) {
        this.setStatus('waiting');
        this.host.onLog(this.name, 'needs your input');
      } else if (roll < 0.3) {
        this.travelRooms();
        this.host.onLog(this.name, 'is taking a break');
      } else if (roll < 0.45) {
        this.wander();
        this.host.onLog(this.name, 'stretches their legs');
      } else {
        this.host.onLog(this.name, roll < 0.72 ? 'is writing code' : 'is reading files');
      }
      return;
    }

    if (this.status === 'waiting') {
      if (roll < 0.6) {
        this.setStatus('working');
        this.host.onLog(this.name, 'got unblocked, back to work');
      }
      return;
    }

    if (this.room !== this.homeRoom ? roll < 0.45 : roll < 0.55) {
      this.goDesk();
      this.host.onLog(this.name, 'heads back to their desk');
    } else {
      this.wander();
    }
  }
}
