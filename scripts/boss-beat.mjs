import { BossBeatConfigApp } from "./boss-beat-config.mjs";
import { MODULE_ID } from "./constants.mjs";
import { registerDefaultsSettings, applyDefaultsOnce } from "./defaults.mjs";
import { registerHpPathSettings, applyHpProfile } from "./hp-paths.mjs";

/** How long Boss Splash's overlay sits on screen before Boss Beat reveals the bar/token/ping.
 *  Matches the delay used in the original hand-written macro this module replaces. */
const SPLASH_DISPLAY_MS = 5000;

/**
 * Sounds that were stopped only because a NEWER Boss Beat run superseded them (see
 * BossBeatControls.start()'s "cut the old track" branch) - as opposed to genuinely finishing
 * or being stopped by the GM's own Stop button. run()'s own end/stop listener checks this
 * before switching to that run's outro playlist, so an interrupted run doesn't hand control of
 * the music back to whatever IT was configured with after a newer boss has already taken over
 * the scene. A WeakSet needs no cleanup - entries fall out on their own once the Sound itself
 * is garbage collected.
 */
const supersededSounds = new WeakSet();

/**
 * game.audio.play() builds a Sound on the CALLING client and nothing else - the v14 signature
 * is play(src, {context, ...options}) with no socket argument, and AudioHelper.broadcast is
 * gone. Every Boss Beat entry point is GM-gated, so the boss song was only ever audible to the
 * GM. Everything else this module plays does reach players, because it goes through
 * PlaylistSound documents and Foundry syncs those; the song is the one path that touches no
 * document at all. So mirror it over the module socket: each client plays its own copy while
 * the GM keeps the authoritative Sound that all the marker timing and handoff logic is built
 * around.
 *
 * Copies start independently, so there is sub-second drift between clients and no seek sync.
 * For a boss intro that plays start to finish that is not worth a document round-trip to fix.
 */
const SOCKET = `module.${MODULE_ID}`;

/** This client's mirrored copy, and the run that owns it. The run id is what makes a stop
 *  message safe to act on: a superseded run broadcasts its own stop when the newer run cuts
 *  its sound, and without an id check that message would kill the newer track on every player
 *  while the GM carried on hearing it. */
let mirroredSound = null;
let mirroredRunId = null;

/** Routed through game.audio.music so the listener's own Music volume slider applies. Without a
 *  context the track ignores that slider entirely and a player has no way to turn a boss down. */
async function playMirrored(src, volume, runId = null) {
  try { mirroredSound?.stop(); } catch (_) { /* already gone */ }
  mirroredSound = null;
  mirroredRunId = runId;
  try {
    mirroredSound = await game.audio.play(src, {
      context: game.audio.music,
      volume: Number(volume) >= 0 ? Number(volume) : 0.6,
      loop: false,
      autoplay: true
    });
  } catch (err) {
    console.error("Boss Beat | mirrored playback failed:", err);
  }
}

function stopMirrored(runId = null) {
  // Ignore a stop from a run this client has already moved on from. A null id means "stop
  // whatever is playing" and is kept for a message from any older build.
  if (runId && mirroredRunId && runId !== mirroredRunId) return;
  try { mirroredSound?.stop(); } catch (_) { /* already gone */ }
  mirroredSound = null;
  mirroredRunId = null;
}

/**
 * Pauses every currently-playing PlaylistSound across every currently-playing Playlist, the
 * same way Foundry's own sidebar Pause button does - a document update capturing the real
 * `sound.currentTime` into `pausedTime` (confirmed by reading the sidebar's own
 * `soundPause` action handler), not just muting the underlying Sound object. That means a GM
 * who wants their ambient track back later can hit Play on it by hand and pick up right where
 * the boss interrupted it, same as manually pausing anything else in the Playlists sidebar.
 * Never touches a playlist that wasn't already playing - triggering a boss over silence leaves
 * it silent going in, same as always.
 */
async function pauseActivePlaylistTracks() {
  for (const playlist of game.playlists.playing) {
    const playingSounds = playlist.sounds.filter((s) => s.playing);
    for (const playlistSound of playingSounds) {
      await playlistSound.update({
        playing: false,
        pausedTime: playlistSound.sound?.currentTime ?? playlistSound.pausedTime ?? 0
      });
    }
  }
}

/**
 * Starts the boss's configured outro playlist via playAll() - the exact same entry point
 * Foundry's own sidebar play button uses, so it honors whatever playback mode
 * (sequential/shuffle/simultaneous) the GM already has that playlist set to. Quietly does
 * nothing if the boss has no outro playlist configured, or if the configured playlist was
 * deleted since - a missing playlist shouldn't throw and interrupt the rest of the reveal.
 */
