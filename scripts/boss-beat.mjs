import { BossBeatConfigApp } from "./boss-beat-config.mjs";
import { MODULE_ID } from "./constants.mjs";
import { registerDefaultsSettings, applyDefaultsOnce } from "./defaults.mjs";

/** How long Boss Splash's overlay sits on screen before Boss Beat reveals the bar/token/ping.
 *  Matches the delay used in the original hand-written macro this module replaces. */
const SPLASH_DISPLAY_MS = 5000;

Hooks.once("init", () => {
  console.log("Boss Beat | Initializing");
  registerDefaultsSettings();
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

Hooks.once("ready", async () => {
  game.bossBeat = BossBeat;
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

    let sound;
    try {
      // Ship at whatever volume the GM left the preview player at when saving - older saved
      // configs from before this field existed fall back to the same 0.6 default new configs
      // start at.
      sound = await game.audio.play(config.songPath, { volume: config.volume ?? 0.6, loop: false, autoplay: true });
    } catch (err) {
      ui.notifications.error(game.i18n.format("BOSSBEAT.PlaybackError", { path: config.songPath }));
      console.error("Boss Beat |", err);
      return;
    }

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

    await canvas.scene.setFlag("bossbar", "actors", canvas.tokens.controlled.map(t => ({
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
    // running with only the new one controllable.
    if (this.#sound && this.#sound !== sound && this.#sound.playing) {
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
