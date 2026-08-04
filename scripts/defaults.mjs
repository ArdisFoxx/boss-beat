import { MODULE_ID } from "./constants.mjs";

/**
 * Ardis's saved "Boss Beat" Boss Bar style and the Diablo font it uses, captured live from
 * the dev world on 2026-08-04. Assets ship in this module's own assets/ folder so the style
 * is self-contained - it doesn't depend on ardisfoxxs-drakkenheim (where the font file also
 * happens to live) being installed.
 */
const DEFAULT_BAR_STYLE = {
  name: "Boss Beat",
  background: `modules/${MODULE_ID}/assets/Boss_Bar_Back.png`,
  bar: `modules/${MODULE_ID}/assets/Boss_Bar.png`,
  foreground: `modules/${MODULE_ID}/assets/Boss_Bar_Front.png`,
  tempBarColor: "#7e7e7e",
  tempBarAlpha: 0.5,
  barHeight: 20,
  textSize: 20,
  textAlign: "left",
  type: 1,
  font: "Diablo"
};

const DIABLO_FONT_DEFINITION = {
  editor: true,
  fonts: [{ urls: [`modules/${MODULE_ID}/assets/DIABLO.ttf`], weight: 100, style: "normal" }]
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
  fontFamily: "Diablo",
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
 * One-time, idempotent bootstrap: makes sure the "Boss Beat" Boss Bar style and its Diablo
 * font exist (adopting them if the GM already created them by hand, as on this dev world -
 * never duplicating), applies the saved Boss Splash look, and points Boss Beat's own config
 * form at that style as the default. Safe to call on every ready() - does nothing once
 * defaultsApplied is set.
 */
export async function applyDefaultsOnce() {
  if (game.settings.get(MODULE_ID, "defaultsApplied")) return;

  try {
    const barStyles = game.settings.get("bossbar", "barStyles") ?? [];
    let style = barStyles.find(s => s.name === DEFAULT_BAR_STYLE.name);
    if (!style) {
      style = { ...DEFAULT_BAR_STYLE, id: foundry.utils.randomID() };
      await game.settings.set("bossbar", "barStyles", [...barStyles, style]);
      console.log("Boss Beat | Registered default Boss Bar style", style.id);
    }
    await game.settings.set(MODULE_ID, "defaultBarStyle", style.id);
  } catch (err) {
    console.warn("Boss Beat | Couldn't set up the default Boss Bar style", err);
  }

  try {
    const fonts = game.settings.get("core", "fonts") ?? {};
    if (!fonts.Diablo) {
      await game.settings.set("core", "fonts", { ...fonts, Diablo: DIABLO_FONT_DEFINITION });
      console.log("Boss Beat | Registered Diablo font from bundled assets");
    }
  } catch (err) {
    console.warn("Boss Beat | Couldn't register the Diablo font", err);
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
  ui.notifications.info("Boss Beat: applied the default Boss Bar style and Boss Splash look.");
}
