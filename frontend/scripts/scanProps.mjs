// Auto-discovers placeable props from public/assets/floor/objects/ and writes a
// generated PROP_KINDS array, grouped for the palette. Runs before `dev` and
// `build`.
//
// Conventions:
//   - One level deep: objects/<category>/<image>.png. Each folder is a palette
//     GROUP, and EVERY image in it is its own placeable prop (a variation).
//   - Loose top-level PNGs fall into a temporary "Objects" group, so nothing
//     breaks while art is being moved into category folders.
//   - Every prop blocks movement and gets one default, bottom-anchored draw box,
//     except the hand-tuned ones matched by filename in FOOT_OVERRIDES.
//   - SKIP names are art the renderer handles elsewhere (the portal), not props.

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OBJECTS_DIR = path.join(ROOT, 'public/assets/floor/objects');
const OUT_FILE = path.join(ROOT, 'lib/office/editor/props.generated.ts');
const URL_PREFIX = '/assets/floor/objects';

// The group loose top-level files land in until they are moved into a folder.
const LOOSE_GROUP = 'Objects';

// Not props — the portal art is drawn by the renderer directly. Matched by the
// file's base name (without extension).
const SKIP = new Set(['portal_big', 'portal_small']);

// Canonical keys for art whose filename differs from the `kind` stored in the
// DB. Matched by FILENAME (base, no extension), so renaming/moving art without
// re-seeding won't strand placed props. Empty now — nothing needs remapping.
const FILE_KEY = {};

// TILE = 32. The default box centres the art in the tile and overhangs a little
// above, bottom-anchored so objects sit on their cell. Keyed by filename base.
const DEFAULT_FOOT = { dx: -4, dy: -12, w: 40, h: 44 };
const FOOT_OVERRIDES = {
  desk: { dx: 0, dy: 0, w: 32, h: 32 },
  computer: { dx: 0, dy: 0, w: 32, h: 32 },
  // Art is 64x128 (1:2); keep it tall and bottom-anchored so it stands up.
  big_cactus_1: { dx: -4, dy: -48, w: 40, h: 80 },
  big_cactus_2: { dx: -4, dy: -48, w: 40, h: 80 },
  big_cactus_3: { dx: -4, dy: -48, w: 40, h: 80 },
  big_cactus_4: { dx: -4, dy: -48, w: 40, h: 80 },
};

const isPng = (name) => name.toLowerCase().endsWith('.png');
const base = (file) => file.replace(/\.png$/i, '');

/** "big_cactus" -> "Big cactus"; a trailing "_N" is kept for full labels. */
function titleCase(name) {
  const words = name.replace(/[_!-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return name;
  return words[0].charAt(0).toUpperCase() + words[0].slice(1) + (words.length > 1 ? ' ' + words.slice(1).join(' ') : '');
}

/** The variation number from a "..._N" filename, or null if it has none. */
function variantOf(fileBase) {
  const m = fileBase.match(/_(\d+)$/);
  return m ? Number(m[1]) : null;
}

/** Builds one prop record from a file's base name, its URL, and its group.
 *  `inFolder` picks the label style: inside a category folder a numbered file
 *  shows just its number (the header carries the name); a loose file shows its
 *  full name, so the transition "Objects" group stays readable. */
function propFrom(fileBase, url, group, inFolder) {
  const mapped = FILE_KEY[fileBase];
  const variant = variantOf(fileBase);
  const label =
    mapped?.label ?? (inFolder && variant !== null ? String(variant) : titleCase(fileBase));
  return {
    key: mapped?.key ?? fileBase,
    label,
    group,
    variant,
    path: url,
    foot: FOOT_OVERRIDES[fileBase] ?? DEFAULT_FOOT,
  };
}

async function scan() {
  const entries = await fs.readdir(OBJECTS_DIR, { withFileTypes: true });
  const props = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const folder = entry.name;
      const group = titleCase(folder);
      const files = (await fs.readdir(path.join(OBJECTS_DIR, folder)))
        .filter(isPng)
        .filter((f) => !SKIP.has(base(f)))
        .sort();
      for (const file of files) {
        props.push(propFrom(base(file), `${URL_PREFIX}/${folder}/${file}`, group, true));
      }
    } else if (entry.isFile() && isPng(entry.name)) {
      const fileBase = base(entry.name);
      if (SKIP.has(fileBase)) continue;
      props.push(propFrom(fileBase, `${URL_PREFIX}/${entry.name}`, LOOSE_GROUP, false));
    }
  }

  return props;
}

/** Groups in display order: the loose "Objects" group last, folders A→Z. */
function groupOrder(props) {
  const names = [...new Set(props.map((p) => p.group))];
  return names.sort((a, b) => {
    if (a === LOOSE_GROUP) return 1;
    if (b === LOOSE_GROUP) return -1;
    return a.localeCompare(b);
  });
}

function serialize(props) {
  const order = groupOrder(props);
  const body = props
    .map(
      (p) =>
        `  {\n    key: ${JSON.stringify(p.key)},\n    label: ${JSON.stringify(
          p.label
        )},\n    group: ${JSON.stringify(p.group)},\n    variant: ${
          p.variant === null ? 'null' : p.variant
        },\n    path: ${JSON.stringify(p.path)},\n    foot: { dx: ${p.foot.dx}, dy: ${
          p.foot.dy
        }, w: ${p.foot.w}, h: ${p.foot.h} },\n  },`
    )
    .join('\n');

  return `// GENERATED by scripts/scanProps.mjs — do not edit by hand.
// Every prop here is placeable in the editor and blocks movement. To add art,
// drop PNGs into a folder under public/assets/floor/objects/ (each folder is a
// palette group; each image is a variation) and re-run the scan (it runs on
// \`npm run dev\` and \`npm run build\`).

/** A placeable, movement-blocking prop. \`foot\` is the draw box in world px
 *  (props overhang their cell). \`group\` is its palette section; \`variant\` is
 *  the variation number (1..N) or null for a single-image prop. */
export type PropKind = {
  key: string;
  label: string;
  group: string;
  variant: number | null;
  path: string;
  foot: { dx: number; dy: number; w: number; h: number };
};

export const PROP_KINDS: readonly PropKind[] = [
${body}
];

/** Palette group names, in display order. */
export const PROP_GROUPS: readonly string[] = ${JSON.stringify(order)};
`;
}

async function main() {
  const props = await scan();
  await fs.writeFile(OUT_FILE, serialize(props), 'utf8');
  console.log(`scanProps: wrote ${props.length} props in ${new Set(props.map((p) => p.group)).size} groups`);
}

main().catch((err) => {
  console.error('scanProps failed:', err);
  process.exit(1);
});
