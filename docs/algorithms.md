# Algorithms and techniques

The non-obvious parts of the implementation: the maths, the approximations and
the reasoning behind them.

## Arcade vehicle physics

The car is a point mass with a heading, integrated on the XZ plane. Each step:

**1. Work in the car frame.** The velocity is decomposed into forward and
lateral components:

```
forward = (sin yaw, cos yaw)
right   = (-cos yaw, sin yaw)          // = forward × up
v_fwd   = v · forward
v_lat   = v · right
```

**2. Engine and brakes.** Acceleration falls off as the car approaches its top
speed:

```
headroom = clamp01(1 - v_fwd / topSpeed)
v_fwd   += power * throttle * (0.35 + 0.65 * headroom) * dt
```

Negative throttle brakes at 26 m/s² while moving forward, and reverses at
half power below 0.4 m/s, capped at 34 % of the top speed in reverse.

**3. Resistance.** Rolling and aerodynamic drag: `0.6 + 0.0022 * v²`, applied
only when the throttle is off or fighting the current direction. The handbrake
adds a further 11 m/s² of retardation. Resistance is clamped at zero speed so
it cannot push a nearly stopped car into reverse.

**4. Lateral grip.** The lateral velocity is damped exponentially:

```
v_lat *= exp(-grip * dt)      // grip = spec.grip (≈10), or 2.4 on the handbrake
```

This single term is what produces grippy cornering, and what lets the handbrake
break traction into a drift. While sliding, extra forward speed is scrubbed
off (`|v_lat| * 0.32`), which is why a long slide slows the car down.

**5. Steering.** The yaw rate scales with speed (no turning while stationary)
and falls off at high speed so the car does not become twitchy:

```
speedFactor  = clamp01(|v_fwd| / 5.5)
highSpeed    = clamp(1 - |v_fwd| / (topSpeed * 1.6), 0.45, 1)
yawRate      = -steer * spec.steering * speedFactor * highSpeed * dir
```

`dir` flips the steering when reversing, exactly like a real car. Lateral slip
adds extra rotation (`-slip * 0.55`), which turns a slide into a spin.

**6. Rebuild and integrate.** The velocity is reassembled in the new frame and
the position is integrated, then clamped to the world bounds.

**Visual feedback.** Body pitch follows longitudinal acceleration, roll follows
lateral speed, the wheels spin at `v / radius` and the front wheels take the
steering angle. Brake lights brighten under braking.

## Collision

`CollisionWorld` is a uniform grid (40 m cells) over the axis-aligned
building boxes.

- **`resolveCircle(x, z, r)`** pushes a circle out of every overlapping box,
  up to three relaxation passes, and returns the separation vector and the
  surface normal. Used by cars (two circles, front and rear) and by the player.
- **`raycast(x0, z0, x1, z1, minHeight)`** intersects the segment with box slabs
  and reports the first box entered, plus the face normal. Used for bullets,
  police wall avoidance and camera occlusion.
- **`rayDistance(...)`** returns the distance to the first obstacle, used to
  pull the camera in when a building is between it and the player.

Vehicle-versus-vehicle collisions are resolved separately in
`resolveVehiclePairs()`: overlapping cars are separated in proportion to their
inverse mass, and the closing speed is converted into an impulse with a
restitution of 0.18. Impacts over 4 m/s apply damage to both cars.

## Traffic lane following

The heart of the traffic AI is the lane projection. For the current edge
`from → to` with unit direction `d` and length `L`:

```
t      = clamp01(((pos - from) · d) / L)      // projection along the edge
lane   = from + d * L * t + right * LANE_OFFSET
target = lane + d * (9 + speed * 0.55)         // speed-scaled lookahead
```

`right` is `(-dz, dx)` — the lane is always on the right of the travel
direction, which is what makes the traffic right-hand.

The error between the car's heading and the direction to the target drives the
steering input. The sign convention matters and is easy to get wrong:

```
diff  = wrapAngle(desiredYaw - yaw)      // positive = target is to the left
steer = -diff * gain                     // positive steer = turn right
yaw  += -steer * rate * dt               // so positive steer decreases yaw
```

Because the camera-relative movement code and the vehicle code use the same
convention, a single sign error inverts the whole game.

## Third-person aiming

The crosshair must be truthful even though the camera is behind the player's
shoulder. The solution is a two-step ray:

1. Cast the camera's own forward ray and find where it crosses the chest
   plane (`y = 1.25`). That is the **aim point**.
2. Fire from the player's muzzle (`y = 1.32`) towards the aim point.

The aim point is found by casting the camera ray (started at the player, so the
camera boom cannot block it) through the real hitscan: whatever is under the
crosshair becomes the target, so parallax does not make shots miss. If nothing
is hit, a far point 250 m out is used.

The hitscan itself checks: building boxes (ray), pedestrians and officers
(vertical cylinders, radius 0.55 m, height 1.9 m), vehicles (the car's oriented
box, slab test in the car's frame, so a bullet stops at the bodywork instead of
the centre) and the ground plane. The height of the hit selects the damage zone
(head above 1.5 m, legs below 0.75 m).

## Tyre slip, weight transfer, damage

