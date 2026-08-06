import { MODULE_ID } from "./constants.mjs";

/**
 * Boss Bar reads a boss's health out of two dot-paths and one flag, all three of them world
 * settings on the `bossbar` module itself:
 *
 *   currentHp  = foundry.utils.getProperty(actor.system, getSetting("currentHpPath"))
 *   maxHp      = foundry.utils.getProperty(actor.system, getSetting("maxHpPath"))
 *   hpPercent  = woundsSystem ? (maxHp - currentHp) / maxHp : currentHp / maxHp
 *
 * (Confirmed by reading bossbar 5.0.1's own source - `currentHp`/`maxHp` are getters, so a path
 * change takes effect on the next bar refresh, while `useWounds` is captured in the Bar
 * constructor, so a woundsSystem change only reaches bars created after it. Applying at `ready`,
 * before any bar exists, sidesteps that.)
 *
 * Those paths are relative to `actor.system` and bossbar ships one hardcoded default pair,
 * `attributes.hp.value` / `attributes.hp.max`, which is a D&D-family shape. Daggerheart has no
 * `system.attributes.hp` at all - both reads come back `undefined` and the bar fills to NaN,
 * which is the bug this fixes.
 *
 * The other half of it is direction. Daggerheart counts Hit Points **up**: `value` is how many
 * HP the creature has marked, i.e. damage taken, so it needs bossbar's wounds mode (which
 * inverts the fraction) to read as a health bar. PF2e and 5e count down, so they need it off.
 * Setting the paths without the direction gives a bar that empties as the boss gets healthier.
 */
const SYSTEM_HP_PROFILES = {
  daggerheart: {
    currentHpPath: "resources.hitPoints.value",
    maxHpPath: "resources.hitPoints.max",
    woundsSystem: true
  },
  pf2e: {
    currentHpPath: "attributes.hp.value",
    maxHpPath: "attributes.hp.max",
    woundsSystem: false
  },
  dnd5e: {
    currentHpPath: "attributes.hp.value",
    maxHpPath: "attributes.hp.max",
    woundsSystem: false
  }
};

/** The bossbar setting keys this feature owns while it's switched on. */
const OWNED_KEYS = ["currentHpPath", "maxHpPath", "woundsSystem"];

/** Whether Boss Beat knows how to drive Boss Bar's health readout on the running system. */
export function hasHpProfile() {
  return !!SYSTEM_HP_PROFILES[game.system.id];
}

export function registerHpPathSettings() {
  game.settings.register(MODULE_ID, "fixBossBarHp", {
    name: "BOSSBEAT.Settings.FixBossBarHp.Name",
    hint: "BOSSBEAT.Settings.FixBossBarHp.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    // Take effect on the spot rather than at the next reload - a GM who just ticked this is
    // looking at the Boss Bar settings wondering whether anything happened.
    onChange: (value) => (value ? applyHpProfile({ notify: true }) : restoreHpPaths({ notify: true }))
  });
  // What bossbar's three health settings held before Boss Beat first overwrote them, so
  // switching this feature back off puts the GM's own values back rather than bossbar's
  // factory defaults. Null means "we don't currently own them."
  game.settings.register(MODULE_ID, "hpPathsBackup", {
    scope: "world",
    config: false,
    type: Object,
    default: null
  });
}

/**
 * Points Boss Bar's health settings at the running game system's real HP fields. Idempotent -
 * writes only the keys that are actually wrong, so calling it on every `ready` is free and
 * silent unless something has drifted. Does nothing on a system Boss Beat has no profile for:
 * leaving bossbar's own settings alone is strictly better than guessing a path, and the GM can
 * still set them by hand there.
 */
export async function applyHpProfile({ notify = false } = {}) {
  if (!game.user.isGM) return;
  if (!game.settings.get(MODULE_ID, "fixBossBarHp")) return;

  const profile = SYSTEM_HP_PROFILES[game.system.id];
  if (!profile) {
    console.log(
      `Boss Beat | No Boss Bar health profile for game system "${game.system.id}" - leaving Boss Bar's own HP settings alone.`
    );
    return;
  }

  try {
    // Back up once, on the transition from not-owning to owning. Re-taking it on every apply
    // would overwrite the GM's original values with our own the second time around, and then
    // "restore" would restore nothing.
    let firstTakeover = false;
    if (!game.settings.get(MODULE_ID, "hpPathsBackup")) {
      const backup = {};
      for (const key of OWNED_KEYS) backup[key] = game.settings.get("bossbar", key);
      await game.settings.set(MODULE_ID, "hpPathsBackup", backup);
      firstTakeover = true;
    }

    const changed = [];
    for (const key of OWNED_KEYS) {
      if (game.settings.get("bossbar", key) === profile[key]) continue;
      await game.settings.set("bossbar", key, profile[key]);
      changed.push(`${key} = ${JSON.stringify(profile[key])}`);
    }
    if (!changed.length) return;

    console.log(`Boss Beat | Boss Bar health settings set for ${game.system.id}: ${changed.join(", ")}`);
    // Say so the first time Boss Beat takes these over, even on a silent startup pass - quietly
    // rewriting another module's settings behind the GM's back isn't something to do without
    // telling them once. After that, startup re-assertion stays silent.
    if (notify || firstTakeover) {
      // A bar that's already on screen keeps whatever percentage it computed when it rendered -
      // Boss Bar doesn't re-read these settings, it only recomputes in its own updateActor
      // hook. Toggling this mid-session is real but invisible until the boss takes a hit, so
      // say which message applies rather than letting it look like nothing happened.
      const key = game.ready ? "BOSSBEAT.HpProfileAppliedLive" : "BOSSBEAT.HpProfileApplied";
      ui.notifications.info(game.i18n.format(key, { system: game.system.id }));
    }
  } catch (err) {
    console.warn("Boss Beat | Couldn't set Boss Bar's HP settings", err);
  }
}

/**
 * Hands Boss Bar's health settings back to whatever they were before Boss Beat took them over,
 * and stops owning them. Called when the GM switches the feature off.
 */
export async function restoreHpPaths({ notify = false } = {}) {
  if (!game.user.isGM) return;

  const backup = game.settings.get(MODULE_ID, "hpPathsBackup");
  if (!backup) return;

  try {
    for (const key of OWNED_KEYS) {
      if (backup[key] === undefined) continue;
      if (game.settings.get("bossbar", key) === backup[key]) continue;
      await game.settings.set("bossbar", key, backup[key]);
    }
    await game.settings.set(MODULE_ID, "hpPathsBackup", null);
    console.log("Boss Beat | Restored Boss Bar's own HP settings");
    if (notify) ui.notifications.info(game.i18n.localize("BOSSBEAT.HpProfileRestored"));
  } catch (err) {
    console.warn("Boss Beat | Couldn't restore Boss Bar's HP settings", err);
  }
}
