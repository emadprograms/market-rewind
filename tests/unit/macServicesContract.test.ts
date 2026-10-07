/**
 * macOS service contract — pins the parts of tools/mac that each already cost a round.
 *
 * Nothing in tools/mac had automated coverage. These scripts were verified by hand on the
 * Mac, one round at a time, and three separate bugs in them survived to hardware before
 * anyone noticed:
 *
 *   1. THE SHELL-WRAPPER BUG (fixed in e6d1975). The frontend LaunchAgent ran the server
 *      through /bin/bash. macOS TCC refuses to let launchd execute a shell script that
 *      lives under ~/Documents, so the agent silently failed to start. Running node
 *      directly avoids the shell entirely. This is why the plist must name the node binary
 *      as its first ProgramArguments entry and must not mention a shell at all.
 *
 *   2. THE STALE-BUNDLE BUG (fixed in a29f632). The agent serves dist/ with
 *      `vite preview` and never builds. If the bundle is empty or out of date, the tablet
 *      gets 404s or old code. So build_frontend() has to run BEFORE launchctl load -- the
 *      ordering is the fix, not the build itself.
 *
 *   3. THE 403 BUG. Vite rejects requests whose Host header it does not recognise. The
 *      tablet reaches this app by LAN IP, hostname, or a tunnelled hostname, so without
 *      `allowedHosts: true` production mode answers the tablet with 403. The dev server
 *      had the same problem, hence the pair.
 *
 * Each of those failures is silent: the service is "up", the page just does not work. That
 * is exactly the class of defect a cheap read-only test should hold down. These tests parse
 * the scripts and the Vite config as text — they need no Mac, no launchd and no shell.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..');
const read = (rel: string) => readFileSync(resolve(REPO_ROOT, rel), 'utf-8');

/** Returns the body of the heredoc that writes `dest`, without the surrounding markers. */
function heredocWriting(src: string, dest: string): string {
  const marker = `cat <<EOF > "\${${dest}}"`;
  const start = src.indexOf(marker);
  expect(start, `no heredoc writing ${dest} found`).toBeGreaterThan(-1);
  const bodyStart = src.indexOf('\n', start) + 1;
  const end = src.indexOf('\nEOF\n', bodyStart);
  expect(end, `unterminated heredoc for ${dest}`).toBeGreaterThan(-1);
  return src.slice(bodyStart, end);
}

