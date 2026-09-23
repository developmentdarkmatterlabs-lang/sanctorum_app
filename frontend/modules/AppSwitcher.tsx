import OfficeModule from './OfficeModule';

// Switches between feature modules. Register modules here as they are added.
const MODULES = {
  office: OfficeModule,
} as const;

export type ModuleKey = keyof typeof MODULES;

export default function AppSwitcher({ module = 'office' }: { module?: ModuleKey }) {
  const Active = MODULES[module];
  return <Active />;
}
