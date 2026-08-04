import { MODULE_ID } from "./constants.mjs";

/**
 * Two named Boss Bar styles, sharing Ardis's bar artwork (captured live from the dev world on
 * 2026-08-04) but paired with a different font each - "Souls" with the bundled Optimus
 * Princeps (the font Dark Souls' own UI uses), "Diablo" with a font named "Diablo" that this
 * module does NOT bundle (see the font-registration comment below) - it only renders correctly
 * if a "Diablo" font is already registered some other way (by hand, or by another module).
 * Both use `type: 1` (bossbar's `MATCHING_IMAGES` mode, confirmed by reading its source:
 * `Y = {CLASSIC: 0, MATCHING_IMAGES: 1}`) - that mode renders the bar art as actual `<img>`
 * elements sized to the boss-bar window's real width rather than tiling a fixed-height
 * background, so the art scales cleanly to however wide the GM drags the window, no per-style
 * width/height knob needed. `textAlign: "center"` is what puts the boss's name centered over
 * the bar, matching the reference look Ardis asked to match.
 */
const SHARED_BAR_ART = {
  background: `modules/${MODULE_ID}/assets/Boss_Bar_Back.png`,
  bar: `modules/${MODULE_ID}/assets/Boss_Bar.png`,
  foreground: `modules/${MODULE_ID}/assets/Boss_Bar_Front.png`,
  tempBarColor: "#7e7e7e",
  tempBarAlpha: 0.5,
  textSize: 20,
  textAlign: "center",
  type: 1
};

const DEFAULT_BAR_STYLES = [
  { name: "Boss Beat Souls", ...SHARED_BAR_ART, font: "Optimus Princeps" },
  { name: "Boss Beat Diablo", ...SHARED_BAR_ART, font: "Diablo" }
];

/** Which of DEFAULT_BAR_STYLES.name gets pre-selected in BossBeatConfigApp by default. */
const DEFAULT_STYLE_NAME = "Boss Beat Souls";

/**
 * Bundled fonts. Deliberately does NOT include a Diablo font file - the repo is public now,
 * and a font extracted from Blizzard's game isn't something to redistribute without a clearer
 * license than "found it somewhere." The "Boss Beat Diablo" style above still references a
 * font named "Diablo" by name; on Ardis's own world that resolves via the copy already
 * registered by ardisfoxxs-drakkenheim, and elsewhere it degrades to the browser default until
 * someone registers their own "Diablo" font. The zip Ardis supplied for Optimus Princeps
 * contains two separate font families (not weight variants of one family - each file's
 * internal name/style metadata is its own "Regular"), so each is registered under its own
 * family name.
 */
const OPTIMUS_PRINCEPS_FONT_DEFINITION = {
  editor: true,
  fonts: [{ urls: [`modules/${MODULE_ID}/assets/OptimusPrinceps.ttf`], weight: 400, style: "normal" }]
};

const OPTIMUS_PRINCEPS_SEMIBOLD_FONT_DEFINITION = {
  editor: true,
  fonts: [{ urls: [`modules/${MODULE_ID}/assets/OptimusPrincepsSemiBold.ttf`], weight: 400, style: "normal" }]
};

/**
 * Ardis's saved Boss Splash look - colors, font, sizes, and timing. Deliberately excludes
 * splashMessage/subText (those are Boss Splash's own macro-facing placeholder defaults, not
 * style, and Boss Beat always supplies its own explicit message/subText) and
 * permissions-emit (an access-control setting, not a look-and-feel one - not ours to change
 * automatically).
 */
const DEFAULT_BOSS_SPLASH_SETTINGS = {
  colorFirst: "000000a6",
  colorSecond: "000000a6",
  colorThird: "000000a6",
  colorFont: "#ffffff",
  colorShadow: "#00000000",
  subColorFont: "#ffffff",
  subColorShadow: "#00000000",
  bossSound: "",
  fontFamily: "Optimus Princeps",
  fontSize: "100px",
  subFontSize: "30px",
  splashTimer: 5,
  animationDuration: 3,
  animationDelay: 0,
  showTokenHUD: true,
  revealDuration: 0
};

export function registerDefaultsSettings() {
  game.settings.register(MODULE_ID, "defaultsApplied", {
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });
  game.settings.register(MODULE_ID, "defaultBarStyle", {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
}

/**
 * One-time, idempotent bootstrap: makes sure the "Boss Beat Souls"/"Boss Beat Diablo" Boss Bar
 * styles and the bundled fonts they use exist (adopting an existing hand-made style by name
 * instead of duplicating it, same as before), applies the saved Boss Splash look, and points
 * Boss Beat's own config form at "Boss Beat Souls" as the default. Safe to call on every
 * ready() - does nothing once defaultsApplied is set.
 */
export async function applyDefaultsOnce() {
  if (game.settings.get(MODULE_ID, "defaultsApplied")) return;

  try {
    let barStyles = game.settings.get("bossbar", "barStyles") ?? [];
    let defaultStyleId = null;
    for (const preset of DEFAULT_BAR_STYLES) {
      let style = barStyles.find(s => s.name === preset.name);
      if (!style) {
        style = { ...preset, id: foundry.utils.randomID() };
        barStyles = [...barStyles, style];
        console.log("Boss Beat | Registered Boss Bar style", style.name, style.id);
      }
      if (preset.name === DEFAULT_STYLE_NAME) defaultStyleId = style.id;
    }
    await game.settings.set("bossbar", "barStyles", barStyles);
    if (defaultStyleId) await game.settings.set(MODULE_ID, "defaultBarStyle", defaultStyleId);
  } catch (err) {
    console.warn("Boss Beat | Couldn't set up the default Boss Bar styles", err);
  }

  const bundledFonts = {
    "Optimus Princeps": OPTIMUS_PRINCEPS_FONT_DEFINITION,
    "Optimus Princeps SemiBold": OPTIMUS_PRINCEPS_SEMIBOLD_FONT_DEFINITION
  };
  try {
    const fonts = game.settings.get("core", "fonts") ?? {};
    const additions = {};
    for (const [name, definition] of Object.entries(bundledFonts)) {
      if (!fonts[name]) additions[name] = definition;
    }
    if (Object.keys(additions).length) {
      await game.settings.set("core", "fonts", { ...fonts, ...additions });
      console.log("Boss Beat | Registered fonts from bundled assets:", Object.keys(additions).join(", "));
    }
  } catch (err) {
    console.warn("Boss Beat | Couldn't register bundled fonts", err);
  }

  for (const [key, value] of Object.entries(DEFAULT_BOSS_SPLASH_SETTINGS)) {
    try {
      await game.settings.set("boss-splash", key, value);
    } catch (err) {
      console.warn(`Boss Beat | Couldn't set boss-splash.${key}`, err);
    }
  }

  await game.settings.set(MODULE_ID, "defaultsApplied", true);
  console.log("Boss Beat | Defaults applied");
  ui.notifications.info("Boss Beat: applied the default Boss Bar styles and Boss Splash look.");
}
