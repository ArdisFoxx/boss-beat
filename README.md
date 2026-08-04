# Boss Beat

A system-agnostic Foundry VTT module that replaces a hand-timed "wait N
seconds then reveal the boss" macro with something scrubbed to the beat. It
only talks to Foundry's core APIs plus Boss Splash and Boss Bar - nothing in
it depends on any particular game system.

Pick a boss's song from the file browser, scrub it to the exact moment you
want the reveal to land, and drop a marker there. Boss Beat saves that
marker plus a splash message, subtext, and Boss Bar style against the boss's
token/actor. Next time you trigger it on that token, choose Run, Edit, or
Delete. On Run, the song plays, a countdown to the marked beat shows on
screen so you can narrate up to the moment, and right on the beat it fires
[Boss Splash](https://foundryvtt.com/packages/boss-splash), reveals the
[Boss Bar](https://foundryvtt.com/packages/bossbar), unhides the token, and
pings the canvas.

Because the song isn't routed through Foundry's Playlists sidebar (this
table runs music through Kenku/Discord instead), Boss Beat ships its own
floating play/pause/stop/volume transport panel for whatever track it's
previewing or running.

At the moment of reveal, Boss Beat also renames the token to whatever you
typed into the Message field - since Boss Bar displays the token's name,
this keeps the bar's label matching what the splash just announced instead
of whatever the token happened to be called before.

## Requirements

- Foundry VTT v13+ (developed against 14.365)
- The [Boss Splash](https://foundryvtt.com/packages/boss-splash) and
  [Boss Bar](https://foundryvtt.com/packages/bossbar) modules, both enabled
- Any game system - Boss Beat only reads/writes its own module flags and
  standard token/actor fields, so it isn't tied to Daggerheart or any other
  system

## Use

1. Select a boss's token on the canvas.
2. Click the drum icon in the token scene-controls toolbar.
3. First time: pick a song, scrub/preview it, hit **Set Marker Here** at the
   beat you want, fill in the splash message/subtext and a Boss Bar style,
   then **Save**.
4. Next time you click the button with that token selected: **Run** plays it
   straight through to the reveal, **Edit** reopens the config, **Delete**
   clears the saved setup.

On first install, Boss Beat also registers a bundled "Boss Beat" Boss Bar
style (using the art and font in `assets/`) and applies a preset Boss Splash
look, so both are ready to use out of the box without manual setup. This
only happens once, and it adopts an existing style of the same name instead
of duplicating it if you've already made one by hand.

## Notes

- Personal-use module built for a specific home game; not published to the
  Foundry package listing.
