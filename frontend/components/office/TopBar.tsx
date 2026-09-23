import { Chip, ExitLink, Ticker } from '@/components/ui';
import { floorCountWord } from '@/lib/office/rooms';
import { ZOOM_LEVELS, type Zoom } from '@/lib/office/constants';
import type { Room } from '@/lib/office/types';

// Derived from the live room list, so adding or removing a floor keeps it honest.
const tickerText = (floors: number): string =>
  floors === 1
    ? 'One floor — the portal loops you back to it'
    : `${floorCountWord(floors)} floors, one lift shaft — the portal on every floor drops you to the next`;

type TopBarProps = {
  rooms: Room[];
  viewRoom: number;
  zoom: Zoom;
  auto: boolean;
  editing: boolean;
  onRoom: (room: number) => void;
  onZoom: (zoom: Zoom) => void;
  onToggleAuto: () => void;
  onManageFloors: () => void;
  onManageTeams: () => void;
  onManageRoles: () => void;
  onManageSkills: () => void;
  onManageMcp: () => void;
  onManageRules: () => void;
  onManagePersonalities: () => void;
  onOpenFleet: () => void;
  onOpenInbox: () => void;
  onOpenSettings: () => void;
  /** Unread messages across all threads, for the inbox badge. */
  unread: number;
  editorToolbar?: React.ReactNode;
};

export default function TopBar({
  rooms,
  viewRoom,
  zoom,
  auto,
  editing,
  onRoom,
  onZoom,
  onToggleAuto,
  onManageFloors,
  onManageTeams,
  onManageRoles,
  onManageSkills,
  onManageMcp,
  onManageRules,
  onManagePersonalities,
  onOpenFleet,
  onOpenInbox,
  onOpenSettings,
  unread,
  editorToolbar,
}: TopBarProps) {
  const TICKER_TEXT = tickerText(rooms.length);
  return (
    <header className="flex items-center gap-3.5 border-b border-[var(--border-primary)] bg-[var(--surface-secondary)] px-3.5 py-2 font-mono text-xs">
      <ExitLink href="/" label="Exit" />

      <span className="font-semibold tracking-[0.08em] text-[var(--accent-primary)]">
        SANCTORUM
      </span>

      <Ticker text={TICKER_TEXT} />

      {editorToolbar}

      {/* Floors are a select rather than a chip per room: six chips plus the
          zoom and auto controls would crowd the bar off narrow screens. */}
      <label className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--content-tertiary)]">
          Floor
        </span>
        <select
          value={viewRoom}
          onChange={(e) => onRoom(Number(e.target.value))}
          aria-label="Floor"
          className="cursor-pointer rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-2 py-[3px] font-mono text-[11px] text-[var(--content-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]"
        >
          {rooms.map((room, index) => (
            <option key={room.id} value={index}>
              {index + 1}. {room.name}
            </option>
          ))}
        </select>
        {/* Floor CRUD is an editing action, so the entry only shows in edit mode. */}
        {editing && (
          <Chip onClick={onManageFloors} aria-label="Manage floors">
            floors…
          </Chip>
        )}
        {/* Teams are an org action, available any time. */}
        <Chip onClick={onManageTeams} aria-label="Manage teams">
          teams…
        </Chip>
        <Chip onClick={onManageRoles} aria-label="Manage roles">
          roles…
        </Chip>
        <Chip onClick={onManageSkills} aria-label="Manage skills">
          skills…
        </Chip>
        <Chip onClick={onManageMcp} aria-label="Manage MCP servers">
          mcps…
        </Chip>
        <Chip onClick={onManageRules} aria-label="Manage standing rules">
          rules…
        </Chip>
        <Chip onClick={onManagePersonalities} aria-label="Manage personalities">
          voices…
        </Chip>
        <Chip onClick={onOpenFleet} aria-label="Open fleet view">
          fleet…
        </Chip>
        {/* App settings (default model). */}
        <Chip onClick={onOpenSettings} aria-label="Open settings">
          settings…
        </Chip>
        {/* Inbox with an unread badge. */}
        <Chip onClick={onOpenInbox} aria-label="Open inbox">
          <span className="flex items-center gap-1">
            inbox
            {unread > 0 && (
              <span className="rounded-full bg-[var(--accent-primary)] px-1.5 py-px text-[9px] leading-none text-[var(--surface-primary,#000)]">
                {unread}
              </span>
            )}
          </span>
        </Chip>
      </label>

      <div className="flex gap-1">
        {ZOOM_LEVELS.map((level) => (
          <Chip key={level} active={zoom === level} onClick={() => onZoom(level)}>
            {level}×
          </Chip>
        ))}
        {/* Between the presets the wheel is driving; show where it landed. */}
        <span
          aria-live="polite"
          className={`w-9 text-center text-[11px] tabular-nums ${
            ZOOM_LEVELS.includes(zoom as (typeof ZOOM_LEVELS)[number])
              ? 'text-[var(--content-tertiary)]'
              : 'text-[var(--accent-primary)]'
          }`}
        >
          {zoom.toFixed(1)}×
        </span>
        <Chip active={auto} onClick={onToggleAuto}>
          auto: {auto ? 'on' : 'off'}
        </Chip>
      </div>
    </header>
  );
}
