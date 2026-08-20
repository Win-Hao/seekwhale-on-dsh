/**
 * src/ + assets/ → lib/client.js, the artifact DSH serves to the browser.
 *
 * DSH finds a plugin's browser half by reading `dsh.client` off package.json,
 * resolving the `./client` export, and serving that one file to the page — where it
 * is not an ES module but a script that calls `window.__ModuleLoader__.load({ id,
 * factory })` and pulls shared deps from the loader's `require` shim. Nothing in
 * that contract needs a compiler, so this concatenates rather than bundling.
 *
 * The SVGs are inlined. Only `lib/client.js` is addressable — the host serves that
 * path, not the package directory — so a sibling assets folder would 404 in the
 * browser. `<img src="data:…">` also keeps each state in its own document, which
 * matters because these SVGs carry their own CSS: two of them inlined into one page
 * would fight over `.f0` and `@keyframes` if the emitter had not scoped the names.
 *
 * usage: node build.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { gzipSync } from "zlib";
import { fileURLToPath } from "url";

const HERE = fileURLToPath(new URL("./", import.meta.url));

/**
 * DSH state → art. Driven by what `SessionSummary` actually publishes (`running`,
 * `pendingInteraction`, `completed`), so every entry is one the client can really
 * select. thinking/error have no distinct signal there — a turn is either running
 * or it is not — so their art stays out rather than shipping 250 KB that nothing
 * can ever reach.
 */
export const STATES = {
  // ── driven by the session snapshot ──
  idle: "seek-idle-follow.svg",
  working: "seek-working-typing.svg",   // one turn in flight
  swarm: "seek-working-terminal.svg",   // two or more at once
  approval: "seek-notification.svg",    // pendingInteraction 'approval'
  question: "seek-thinking.svg",        // pendingInteraction 'question'
  review: "seek-idle-chart.svg",        // pendingInteraction 'plan-review'
  done: "seek-attention.svg",           // completed unseen — celebrate
  sleeping: "seek-sleeping.svg",
  carrying: "seek-carrying.svg",        // held; the theme's reactions.drag art
  // ── reactions to being clicked; theme.json's reactions.* ──
  poke: "seek-notification.svg",        // clickLeft / clickRight
  annoyed: "seek-error.svg",            // kept poking. The one asset with no
                                             // session signal at all — a click is
                                             // the only thing that can select it.
  // ── idle flourishes, on a timer; these need no signal at all ──
  read: "seek-idle-read.svg",
  coffee: "seek-idle-coffee.svg",
  yawn: "seek-yawning.svg",
  spout: "seek-spouting.svg",
};

/**
 * The idle pool and each entry's own cycle length, straight out of theme.json's
 * idleAnimations. A flourish is shown for exactly one cycle and then handed back to
 * the resting pose, so the loop seam lands on the swap and is never seen.
 */
export const POOL = [
  ["read", 2750], ["coffee", 5000], ["review", 4708], ["yawn", 4250], ["spout", 3458],
];

/**
 * Click reactions and how long each holds, from theme.json's `reactions`. Two tiers
 * on purpose: one poke is a start, a flurry of them is being pestered, and the theme
 * drew both. Reuses art already in the bundle except for `annoyed`.
 */
export const POKES = [["poke", 2792], ["annoyed", 2917]];

/**
 * Framing, as fractions of the pet box — baked, not computed here, so this package
 * builds standalone without the authoring workspace.
 *
 * `size`/`left`/`bottom` are the host's normalized-layout solve (renderer.js
 * applyNormalizedLayoutStyle) for this theme's viewBox and layout, which is what
 * puts the whale on its baseline at desktop proportions instead of adrift in a
 * mostly-empty canvas. `hit` is the theme's `hitBoxes.default` pushed through the
 * same transform.
 *
 * The authoring workspace re-derives all six from theme.json on every build and
 * fails if they have drifted, so editing the theme's layout cannot silently leave
 * these stale.
 */
export const FRAME = {
  size: 1.7333,
  left: -0.3551,
  bottom: -0.1133,
  hit: { left: 0.2227, width: 0.5585, bottom: 0.1178, height: 0.443 },
};

export const PKG = JSON.parse(readFileSync(HERE + "package.json", "utf8")).name;

if (import.meta.url === `file://${process.argv[1]}`) {
  // gzip, not percent-encoding. These SVGs are one long run of near-identical path
  // and keyframe text, so they deflate about 8.7x — the whole 24-asset library is
  // 409 KB packed against 2.7 MB raw. That is the difference between shipping the
  // states the snapshot can actually distinguish and shipping four of them, so the
  // browser pays a DecompressionStream call per state instead.
  // Keyed by file, not by state: `approval` and `poke` are both the notification
  // clip, and `done` is the same breach the theme uses for a four-click. Emitting
  // per state would ship those payloads twice.
  const files = [...new Set(Object.values(STATES))];
  const blob = Object.fromEntries(files.map((f) => [
    f, gzipSync(readFileSync(HERE + "assets/" + f), { level: 9 }).toString("base64"),
  ]));
  const art = STATES;

  // `export ` is the only thing separating the authoring form from the concatenated
  // one; strip it rather than maintaining two copies of the source.
  const src = readFileSync(HERE + "src/client.js", "utf8").replace(/^export function /m, "function ");

  const out = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(PKG)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");
    const BLOB = ${JSON.stringify(blob)};
    const ART = ${JSON.stringify(art)};
    const FRAME = ${JSON.stringify(FRAME)};
    const POOL = ${JSON.stringify(POOL)};
    const POKES = ${JSON.stringify(POKES)};

${src}

    const plugin = createPlugin(React, BLOB, ART, FRAME, POOL, POKES);
    exports.apply = plugin.apply;
    exports.inject = plugin.inject;
    return module.exports;
  }
});
`;

  mkdirSync(HERE + "lib", { recursive: true });
  writeFileSync(HERE + "lib/client.js", out);
  console.log(`${PKG}  lib/client.js  ${(Buffer.byteLength(out) / 1024).toFixed(0)} KB`
    + `  ${Object.keys(STATES).length} 个状态 / ${files.length} 份素材`
    + `（待机花活 ${POOL.length}，点击反应 ${POKES.length}）`);
}
