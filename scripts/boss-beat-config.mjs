import { MODULE_ID } from "./constants.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class BossBeatConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ token, actor, existing } = {}, options = {}) {
    super(options);
    this.token = token;
    this.actor = actor;
    this.data = existing
      ? foundry.utils.deepClone(existing)
      : {
          songPath: "",
          markerSeconds: 0,
          message: actor?.name ?? "",
          subText: "",
          barStyle: game.settings.get(MODULE_ID, "defaultBarStyle") ?? "",
          volume: 0.6,
          outroPlaylist: ""
        };
  }

  static DEFAULT_OPTIONS = {
    id: "boss-beat-config-{id}",
    tag: "form",
    window: { icon: "fa-solid fa-drum", resizable: true },
    position: { width: 480, height: "auto" },
    form: { handler: BossBeatConfigApp.#onSubmit, submitOnChange: false, closeOnSubmit: true },
    actions: {
      pickSong: BossBeatConfigApp.#onPickSong,
      setMarker: BossBeatConfigApp.#onSetMarker,
      createMacro: BossBeatConfigApp.#onCreateMacro
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/boss-beat-config.hbs` }
  };

  get title() {
    return game.i18n.format("BOSSBEAT.WindowTitle", { name: this.actor?.name ?? "" });
  }

  async _prepareContext() {
    const barStyles = game.settings.get("bossbar", "barStyles") ?? [];
    const barStyleChoices = Object.fromEntries(barStyles.map(s => [s.id, s.name]));
    // Soundboard-only playlists (CONST.PLAYLIST_MODES.DISABLED) are excluded - Playlist#playAll()
    // (what the outro hand-off calls, see boss-beat.mjs) explicitly no-ops for that mode rather
    // than starting anything, since soundboard sounds are meant to be triggered individually.
    // Offering one here would look like a valid choice that silently does nothing.
    const playlistChoices = Object.fromEntries(
      game.playlists.contents
        .filter(p => p.mode !== CONST.PLAYLIST_MODES.DISABLED)
        .map(p => [p.id, p.name])
    );
    return {
      ...this.data,
      barStyleChoices,
      playlistChoices,
      markerLabel: BossBeatConfigApp.formatTime(this.data.markerSeconds)
    };
  }

  static formatTime(seconds) {
    seconds = Number(seconds) || 0;
    const m = Math.floor(seconds / 60);
    const s = (seconds % 60).toFixed(1).padStart(4, "0");
    return `${m}:${s}`;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const audio = this.element.querySelector("audio#boss-beat-audio");
    if (audio && this.data.songPath && audio.src !== this.data.songPath) {
      audio.src = this.data.songPath;
    }
    // Preview at the saved volume (Edit flow), not the browser's default - so what's already
    // saved is what the GM sees/hears reflected in the native volume slider, matching what
    // will actually play live.
    if (audio) audio.volume = this.data.volume ?? 0.6;
  }

  static async #onPickSong(event, target) {
    // Picking a song re-renders the form to reveal the audio player, which regenerates
    // every field from this.data. Message/subText/barStyle only get copied into this.data
    // at Save time, so without this they'd silently snap back to whatever they were when
    // the app opened, wiping out anything the GM had already typed. Pull the live DOM
    // values in first so the re-render has something current to render back out.
    const current = new foundry.applications.ux.FormDataExtended(this.element).object;
    this.data.message = current.message ?? this.data.message;
    this.data.subText = current.subText ?? this.data.subText;
    this.data.barStyle = current.barStyle ?? this.data.barStyle;
    this.data.outroPlaylist = current.outroPlaylist ?? this.data.outroPlaylist;
    // Volume isn't a form field (it's the native <audio controls> element's own slider, not
    // an <input> FormDataExtended sees) - read it straight off the DOM before the re-render
    // below recreates the audio element and would otherwise reset it back to the default.
    const currentAudio = this.element.querySelector("audio#boss-beat-audio");
    if (currentAudio) this.data.volume = currentAudio.volume;

    const fp = new foundry.applications.apps.FilePicker.implementation({
      type: "audio",
      current: this.data.songPath,
      callback: (path) => {
        this.data.songPath = path;
        this.render();
      }
    });
    fp.render(true);
  }

  static #onSetMarker(event, target) {
    const audio = this.element.querySelector("audio#boss-beat-audio");
    if (!audio) return;
    this.data.markerSeconds = audio.currentTime;
    // Patch the label directly instead of calling render() - a full re-render would
    // recreate the <audio> element from the template and reset playback to 0,
    // interrupting the GM mid-scrub right after they found the beat.
    const label = this.element.querySelector(".boss-beat-marker-label");
    if (label) {
      label.textContent = game.i18n.format("BOSSBEAT.Marker", {
        time: BossBeatConfigApp.formatTime(this.data.markerSeconds)
      });
    }
  }

  // Writes a real World Macro (not a bundled .js file the GM has to paste in) that finds this
  // actor's token on whatever scene is current when the macro is run, and runs its saved Boss
  // Beat - so the macro stays correct even if the boss's token gets deleted and re-dropped
  // (new token, same actor), and warns instead of erroring if the boss isn't on the viewed
  // scene at all.
  static async #onCreateMacro(event, target) {
    if (!this.actor) {
      ui.notifications.warn(game.i18n.localize("BOSSBEAT.NoActor"));
      return;
    }
    const actorId = this.actor.id;
    const actorName = this.actor.name;
    const command = [
      `const actor = game.actors.get("${actorId}");`,
      `const token = canvas.tokens.placeables.find(t => t.actor?.id === actor?.id);`,
      `if (!token) {`,
      `  ui.notifications.warn(\`Boss Beat: ${actorName.replace(/`/g, "\\`")} isn't on the current scene.\`);`,
      `} else {`,
      `  await game.bossBeat.runSaved(token);`,
      `}`
    ].join("\n");
    const macro = await Macro.create({
      name: game.i18n.format("BOSSBEAT.MacroName", { name: actorName }),
      type: "script",
      img: this.actor.img || "icons/svg/drum.svg",
      command
    });
    ui.notifications.info(game.i18n.format("BOSSBEAT.MacroCreated", { name: macro.name }));
  }

  static async #onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    if (!this.data.songPath) {
      ui.notifications.warn(game.i18n.localize("BOSSBEAT.PickSongFirst"));
      return false;
    }
    this.data.message = data.message ?? this.data.message;
    this.data.subText = data.subText ?? "";
    this.data.barStyle = data.barStyle ?? "";
    this.data.outroPlaylist = data.outroPlaylist ?? "";
    // Same reasoning as #onPickSong - volume lives on the native <audio> element, not a form
    // field, so it has to be read off the DOM directly rather than out of `data`. Whatever
    // level the GM left the preview at is what plays live.
    const audio = this.element.querySelector("audio#boss-beat-audio");
    if (audio) this.data.volume = audio.volume;
    await this.actor.setFlag(MODULE_ID, "config", this.data);
    ui.notifications.info(game.i18n.format("BOSSBEAT.Saved", { name: this.actor.name }));
  }
}