async function switchToOutroPlaylist(config) {
  if (!config.outroPlaylist) return;
  const playlist = game.playlists.get(config.outroPlaylist);
  if (!playlist) return;
  await playlist.playAll();
}

Hooks.once("init", () => {
  console.log("Boss Beat | Initializing");
  registerDefaultsSettings();
  registerHpPathSettings();
  game.settings.register(MODULE_ID, "hideBossBarButton", {
    name: "BOSSBEAT.Settings.HideBossBarButton.Name",
    hint: "BOSSBEAT.Settings.HideBossBarButton.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    // Force the scene-controls bar to re-render immediately on toggle, rather than leaving
    // the GM staring at a setting that visibly did nothing until their next reload - see the
    // renderSceneControls hook below for why a re-render (not the getSceneControlButtons data
    // hook) is what actually applies this.
    onChange: () => ui.controls.render(true)
  });
});

// Deliberately `setup`, not `ready`, and this is load-bearing. Boss Bar computes each bar's
// fill percentage once, when the bar renders, and only recomputes it in its own updateActor
// hook - nothing re-reads the HP settings when they change. Measured live: correcting the
// paths mid-session left a bar already on screen frozen at NaN% until the boss next took
// damage. Writing at `ready` would lose that race on every single load, so the GM would see a
// dead bar until something moved. `setup` runs after every module's `init` (so bossbar's
// settings are registered and safe to write) and before any bar has rendered.
Hooks.once("setup", async () => {
  if (game.user.isGM) await applyHpProfile();
});

Hooks.once("ready", async () => {
  game.bossBeat = BossBeat;
  // Players only. The GM already owns the real Sound and would otherwise hear the track twice.
  game.socket?.on(SOCKET, async (data) => {
    if (game.user.isGM) return;
    if (data?.action === "play") await playMirrored(data.src, data.volume, data.runId ?? null);
    else if (data?.action === "stop") stopMirrored(data.runId ?? null);
  });
  if (game.user.isGM) await applyDefaultsOnce();
});

Hooks.on("getSceneControlButtons", (controls) => {
  const tokenControls = controls.tokens;
  if (!tokenControls) return;
  tokenControls.tools.bossBeat = {
    name: "bossBeat",
    title: "Boss Beat",
    icon: "fa-solid fa-drum",
    button: true,
    visible: game.user.isGM,
    onChange: (event, active) => BossBeat.launch()
  };
});

// bossbar registers its own toolbar button (tool key "bossBar") for manually assigning
// actors/styles to the bar - Boss Beat's config form covers that same job per-boss, so once
// the GM's used to driving it from here, that second button is just clutter.
//
// Deliberately NOT done by deleting `controls.tokens.tools.bossBar` inside the
// getSceneControlButtons hook above: hooks for that event fire in registration order, which
// turned out to put Boss Beat's listener BEFORE bossbar's (confirmed live by inspecting
// Hooks.events) despite bossbar being a load-order dependency of Boss Beat - so the delete ran
// first and bossbar re-added its tool right after. Removing the rendered DOM element instead,
// via renderSceneControls, sidesteps that ordering entirely - it only runs once all
// getSceneControlButtons listeners (from every module) have already populated the data being
// rendered.
Hooks.on("renderSceneControls", (app, html) => {
  if (!game.settings.get(MODULE_ID, "hideBossBarButton")) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const button = (root ?? document).querySelector?.('[data-tool="bossBar"]');
  button?.remove();
});

export class BossBeat {
  static getConfig(actor) {
    return actor.getFlag(MODULE_ID, "config") ?? null;
  }

  static async clearConfig(actor) {
    return actor.unsetFlag(MODULE_ID, "config");
  }

  /**
   * Macro-friendly entry point: runs a token's already-saved Boss Beat config immediately,
   * skipping the Run/Edit/Delete/Cancel prompt `launch()` shows. For a hotbar macro tied to
   * a specific boss rather than "whatever's selected right now" - a GM who's already dialed
   * in the beat during prep doesn't need to be asked again mid-session.
   */
  static async runSaved(token) {
    if (!game.user.isGM) return;
    const actor = token?.actor;
    if (!actor) {
      ui.notifications.warn(game.i18n.localize("BOSSBEAT.NoActor"));
      return;
    }
    const config = this.getConfig(actor);
    if (!config) {
      ui.notifications.warn(game.i18n.format("BOSSBEAT.NoSavedConfig", { name: actor.name }));
      return;
    }
    await this.run(token, actor, config);
  }

