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
          barStyle: game.settings.get(MODULE_ID, "defaultBarStyle") ?? ""
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
      setMarker: BossBeatConfigApp.#onSetMarker
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
    return {
      ...this.data,
      barStyleChoices,
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

  static async #onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    if (!this.data.songPath) {
      ui.notifications.warn(game.i18n.localize("BOSSBEAT.PickSongFirst"));
      return false;
    }
    this.data.message = data.message ?? this.data.message;
    this.data.subText = data.subText ?? "";
    this.data.barStyle = data.barStyle ?? "";
    await this.actor.setFlag(MODULE_ID, "config", this.data);
    ui.notifications.info(game.i18n.format("BOSSBEAT.Saved", { name: this.actor.name }));
  }
}