- **Inertia.** When the car turns, its velocity keeps its world direction; the new
  heading sees the difference as lateral slip, which the tyres then bleed off
  (`lateral *= exp(-grip dt)`). Grip itself falls once slip ratio
  (|lateral| / max(|forward|, 4)) passes 0.22, down to 55 %, and costs up to 18 % more
  under hard braking or acceleration. A fast full-lock turn therefore drifts; the
  handbrake drops grip to 2.4 and multiplies yaw rate by 1.7.
- **Body attitude** is a spring-damper (k 70, c 9), so the body dives, squats and rocks
  with overshoot instead of easing in.
- **Gears.** `Vehicle.gear` (1-5) and `rpm` come from speed across the range; the
  audio engine note uses `rpm`.
- **Damage.** `registerHit(dirX, dirZ, impact)` adds 0..1 dent to front/rear/left/right.
  `applyDents` moves the matching body vertices inward (wobble keyed on position, so
  shared vertices move together) and darkens the paint. Only the car's own cloned body
  geometry is touched. Cars under 30 % health smoke.

## Reflections and headlights

`Sky.updateEnvironment` renders the sky dome into a PMREM cube every 1/20 of a day and
assigns it only to the car paint, glass and wheel materials (`envMap`), so buildings
and roads keep their tuned look. At night the player's car has two spot lights
(`Game.updateBeams`); other cars rely on emissive headlights.

## Front-wheel steering

Wheels are rotated in `YXZ` order: spin about the axle first, then steer about
the vertical axis. (Three's default `XYZ` order tilts a steered wheel.) Positive
steer = turn right = yaw decreases, so the wheel's Y angle is the negative of the
steer angle. The steering lock shrinks with speed (0.62 rad parked, 0.24 rad at
top speed) and the inner wheel turns further than the outer one (Ackermann).

## Traffic spawning

Cars spawn 70–200 m from the player on a road, never inside the padded camera
view, never within 9 m of another vehicle. Cars are only recycled once farther
than 220 m *and* off-screen (or beyond 320 m). Together these remove the
"car appears from nowhere / blinks" glitch: popping in on screen and two
overlapping bodies z-fighting. `TrafficManager.popIns/popOuts` count violations
and are asserted by `debugTrafficSpawn`.

## Day/night cycle

The sky is a single inverted sphere with a custom shader. A keyframe table
(`Sky.KEYS`) maps the time of day to zenith colour, horizon colour, sun
colour, fog colour, sun intensity and ambient intensity; the values are
interpolated between the surrounding keys.

The sun direction follows an arc: `angle = (dayFraction - 0.25) * 2π`, giving
sunrise at 06:00 and sunset at 18:00. The night factor is derived from the sun's
height and drives:

- the emissive intensity of the building facades (lit windows after dark)
- the street lamp bulbs and the additive pools of light on the ground
- the headlight and tail-light emissive intensity
- the billboard emissive intensity

A full in-game day lasts **480 seconds** of real time.

Because three.js r155 uses physically based light units, the sun runs at
intensity ≈ 3.6 and the hemisphere light at ≈ 2.0. Values tuned for the legacy
lighting model look almost black.

## Procedural textures

All textures are drawn on a 2D canvas and uploaded as `CanvasTexture` with
`SRGBColorSpace`:

- **asphalt / road** — noise, aggregate speckle, cracks, plus painted edge and
  centre lines
- **sidewalk** — a 4×4 grid of concrete slabs with joints and stains
- **facades** — a 4×4 grid of window bays over a wall colour, with a shopfront
  ground floor; a second emissive canvas holds only the lit windows
- **lot surfaces** — concrete, gravel, grass and sand by district
- **water** — layered wave lines, scrolled every frame
- **billboards** — generated advertising art in four palettes

## Audio

`AudioSystem` creates the `AudioContext` lazily on the first user gesture
(so autoplay policies are respected) and synthesises everything:

- **Engine** — two oscillators (sawtooth + square sub) through a low-pass
  filter whose frequency tracks the revs, with a gain that follows the load.
- **Siren** — a sawtooth with a square LFO modulating its frequency.
- **Gunshots** — filtered noise bursts with a fast filter sweep.
- **Music** — a 16-step sequencer scheduled ahead of the audio clock: kick,
  hi-hat, bass and arpeggio at a 0.26 s step.

The music scheduler uses `setInterval` and is cleared on stop so it cannot
leak across a pause.

## Headless testing helpers

`Game.simulate(seconds)` runs the update loop deterministically and calls
`input.endStep()` after each step, which means one-shot input (a key press)
is consumed exactly once — the same guarantee the real frame loop provides.
Without that, a key press would be seen by every simulated step and the player
would enter and immediately exit a vehicle.

`Game.debugState` returns a JSON snapshot of the simulation plus counters for
what is actually attached to the scene graph (`renderedVehicles`,
`renderedPeds`). The smoke test compares those against the simulated counts,
which is how the "entities that simulate but never render" class of bug was
caught.

Vehicle pair contacts use the separating axis theorem over each body’s forward
and lateral axes. Minimum penetration determines the separation normal.
Coincident centres are separated along a body axis. Embedded building circles
are pushed to the nearest face plus their radius. Ray queries return the nearest
exact intersection, including thin walls and segment origins inside colliders.