  /** Entry point wired to the scene-control button. */
  static async launch() {
    if (!game.user.isGM) return;

    const tokens = canvas.tokens.controlled;
    if (tokens.length !== 1) {
      ui.notifications.warn(game.i18n.localize("BOSSBEAT.SelectOneToken"));
      return;
    }
    const token = tokens[0];
    const actor = token.actor;
    if (!actor) {
      ui.notifications.warn(game.i18n.localize("BOSSBEAT.NoActor"));
      return;
    }

    const existing = this.getConfig(actor);
    if (!existing) {
      new BossBeatConfigApp({ token, actor }).render(true);
      return;
    }

    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.format("BOSSBEAT.AlreadySavedTitle", { name: actor.name }) },
      content: `<p>${game.i18n.format("BOSSBEAT.AlreadySaved", { name: actor.name })}</p>`,
      buttons: [
        { action: "run", label: game.i18n.localize("BOSSBEAT.Run"), icon: "fa-solid fa-play", default: true },
        { action: "edit", label: game.i18n.localize("BOSSBEAT.Edit"), icon: "fa-solid fa-pen" },
        { action: "delete", label: game.i18n.localize("BOSSBEAT.Delete"), icon: "fa-solid fa-trash" },
        { action: "cancel", label: game.i18n.localize("BOSSBEAT.Cancel"), icon: "fa-solid fa-xmark" }
      ],
      rejectClose: false
    });

    if (choice === "edit") {
      new BossBeatConfigApp({ token, actor, existing }).render(true);
    } else if (choice === "delete") {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("BOSSBEAT.ConfirmDeleteTitle") },
        content: `<p>${game.i18n.format("BOSSBEAT.ConfirmDelete", { name: actor.name })}</p>`
      });
      if (confirmed) {
        await this.clearConfig(actor);
        ui.notifications.info(game.i18n.format("BOSSBEAT.Deleted", { name: actor.name }));
      }
    } else if (choice === "run") {
      await this.run(token, actor, existing);
    }
  }

  static async run(token, actor, config) {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    // Cut away from whatever the GM's playlists are doing the instant the boss song starts -
    // "if playing," so a boss triggered over silence is left exactly that way. Always runs,
    // independent of whether this boss has an outro playlist configured below - playing the
    // boss track over ambient music is wrong either way.
    await pauseActivePlaylistTracks();

    // Identifies this run's messages so a superseded run cannot stop the run that replaced it.
    const runId = foundry.utils.randomID();

    let sound;
    try {
      // Ship at whatever volume the GM left the preview player at when saving - older saved
      // configs from before this field existed fall back to the same 0.6 default new configs
      // start at.
      sound = await game.audio.play(config.songPath, {
        context: game.audio.music,
        volume: config.volume ?? 0.6,
        loop: false,
        autoplay: true
      });
      game.socket?.emit(SOCKET, { action: "play", src: config.songPath, volume: config.volume ?? 0.6, runId });
    } catch (err) {
      ui.notifications.error(game.i18n.format("BOSSBEAT.PlaybackError", { path: config.songPath }));
      console.error("Boss Beat |", err);
      return;
    }

    // Resolves once THIS run's own sound genuinely finishes - either it plays out to the end,
    // or the GM hits Stop (before or after the marker - either way there's nothing more this
    // song is going to do). Listened for directly on `sound` itself, independent of
    // BossBeatControls's own bookkeeping, so a second/newer Boss Beat run gets its own promise
    // tied to its own distinct Sound object - no cross-run interference possible. Registered
    // now, before the marker-wait loop below, so it's in place on every path out of this
    // function (marker reached, cancelled before the marker, cancelled right at the marker) -
    // not just the ones that reach the end of run().
    let resolveFinished;
    const trackFinished = new Promise((resolve) => { resolveFinished = resolve; });
    const onTrackFinished = () => {
      resolveFinished();
      // Sent on a natural end as well as an explicit stop. A client whose copy started late,
      // or buffered mid-track, would otherwise still be playing the boss song when the outro
      // playlist takes over - the same collision pauseActivePlaylistTracks() exists to prevent
      // at the other end of the run. The run id keeps it honest: a client already listening to
      // a newer boss ignores this, and stopping a sound that has already ended is a no-op.
      game.socket?.emit(SOCKET, { action: "stop", runId });
    };
    sound.addEventListener("end", onTrackFinished, { once: true });
    sound.addEventListener("stop", onTrackFinished, { once: true });
    trackFinished.then(async () => {
      // A newer Boss Beat run stopped this sound out from under it (see BossBeatControls.start())
      // - that run owns the music now, so this one steps aside rather than switching to its own
      // (possibly different) outro playlist over the top of whatever the new run is doing.
      if (supersededSounds.has(sound)) return;
      await switchToOutroPlaylist(config);
    });

    BossBeatControls.start(config.markerSeconds, sound);

    // Poll actual playback position rather than a blind setTimeout, so pausing the song
    // from the transport controls genuinely holds the countdown - it doesn't just look
    // paused while the splash still fires on the original wall-clock schedule.
    //
    // Cancelled is checked FIRST, every iteration, deliberately decoupled from the marker
    // condition - a `while (sound.currentTime < config.markerSeconds) { if (cancelled) return }`
    // shape (what this used to be) only ever reaches the cancelled check while the loop
    // condition is still true. Clicking Stop calls sound.stop(), and on a real Sound that can
    // itself push currentTime up to/past duration - so the very next iteration's *outer* while
    // condition reads false, the loop exits through its normal "marker reached" path, and the
    // splash fires anyway despite cancelled being true, without the cancelled check ever having
    // a chance to run. Confirmed live: Stop clicked well before the marker still fired the
    // splash and Boss Bar under the old shape. Checking cancelled unconditionally on every pass,
    // before anything else, closes that regardless of what stop() does to currentTime.
    while (true) {
      if (BossBeatControls.cancelled) return;
      if (sound.currentTime >= config.markerSeconds) break;
      await wait(100);
    }
    if (BossBeatControls.cancelled) return; // belt and suspenders against a last-instant cancel

    BossBeatControls.markerReached();

    // Match the splash's font to whatever Boss Bar style this boss is actually using, rather
    // than leaving it to boss-splash's own global fontFamily setting - that setting is a single
    // world-wide default (Boss Beat points it at "Optimus Princeps" on install, see
    // defaults.mjs), but bar styles carry their own `font` and the GM can pick a different
    // style per boss. Without this, a boss set to e.g. the "Evil" style (Times New Roman on the
    // bar) would still splash in whatever the global default happens to be. splashBoss()'s
    // options.fontFamily overrides the global setting for just this call (confirmed by reading
    // boss-splash's own source - BossSplashOverlay#getData does
    // `this.options.fontFamily ?? game.settings.get('boss-splash','fontFamily')`); falls through
    // to that same global default if the selected style can't be found or has no font of its
    // own.
    const barStyle = (game.settings.get("bossbar", "barStyles") ?? []).find(s => s.id === config.barStyle);
    game.bossSplash.splashBoss({
      message: config.message,
      subText: config.subText,
      fontFamily: barStyle?.font || undefined
    });
    await wait(SPLASH_DISPLAY_MS);

    // Boss Bar's displayed name comes from the Actor document (`this.actor.name`), not the
    // token - confirmed by reading bossbar's own source (its "name" getter reads
    // `this.actor.name` directly). Renaming only the token, as a first pass here did, left
    // the bar showing the actor's old name. Rename the actor to match Boss Beat's Message
    // field at the reveal, same moment the token itself gets renamed and unhidden.
    if (config.message && actor.name !== config.message) {
      await actor.update({ name: config.message });
    }

    // Splash-only bosses skip the Boss Bar and nothing else: the splash still fires, the
    // actor and token are still renamed, and the token is still revealed. The bar style is
    // deliberately still read above - it is what the splash takes its FONT from, so turning
    // the bar off must not quietly drop the boss back to the world-wide default font.
    if (!config.splashOnly) await canvas.scene.setFlag("bossbar", "actors", canvas.tokens.controlled.map(t => ({
      uuid: t.actor.uuid,
      style: config.barStyle,
      hideName: false
    })));

    const revealUpdate = { hidden: false };
    if (config.message && token.document.name !== config.message) revealUpdate.name = config.message;
    await token.document.update(revealUpdate);

    game.canvas.ping(
      { x: token.x, y: token.y },
      { size: 0, pull: true, zoom: 2 }
    );

    // Leave the transport panel up - the song keeps going as battle music, and it'll
    // tear itself down once the track ends or the GM clicks Stop.
  }
}

