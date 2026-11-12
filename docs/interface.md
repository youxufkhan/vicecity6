# Interface

The interface is plain DOM plus two canvases. There is no UI framework and no
build-time templating — `index.html` holds the markup, `styles.css` holds the
skin, and `HUD.ts` / `Menus.ts` drive it.

## HUD

`index.html` contains one `#hud` container with:

| Element | Purpose |
| --- | --- |
| `#clock-time`, `#clock-day` | In-game time and weekday |
| `#wanted` | Five stars, cyan when lit, the newest one blinking |
| `#money` | Cash, in `$1,234` format, with a bump animation on change |
| `#health-fill`, `#armor-fill` | Health and armour bars |
| `#mission-banner` | Mission title and current objective |
| `#toasts` | Transient notifications (cash, crimes, pickups) |
| `#radar` | 240×240 heading-up minimap canvas |
| `#speedo` | 190×190 needle speedometer canvas |
| `#weapon-icon`, `#weapon-name`, `#ammo` | Weapon and ammunition |
| `#crosshair` | Shown while aiming |
| `#prompt` | Contextual prompt, e.g. `E Enter COUPE` |
| `#damage-flash` | Red vignette on damage |
| `#wanted-flash` | Pulsing vignette while wanted |
| `#speed-lines` | Radial streaks above 150 km/h |
| `#worldmap` | Full-screen map overlay (toggled with `M`) |

`HUD.update(state)` is called every frame but only touches the DOM when a
value actually changed — the last written value is cached per field. This
avoids layout thrash at 60 fps.

## Radar

The radar is heading-up: the player's heading points to the top of the dial.
The world is rotated by `playerYaw + π` and the roads are drawn as thick lines
at the scale of the road width.

The rotation is derived from the requirement "forward is up, right is right",
which gives the world-to-radar transform:

```
radarX = (-dx * cos(yaw) + dz * sin(yaw)) * scale
radarY = (-dx * sin(yaw) - dz * cos(yaw)) * scale
```

Blips are drawn upright (not rotated with the map) so they stay readable:

| Blip | Shape | Colour |
| --- | --- | --- |
| Mission | Triangle in a ring | Gold |
| Target vehicle | Triangle in a ring | Cyan |
| Police | Pulsing dot | Pink |
| Vehicle | Square | Off-white |
| Pedestrian | Tiny dot | Grey |
| Pickup | Square | Mint |

The ocean and the beach are painted under the roads so the map matches the
world.

## World map

`M` toggles a full-screen map of the whole city: the road grid, the blocks, the
beach and the ocean, plus the same blips as the radar and a player arrow. The
action freezes while it is open, and releasing the pointer lock with `Esc`
closes the map instead of opening the pause menu.

## Menus

`Menus` owns the screens and the settings:

| Screen | Contents |
| --- | --- |
| Title | Logo, tagline, Start / Controls / Settings |
| Controls | Keyboard and mouse reference |
| Settings | Quality, shadows, volume, invert Y, sensitivity |
| Pause | Resume / Controls / Settings / Quit |
| Wasted | Death message and Respawn |
| Clear | Mission passed and reward |

Settings are written to `localStorage` under `vice-city-6.settings` and
re-applied on load. The quality setting changes the pixel ratio (0.75 / 1.2 /
up to 1.75), shadows toggle the shadow map, volume controls the master gain
and sensitivity scales the mouse delta.

The pointer is captured with the Pointer Lock API. Clicking the canvas (or the
"click to play" overlay) requests the lock; losing it while playing pauses the
game.

## Audio feedback

There is no separate audio UI — the settings panel controls the master volume.
The engine note follows the revs, the siren swells with the distance to the
nearest cruiser, and gunfire, crashes, pickups and mission completions all
have their own synthesised sounds.

## Touch controls

On a touch device (`'ontouchstart' in window`) an on-screen stick and three
buttons appear. The stick feeds the same virtual axes the keyboard feeds, and
the buttons map to action / run / fire. The HUD shifts to a phone layout under
620 px.
