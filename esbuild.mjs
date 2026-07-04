import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  // Prefer ESM entries: jsonc-parser's CJS entry is a UMD wrapper whose relative
  // requires esbuild can't statically bundle (breaks at runtime).
  mainFields: ['module', 'main'],
  target: 'node18',
  outfile: 'dist/extension.js',
  // 'vscode' is provided by the host at runtime and must not be bundled.
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