/** Extracts an object literal found at `marker`, by brace balance, comments included. */
function braceBlock(src: string, marker: string): string {
  const at = src.indexOf(marker);
  expect(at, `marker not found: ${marker}`).toBeGreaterThan(-1);
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces after: ${marker}`);
}

const configBlock = (src: string, key: string) => braceBlock(src, `\n    ${key}: {`);

/** The `<string>` entries of the plist's ProgramArguments array, in order. */
function programArguments(plist: string): string[] {
  const key = plist.indexOf('<key>ProgramArguments</key>');
  expect(key, 'no ProgramArguments key in the plist').toBeGreaterThan(-1);
  const open = plist.indexOf('<array>', key);
  const close = plist.indexOf('</array>', open);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return [...plist.slice(open, close).matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
}

describe('macOS frontend agent: launch node directly', () => {
  const install = read('tools/mac/install-startup.sh');
  const plist = heredocWriting(install, 'FRONTEND_PLIST');

  it('names the node binary first, not a shell', () => {
    // ProgramArguments[0] is the executable launchd runs. TCC blocks a shell script under
    // ~/Documents, so this must be node itself.
    const programArgs = programArguments(plist);
    expect(programArgs[0]).toBe('${NODE_BIN}');
    expect(programArgs[0]).not.toMatch(/\/(ba|z|k|c|fi)?sh$/);
  });

  it('does not reference a shell anywhere in the agent definition', () => {
    expect(plist).not.toMatch(/\/bin\/(ba|z)?sh/);
    expect(plist).not.toMatch(/<string>sh<\/string>/);
  });

  it('runs `vite preview`, so the tablet gets the bundle and not the dev server', () => {
    // Drop `preview` and the agent serves the unbundled dev server: a per-module request
    // waterfall over Wi-Fi, which was the dominant cost of the tablet cold load.
    expect(plist).toContain('vite.js');
    expect(plist).toMatch(/<string>preview<\/string>/);
  });

  it('binds 0.0.0.0, so the tablet can reach it from another device', () => {
    expect(plist).toContain('<string>0.0.0.0</string>');
  });
});

describe('macOS startup: build the bundle before loading the agent', () => {
  // The agent cannot build. Loading it before dist/ is current means 404s or stale code,
  // and the failure is invisible: launchd reports the service as running.
  for (const script of ['tools/mac/install-startup.sh', 'tools/mac/start-services.sh']) {
    it(`${script} calls build_frontend before launchctl load`, () => {
      const src = read(script);
      // Match the call, not the name: install-startup.sh explains this ordering in a
      // comment *above* the real call, and matching the bare name would let the actual
      // call drift below the load while the test kept passing.
      const build = src.search(/if ! build_frontend;/);
      const load = src.search(/launchctl load/);
      expect(build, `no build_frontend call in ${script}`).toBeGreaterThan(-1);
      expect(load, `no launchctl load in ${script}`).toBeGreaterThan(-1);
      expect(build).toBeLessThan(load);
    });

    it(`${script} refuses to load the agent if the build fails`, () => {
      const src = read(script);
      // `if ! build_frontend; then ... exit 1` -- a failed build must abort, not continue
      // to a load that would serve whatever dist/ happened to contain.
      const guard = /if ! build_frontend; then[\s\S]{0,400}?exit 1/.test(src);
      expect(guard, `${script} continues after a failed build`).toBe(true);
    });
  }
});

describe('macOS frontend serve mode defaults to the bundled build', () => {
  const src = read('tools/mac/start-frontend.sh');

  it('defaults to prod', () => {
    // Anchored to a bare assignment: `--prod) SERVE_MODE="prod"` also contains the string,
    // so an unanchored match would pass even with the default flipped to dev.
    expect(src).toMatch(/^\s*SERVE_MODE="prod"\s*$/m);
  });

  it('only dev mode opts out, via --dev', () => {
    expect(src).toMatch(/--dev\)\s*SERVE_MODE="dev"/);
  });

  it('builds before previewing in prod mode', () => {
    // Same ordering invariant as the launchd path, for the manual start path. The prod
    // branch is everything between `then` and `else` in the SERVE_MODE check.
    const branchStart = src.indexOf('"${SERVE_MODE}" = "prod"');
    expect(branchStart, 'no SERVE_MODE=prod branch').toBeGreaterThan(-1);
    const then = src.indexOf('\n', branchStart);
    const elseAt = src.indexOf('\nelse', then);
    expect(elseAt, 'prod branch has no else').toBeGreaterThan(then);
    const prodBranch = src.slice(then, elseAt);

    const build = prodBranch.search(/\bbuild\b/);
    const preview = prodBranch.indexOf('VITE_ARGS=(preview');
    expect(build, 'prod branch does not build the bundle').toBeGreaterThan(-1);
    expect(preview, 'prod branch does not run vite preview').toBeGreaterThan(-1);
    expect(build, 'prod branch picks up a stale dist/').toBeLessThan(preview);
  });

  it('dev mode is the only mode that skips preview', () => {
    const branchStart = src.indexOf('"${SERVE_MODE}" = "prod"');
    const elseAt = src.indexOf('\nelse', branchStart);
    const fiAt = src.indexOf('\nfi', elseAt);
    expect(elseAt, 'no dev branch').toBeGreaterThan(-1);
    expect(fiAt, 'dev branch is unterminated').toBeGreaterThan(elseAt);
    const devBranch = src.slice(elseAt, fiAt);

    expect(devBranch).toMatch(/VITE_ARGS=\(--host/);
    expect(devBranch, 'dev mode still serves the bundle').not.toContain('preview');
  });
});

describe('vite serves off-machine: Host-header guard is disabled', () => {
  // Without this the tablet is answered with 403 and the page never loads. The dev and
  // preview blocks must not drift apart: `start-frontend.sh --dev` is the supported way to
  // run off-machine, so both need it.
  const viteConfig = read('vite.config.ts');

  it('preview accepts an unrecognised Host header', () => {
    const block = configBlock(viteConfig, 'preview');
    expect(block).toMatch(/allowedHosts:\s*true/);
    expect(block).toMatch(/host:\s*true/);
  });

  it('the dev server accepts an unrecognised Host header too', () => {
    const block = configBlock(viteConfig, 'server');
    expect(block).toMatch(/allowedHosts:\s*true/);
    expect(block).toMatch(/host:\s*true/);
  });

  it('both modes proxy /api and /ws, so they behave identically', () => {
    // `proxy` is defined once above the config object and referenced by shorthand in both
    // blocks, so assert the definition has the routes and each block actually uses it.
    const definition = braceBlock(viteConfig, 'const proxy = {');
    expect(definition, 'shared proxy does not route /api').toContain("'/api'");
    expect(definition, 'shared proxy does not route /ws').toContain("'/ws'");

    for (const key of ['preview', 'server']) {
      expect(configBlock(viteConfig, key), `${key} does not use the shared proxy`).toMatch(
        /(^|\s)proxy,/,
      );
    }
  });
});
