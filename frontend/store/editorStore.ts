import { create } from 'zustand';
import {
  PROP_KINDS,
  TILE_KINDS,
  type EditorTool,
  type PropKindKey,
  type Rotation,
  type TileKind,
} from '@/lib/office/editor/tools';

// Defaults come from the generated lists, so they never point at art that was
// renamed or removed. `floor_white` is the seeded starter tile if present.
const DEFAULT_TILE: TileKind =
  TILE_KINDS.find((t) => t.key === 'floor_white')?.key ?? TILE_KINDS[0]?.key ?? '';
const DEFAULT_PROP: PropKindKey = PROP_KINDS[0]?.key ?? '';

type EditorState = {
  /** Edit mode overlays the grid and enables painting; off = normal play. */
  active: boolean;
  tool: EditorTool;
  tileKind: TileKind;
  propKind: PropKindKey;
  rotation: Rotation;
  /** Cell under the cursor, for the hover preview. Null when off-canvas. */
  hover: { x: number; y: number } | null;
  /** Tiles the hovered blocking-prop placement would strand. Drives the red
   *  warning overlay; empty when the placement is safe. */
  stranded: { x: number; y: number }[];

  setActive: (active: boolean) => void;
  setTool: (tool: EditorTool) => void;
  setTileKind: (kind: TileKind) => void;
  setPropKind: (kind: PropKindKey) => void;
  setRotation: (rotation: Rotation) => void;
  setHover: (cell: { x: number; y: number } | null) => void;
  setStranded: (cells: { x: number; y: number }[]) => void;
};

export const useEditorStore = create<EditorState>((set) => ({
  active: false,
  tool: 'tile',
  tileKind: DEFAULT_TILE,
  propKind: DEFAULT_PROP,
  rotation: 0,
  hover: null,
  stranded: [],

  setActive: (active) =>
    set(active ? { active } : { active, hover: null, stranded: [] }),
  setTool: (tool) => set({ tool, stranded: [] }),
  setTileKind: (tileKind) => set({ tileKind }),
  setPropKind: (propKind) => set({ propKind }),
  setRotation: (rotation) => set({ rotation }),
  setHover: (hover) => set({ hover }),
  setStranded: (stranded) => set({ stranded }),
}));