/**
 * Floating on-screen panel (GM-only) shown while a Boss Beat track plays. Doubles as a
 * countdown to the marked beat before it hits, and as play/pause/stop/volume transport for
 * a track that (deliberately) isn't running through the Playlists sidebar.
 */
class BossBeatControls {
  static #el = null;
  static #interval = null;
  static #sound = null;
  static #listeners = null;
  static #cancelled = false;

  static get cancelled() {
    return this.#cancelled;
  }

  static start(markerSeconds, sound) {
    // Starting a new Boss Beat while a previous one is still playing (e.g. the GM ran it
    // for one boss and then another) - cut the old track rather than leaving two songs
    // running with only the new one controllable. Tagging it first lets that old run's own
    // end/stop listener (see run()) tell the difference between "genuinely finished" and
    // "got cut off by something newer" - only the former should hand off to an outro playlist.
    if (this.#sound && this.#sound !== sound && this.#sound.playing) {
      supersededSounds.add(this.#sound);
      this.#sound.stop();
    }
    this.stop();
    this.#sound = sound;
    this.#cancelled = false;

    const el = document.createElement("div");
    el.id = "boss-beat-controls";
    el.innerHTML = `
      <div class="boss-beat-countdown-text"></div>
      <div class="boss-beat-transport">
        <button type="button" data-bb-action="toggle" data-tooltip="Pause/Resume"><i class="fa-solid fa-pause"></i></button>
        <button type="button" data-bb-action="stop" data-tooltip="Stop"><i class="fa-solid fa-stop"></i></button>
        <i class="fa-solid fa-volume-high boss-beat-volume-icon"></i>
        <input type="range" data-bb-action="volume" min="0" max="1" step="0.05">
      </div>
    `;
    document.body.appendChild(el);
    this.#el = el;

    const countdownText = el.querySelector(".boss-beat-countdown-text");
    const toggleBtn = el.querySelector('[data-bb-action="toggle"]');
    // Same button/label ("Stop") the whole time - but clicking it before the marker does more
    // than end the track: it sets #cancelled, which the marker-wait loop in run() checks on
    // every poll and returns out of before ever calling game.bossSplash.splashBoss() or touching
    // the Boss Bar flag. After the marker, the splash has already gone out, so clicking Stop at
    // that point is just ending the now-playing battle music - nothing left to cancel.
    const stopBtn = el.querySelector('[data-bb-action="stop"]');
    const volumeInput = el.querySelector('[data-bb-action="volume"]');

    volumeInput.value = sound.volume ?? 1;
    toggleBtn.innerHTML = sound.playing ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';

    toggleBtn.addEventListener("click", () => {
      if (sound.playing) sound.pause();
      else sound.play();
    });
    stopBtn.addEventListener("click", () => {
      this.#cancelled = true;
      // sound.stop() only fires the "stop" event (which is what normally tears the panel
      // down via onStop below) if the sound was actually still playing. If it had already
      // ended or been paused-then-stopped, that event never fires and the panel would be
      // stuck on screen - so tear it down directly rather than relying on the event.
      sound.stop();
      this.stop();
    });
    volumeInput.addEventListener("input", () => {
      sound.volume = Number(volumeInput.value);
    });

    const onPlay = () => { toggleBtn.innerHTML = '<i class="fa-solid fa-pause"></i>'; };
    const onPause = () => { toggleBtn.innerHTML = '<i class="fa-solid fa-play"></i>'; };
    const onEnd = () => { this.#cancelled = true; this.stop(); };
    const onStop = () => { this.#cancelled = true; this.stop(); };
    sound.addEventListener("play", onPlay);
    sound.addEventListener("pause", onPause);
    sound.addEventListener("end", onEnd);
    sound.addEventListener("stop", onStop);
    this.#listeners = { onPlay, onPause, onEnd, onStop };

    this.#interval = setInterval(() => {
      const remaining = Math.max(0, markerSeconds - sound.currentTime);
      countdownText.textContent = remaining > 0 ? remaining.toFixed(1) : "";
    }, 100);
  }

  /** Marker was reached - drop the countdown number, keep play/pause/stop/volume up. */
  static markerReached() {
    if (this.#interval) clearInterval(this.#interval);
    this.#interval = null;
    this.#el?.querySelector(".boss-beat-countdown-text")?.remove();
  }

  static stop() {
    if (this.#interval) clearInterval(this.#interval);
    this.#interval = null;
    if (this.#sound && this.#listeners) {
      this.#sound.removeEventListener("play", this.#listeners.onPlay);
      this.#sound.removeEventListener("pause", this.#listeners.onPause);
      this.#sound.removeEventListener("end", this.#listeners.onEnd);
      this.#sound.removeEventListener("stop", this.#listeners.onStop);
    }
    this.#sound = null;
    this.#listeners = null;
    if (this.#el) {
      this.#el.remove();
      this.#el = null;
    }
  }
}
