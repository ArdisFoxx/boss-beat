# Boss Beat

Replaces a hand-timed "wait N seconds then reveal the boss" macro with
something scrubbed to the beat. Pick a boss's song, scrub to the exact
moment you want the reveal to land, and save it against that boss's token.

On Run: the song plays, a countdown to your marked beat shows on screen so
you can narrate up to the moment, and right on the beat it fires
[Boss Splash](https://foundryvtt.com/packages/boss-splash), reveals the
[Boss Bar](https://foundryvtt.com/packages/bossbar), unhides the token, and
pings the canvas. It also renames the token and actor to whatever you typed
as the reveal message, so the Boss Bar's name matches what the splash just
announced.

Since the song isn't routed through Foundry's Playlists sidebar, Boss Beat
ships its own floating play/pause/stop/volume transport panel for whatever
track it's previewing or running.

## Requirements

- Foundry VTT v13+ (developed against 14.365)
- The [Boss Splash](https://foundryvtt.com/packages/boss-splash) and
  [Boss Bar](https://foundryvtt.com/packages/bossbar) modules, both enabled

## Use

1. Select a boss's token on the canvas.
2. Click the drum icon in the token scene-controls toolbar.
3. First time: pick a song, scrub/preview it and set the volume with the
   native player's controls (defaults to 0.6 - whatever you leave it at is
   what it plays back at live), hit **Set Marker Here** at the beat you
   want, fill in the splash message/subtext and a Boss Bar style, then
   **Save**.
4. Next time you click the button with that token selected: **Run** plays it
   straight through to the reveal, **Edit** reopens the config, **Delete**
   clears the saved setup.

### Skipping the prompt

The config's **Create Macro** button generates a ready-to-use World Macro
that instantly runs that boss's saved Boss Beat - drag it to your hotbar for
a one-click "just go" once a beat's already dialed in.

### Settings

**"Hide Boss Bar's toolbar button"** removes Boss Bar's own scene-control
button, so you don't get two similar buttons cluttering the Token controls
group. Applies immediately, no reload needed.

On first install, Boss Beat also registers a bundled Boss Bar style, "Boss
Beat Souls" (Optimus Princeps font, bar art and font both bundled in
`assets/`), and applies a preset Boss Splash look, so everything's ready to
use out of the box. This only happens once per world, and adopts an
existing style of the same name instead of duplicating it if you've already
made one by hand.

## Credits

The bar artwork in `assets/` (`Boss_Bar.png`, `Boss_Bar_Back.png`,
`Boss_Bar_Front.png`) was created by Reddit user
[xxxmalkin](https://www.reddit.com/user/xxxmalkin/) ([Bluesky](https://bsky.app/profile/moonkanin.bsky.social)) -
Used and redistributed with their permission.

The bundled Optimus Princeps font (`OptimusPrinceps.ttf`,
`OptimusPrincepsSemiBold.ttf`) is by [Manfred Klein](https://www.dafont.com/optimusprinceps.font),
listed on dafont.com under its "100% Free" license category.

## License

The code in this repository is MIT-licensed (see `LICENSE`). The bar
artwork is used with the artist's permission - see Credits above, not
covered by the code's MIT license. The bundled Optimus Princeps fonts
carry their own font license (see Credits above) - check dafont's listing
before reusing them outside this module.
