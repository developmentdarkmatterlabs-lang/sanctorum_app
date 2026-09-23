/**
 * electron-builder afterPack hook.
 *
 * Runs once the app is packed, before any installer is made. On Windows it sets
 * the app icon on Sanctorum.exe with rcedit.
 *
 * This is now a BELT-AND-BRACES step, not the only one. electron-builder runs
 * rcedit itself (we leave `signAndEditExecutable` unset so it does), which
 * writes both the icon and the version resource — FileDescription, ProductName,
 * CompanyName. This hook re-applies the icon afterwards, which is harmless when
 * the builder already got it right and saves the build when it did not.
 *
 * A failure here is a WARNING, never fatal: shipping with Electron's default
 * icon is a cosmetic problem, and failing the whole build over it would be the
 * wrong trade.
 *
 * context.appOutDir            where the packed app landed
 * context.electronPlatformName "win32" | "darwin" | "linux"
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const exePath = path.join(context.appOutDir, 'Sanctorum.exe');
  const iconPath = path.join(__dirname, 'electron', 'assets', 'icon.ico');
  const rcedit = path.join(__dirname, 'node_modules', 'rcedit', 'bin', 'rcedit.exe');

  // Say WHICH piece is missing — "failed to embed icon" with no reason is the
  // kind of warning that costs an hour to diagnose later.
  for (const [label, target] of [
    ['executable', exePath],
    ['icon', iconPath],
    ['rcedit', rcedit],
  ]) {
    if (!fs.existsSync(target)) {
      console.warn(`  ! icon not embedded: ${label} not found at ${target}`);
      return;
    }
  }

  try {
    // execFileSync, not execSync: no shell, so a space in the path cannot break
    // the command or be interpreted.
    execFileSync(rcedit, [exePath, '--set-icon', iconPath], { stdio: 'ignore' });
    console.log('  * icon embedded into Sanctorum.exe');
  } catch (err) {
    console.warn(`  ! icon not embedded: rcedit failed (${err.message})`);
  }
};
