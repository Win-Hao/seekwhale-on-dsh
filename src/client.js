/**
 * Seek — browser half.
 *
 * This is the real source. It used to live as a template string inside the build
 * script, which meant every backtick and every `${` in a comment was a live grenade
 * — one of them did go off and truncated the whole literal. Here it is ordinary
 * JavaScript: editable, lintable, and importable by a test.
 *
 * `build.mjs` wraps this in DSH's client-bundle envelope and hands it the two
 * things it cannot know at authoring time: the inlined art and the framing numbers
 * derived from the theme.
 *
 * @param React - the loader's shared React.
 * @param BLOB - file name → gzipped, base64 SVG.
 * @param ART - state name → file name (several states share one file).
 * @param F - framing: image scale and offsets, plus the grab-handle rect, all as
 *   fractions of the pet box.
 * @param POOL - idle flourishes as [state, cycleMs], shown one cycle at a time.
 * @param POKES - click reactions as [state, holdMs], escalating with click count.
 * @returns the cordis plugin's `{ apply, inject }` pair.
 */
export function createPlugin(React, BLOB, ART, F, POOL, POKES) {
  /** Box the pet occupies; the SVG canvas is larger and overhangs it. */
  const BOX = 132;
  const SLEEP_AFTER = 90000;
  const SPOT = "seek:spot";

  /**
   * Alt-click cycle. Four of these states need real agent activity to appear —
   * you cannot sit around waiting for a permission prompt just to check the art —
   * so the pet can be pinned to each in turn, then handed back to the live feed
   * (the trailing null).
   */
  const CYCLE = [...Object.keys(ART), null];

  /**
   * Art arrives gzipped, so it has to be inflated before an <img> can take it.
   * Done lazily and cached: the whale shows one state at a time, and most sessions
   * never reach half of them, so inflating all thirteen up front would be work for
   * nothing. Blob URLs keep each SVG in its own document, which is what stops their
   * scoped-but-still-global CSS from meeting.
   */
  const blobs = new Map();
  function artUrl(state, onReady) {
    const file = ART[state];
    if (blobs.has(file)) return blobs.get(file);
    if (!file || typeof DecompressionStream !== "function") return null;
    blobs.set(file, null);                        // in flight; do not start twice
    const raw = Uint8Array.from(atob(BLOB[file]), (c) => c.charCodeAt(0));
    new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip")))
      .blob()
      .then((b) => {
        blobs.set(file, URL.createObjectURL(b.slice(0, b.size, "image/svg+xml")));
        onReady();
      })
      .catch(() => blobs.delete(file));
    return null;
  }

  const clamp = (v, hi) => Math.max(0, Math.min(v, Math.max(0, hi)));

  /**
   * Pick one state for the whole window, not per session: the pet is a single
   * animal and the user runs several sessions at once. Urgency wins over progress
   * — being asked a question outranks work still in flight, which outranks a
   * finished turn nobody has looked at yet.
   */
  const ASKING = { approval: "approval", question: "question", "plan-review": "review" };

  function pick(list) {
    const rows = Object.values(list && list.byId ? list.byId : {});
    // Being asked outranks everything, and the three kinds of ask are genuinely
    // different animals: a permission prompt is a jolt, a question is a ponder, a
    // plan review is the whale squinting at a chart.
    for (const kind of ["approval", "question", "plan-review"]) {
      if (rows.some((s) => s && s.pendingInteraction === kind)) return ASKING[kind];
    }
    const running = rows.filter((s) => s && s.running).length;
    if (running > 1) return "swarm";              // theme.json's workingTiers idea
    if (running === 1) return "working";
    if (rows.some((s) => s && s.completed)) return "done";
    return "idle";
  }

  /** Remembered corner offsets, or the default berth. */
  function restore() {
    try {
      const raw = JSON.parse(localStorage.getItem(SPOT));
      if (raw && Number.isFinite(raw.right) && Number.isFinite(raw.bottom)) return raw;
    } catch (_) { /* unreadable or absent — take the default berth */ }
    return { right: 16, bottom: 16 };
  }

  function Seek({ useSessions }) {
    const live = useSessions(pick);
    const [drowsy, setDrowsy] = React.useState(false);
    const [spot, setSpot] = React.useState(restore);
    const [held, setHeld] = React.useState(false);
    const [pinned, setPinned] = React.useState(null);
    const [flourish, setFlourish] = React.useState(null);
    const [poked, setPoked] = React.useState(null);
    const pokes = React.useRef({ n: 0, at: 0, timer: null });
    const [, bump] = React.useReducer((n) => n + 1, 0);
    const grab = React.useRef(null);
    const box = React.useRef(null);
    const shown = React.useRef(null);

    // Sleep is the absence of an event, so it cannot come from the snapshot — it
    // needs a clock. Restart it whenever the live state changes; only a stretch of
    // uninterrupted idle is allowed to put the whale under.
    React.useEffect(() => {
      setDrowsy(false);
      if (live !== "idle") return undefined;
      const t = setTimeout(() => setDrowsy(true), SLEEP_AFTER);
      return () => clearTimeout(t);
    }, [live]);

    /**
     * Idle flourishes. Nothing in the snapshot asks for these — a whale that only
     * ever hangs there while you are not running anything is the dullest two thirds
     * of the day — so they run off a clock: wait a while, play one pose for exactly
     * its own cycle, hand back to the resting pose. One cycle exactly, because the
     * loop seam then lands on the swap and is never seen.
     */
    React.useEffect(() => {
      if (live !== "idle" || drowsy || held || pinned) { setFlourish(null); return undefined; }
      let alive = true, gap, run;
      const later = () => {
        gap = setTimeout(() => {
          if (!alive) return;
          const [name, ms] = POOL[Math.floor(Math.random() * POOL.length)];
          setFlourish(name);
          run = setTimeout(() => { if (alive) { setFlourish(null); later(); } }, ms);
        }, 12000 + Math.random() * 18000);
      };
      later();
      return () => { alive = false; clearTimeout(gap); clearTimeout(run); };
    }, [live, drowsy, held, pinned]);

    // Being carried outranks everything: while you are holding the whale, what it
    // is doing about your sessions is not the interesting fact.
    const auto = held ? "carrying"
      : poked
      || (drowsy && live === "idle" ? "sleeping" : null)
      || (live === "idle" && flourish)
      || live;
    const state = pinned || auto;

    // Inflation is async, so the first paint of a state has no URL yet. Hold the
    // last one that resolved rather than blinking to nothing on every change.
    const url = artUrl(state, bump);
    if (url) shown.current = url;
    React.useEffect(() => { artUrl("idle", bump); }, []);

    const onDown = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      // Alt-click steps the preview instead of picking the whale up.
      if (e.altKey) {
        setPinned(CYCLE[(CYCLE.indexOf(pinned) + 1) % CYCLE.length]);
        e.preventDefault();
        return;
      }
      // Capture on the handle, so a fast drag that outruns the pointer keeps
      // delivering move events instead of dropping the whale mid-flight.
      e.currentTarget.setPointerCapture(e.pointerId);
      grab.current = {
        x: e.clientX, y: e.clientY, right: spot.right, bottom: spot.bottom,
        t: Date.now(), moved: false,
      };
      setHeld(true);
      e.preventDefault();
    };

    /**
     * A poke, escalating. One prod gets a start; keep prodding inside the window and
     * the whale gets annoyed, which is the only way `error` art can ever be selected
     * — nothing in the session snapshot says "this failed".
     */
    const poke = () => {
      const p = pokes.current;
      const now = Date.now();
      p.n = now - p.at < 1800 ? p.n + 1 : 1;
      p.at = now;
      const [name, hold] = POKES[Math.min(p.n, POKES.length) - 1];
      setPoked(name);
      clearTimeout(p.timer);
      p.timer = setTimeout(() => setPoked(null), hold);
    };
    React.useEffect(() => () => clearTimeout(pokes.current.timer), []);

    const onMove = (e) => {
      const g = grab.current;
      if (!g) return;
      // Anchored bottom-right, so both axes run opposite the pointer. Bounds come
      // from the BOX's offsetParent (the overlay layer), never the grip's — the
      // grip sits inside the box, so its offsetParent is the box itself and the
      // ceiling would compute as 132-132 = 0, pinning the whale into the corner
      // the moment you touched it.
      const layer = box.current && box.current.offsetParent;
      const w = layer ? layer.clientWidth : window.innerWidth;
      const h = layer ? layer.clientHeight : window.innerHeight;
      // A few pixels of slop is a click, not a drag — fingers and trackpads wobble.
      if (Math.abs(e.clientX - g.x) > 4 || Math.abs(e.clientY - g.y) > 4) g.moved = true;
      setSpot({
        right: clamp(g.right - (e.clientX - g.x), w - BOX),
        bottom: clamp(g.bottom - (e.clientY - g.y), h - BOX),
      });
    };

    const onUp = () => {
      const g = grab.current;
      if (!g) return;
      grab.current = null;
      setHeld(false);
      if (!g.moved && Date.now() - g.t < 500) poke();
    };

    // Persist where it was let go, not every pixel of the drag.
    React.useEffect(() => {
      if (held) return;
      try { localStorage.setItem(SPOT, JSON.stringify(spot)); } catch (_) { /* private mode */ }
    }, [held, spot]);

    return React.createElement("div", {
      "data-seek": state,
      "data-seek-pinned": pinned || undefined,
      title: pinned ? ("Seek: " + pinned + " (pinned — alt-click to step)") : "Seek",
      ref: box,
      style: {
        position: "absolute", right: spot.right, bottom: spot.bottom,
        width: BOX, height: BOX,
        // The canvas is 1.73x this box and hangs off every side — that is the
        // framing, not a mistake, and clipping it here is what reproduces the
        // desktop pet window exactly. Without it the overhang runs past the
        // viewport corner and the whale loses its right side to the edge.
        overflow: "hidden",
        // The box stays click-through; only the handle below opts back in. A
        // boxful of transparent pixels must not eat clicks meant for the app.
        pointerEvents: "none",
        touchAction: "none",
      },
    }, [
      React.createElement("img", {
        key: "art",
        src: shown.current || undefined,
        alt: "",
        draggable: false,
        style: {
          position: "absolute",
          width: BOX * F.size, height: BOX * F.size,
          left: BOX * F.left, bottom: BOX * F.bottom,
          imageRendering: "pixelated",
        },
      }),
      // The grab handle: the theme's hitBoxes.default, projected through the same
      // transform as the art. Sized to the animal, not to its canvas.
      React.createElement("div", {
        key: "grip",
        "data-seek-grip": "",
        onPointerDown: onDown,
        onPointerMove: onMove,
        onPointerUp: onUp,
        onPointerCancel: onUp,
        style: {
          position: "absolute",
          left: BOX * F.hit.left, width: BOX * F.hit.width,
          bottom: BOX * F.hit.bottom, height: BOX * F.hit.height,
          pointerEvents: "auto",
          cursor: held ? "grabbing" : "grab",
          touchAction: "none",
        },
      }),
      pinned ? React.createElement("div", {
        key: "tag",
        style: {
          position: "absolute", left: 0, right: 0, top: 2,
          font: "10px ui-monospace, monospace", textAlign: "center",
          color: "#4D6BFE", opacity: 0.75, pointerEvents: "none",
        },
      }, pinned) : null,
    ]);
  }

  /** @param ctx - client root context. */
  function apply(ctx) {
    ctx.slots.inject("shell.overlay", () => ctx.slots.register({
      name: "shell.overlay",
      id: "seek",
      order: 50,
      label: "Seek",
    }, Seek));
  }

  return { apply, inject: ["sessions", "slots"] };
}
