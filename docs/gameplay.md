# Gameplay systems

## Player

The player is either on foot or driving. `Player` owns the character rig, the
movement controller and the vitals (health, armour, money).

**On foot**

- Movement is camera-relative: the input axes are rotated into world space by
  the camera yaw. Forward is the direction the camera *looks* (away from the
  camera), right is the camera's right.
- Walk 3.1 m/s, sprint (`Shift`) 6.6 m/s, jump (`Space`) 7.2 m/s impulse
  against 22 m/s² gravity.
- Collision is a 0.42 m circle resolved against the building boxes; the player
  slides along walls instead of sticking.

**Driving**

- `E` near an accessible, operable vehicle gets in. Below 6 m/s, `E` gets
  out through whichever side has room.
- Taking the wheel of a car in front of police adds one star of heat.
- The character rig is hidden while driving and re-anchored beside the car on
  exit.

**Character rig** — a detailed procedural low-poly humanoid built from boxes and cylinders:
hips, torso with open-collar tropical button-up shirt and V-neck undershirt inset, leather belt
with gold buckle, head with sculpted facial profile, aviator sunglasses with gold frames,
layered 80s hairstyle with sideburns, gold watch on the left wrist, sculpted hands, and retro
high-top sneakers with white outsoles. Attached to the right hand is a 3D procedural weapon
model matching the active loadout (semi-auto pistol with two-tone slide, micro SMG with barrel
shroud and magazine, or pump-action shotgun). Limbs are pivoted at the shoulder and hip
so the walk cycle swings them naturally.

## Vehicles

Six archetypes, each defined by a `CarSpec`:

| Spec | Length | Mass | Power | Top speed | Grip | Steering |
| --- | --- | --- | --- | --- | --- | --- |
| sedan | 4.50 | 1300 | 12.0 | 43 m/s | 11.0 | 1.75 |
| coupe | 4.35 | 1180 | 15.0 | 50 m/s | 11.5 | 1.95 |
| suv | 4.90 | 1750 | 10.5 | 38 m/s | 9.5 | 1.50 |
| van | 5.30 | 1900 | 8.5 | 34 m/s | 8.5 | 1.35 |
| pickup | 5.20 | 1650 | 9.5 | 36 m/s | 8.8 | 1.45 |
| sports | 4.30 | 1050 | 19.0 | 58 m/s | 12.5 | 2.05 |

All vehicles feature upgraded procedural 3D automotive models:
- **Body & Chassis**: Flared wheel arches, sloping aerodynamic hoods, front radiator grilles, lower front chin splitters, rear aerodynamic diffusers, dual chrome exhaust tips, aerodynamic side view mirrors, and raked front windshields/C-pillars.
- **Archetype Styling**: Elevated aerodynamic rear wing spoiler and hood vents for `sports`, performance ducktail lip and hood scoop for `coupe`, tubular roof rack rails and side steps for `suv`, open cargo bed with tailgate and dark bedliner for `pickup`.
- **Liveries**: Police cruisers include high-visibility red/blue roof strobe lightbars and heavy-duty front push-bar bullbars; taxis feature illuminated roof medallion signs and side checkerboard stripes.
- **Wheels**: Multi-spoke alloy wheels with rubber tread, metallic brake rotor discs, and red brake calipers that spin smoothly with vehicle physics.
- **Finish**: Automotive clearcoat enamel (`roughness: 0.26, metalness: 0.65`) and deep-tinted specular glass.

Police use the sedan with a black-and-white cruiser livery; the player's starter car is
a red coupe.

See [algorithms.md](algorithms.md) for the physics model.

## Traffic AI

`TrafficAI` drives a car along the road graph:

1. **Where am I going?** The AI holds an ordered pair of nodes (`from`, `to`).
   The lane centre is the projection of the car onto the edge between them,
   offset to the right by `LANE_OFFSET`.
2. **Look ahead.** The target is the lane centre plus `9 + speed * 0.55` metres
   of lookahead. When the car is within 24 m of the next node, the target
   blends into the *next* lane so it turns smoothly instead of cutting the
   corner.
3. **Steer.** The yaw error to the target is converted to a steering input
   (`-error * 1.35`) and damped over time (9/s) so cars do not saw between the
   wheels.
4. **Speed.** The target speed is 17 m/s, dropping to 7 or 4 m/s in tight
   turns. It is further reduced by the traffic light, by a vehicle ahead, and
   by the need to slow for a corner.
5. **Traffic lights.** Cars measure the gap from the front bumper to the
   painted stop line. They slow to a stop on red and stop on amber when
   there is enough room to brake.
6. **Car following.** Any vehicle within 25 m ahead, within 2.8 m laterally and
   heading roughly the same way reduces the target speed to
   `(gap - 5.5) * 1.1`.
7. **Unstick.** A car that cannot move for 2.4 s holds one steering direction
   while reversing for 0.9 s. Route choices use a seeded per-car generator
   and favor continuing straight.

Cars spawn **in the correct lane, pointing down the road**, on a random edge
mid-block. Spawning them on the centre line with a random heading was the
original bug: every car immediately fought the lane logic with full steering
lock and ended up circling or stuck.

## Pedestrians

Civilians walk the **sidewalk loop of their block** — a rectangle inset by half
the pavement width — and walk around it in one direction until something
distracts them. They flee (and leave the loop) when:

- a gun is fired within 26 m
- the player's car or the horn comes close
- any vehicle approaches dangerously close at speed (> 4.0 m/s within 3.8 m)

A pedestrian hit by a car at over 3 m/s is knocked down and dies; if the
driver was the player, that is a crime (heat). If an AI driver hit them, it is
not — only the player's actions feed the wanted system.

Pedestrians are built with varied hairstyles (crop, 80s volume pompadour, afro curls, baseball caps),
diverse realistic skin tones, vibrant outfits, retro sneakers with white outsoles, and
aviator sunglasses. Population is topped up around the player (26 pedestrians) and pedestrians
further than 190 m away are recycled.

## Police

Two kinds of officer:

**Cruisers** — spawned when the wanted level is higher than the number of
units on the map, in clear travel lanes 32–82 m away. Featuring procedural black-and-white cruiser
liveries with red and blue strobe lightbars and heavy-duty front bullbars. `PoliceAI` chases the player
directly, predicting their position from their velocity, with wall avoidance:
a short raycast ahead detects a building and biases the steering toward the open
side. A cruiser that gets stuck reverses and re-aims.

**Officers on foot** (`FootCop.ts`) — from two stars. They spawn 26–48 m away,
walk toward the player, stop at about 11 m, raise their sidearm and fire every
1.1–1.9 s. Upgraded with tactical dark-navy body armor vests featuring reflective white "POLICE"
patches front and back, gold badges, shoulder communication radios, full tactical utility duty belts,
service peaked caps with gold crests, aviator sunglasses, heavy tactical combat boots, and detailed
service sidearms. Buildings block officer shots and arrests. Officers spawn in clear positions,
resolve wall collisions when strafing, and contribute to police visibility.
The hit chance falls with distance (50 % at point blank down to
about 24 % at 26 m). If an officer gets within 2.6 m of an on-foot player, the
player is busted. They can be engaged in combat with weapons or run over with
vehicles, and drop bounties when eliminated. There is a 3.5 s grace period
after the heat rises so you always get a chance to run.

## Combat

Four weapons, all hitscan:

| Weapon | Damage | RPM | Range | Magazine | Automatic |
| --- | --- | --- | --- | --- | --- |
| Unarmed | 6 | 120 | 2.2 m | – | no |
| Pistol | 26 | 320 | 90 m | 12 | no |
| Micro SMG | 17 | 780 | 70 m | 30 | yes |
| Pump shotgun | 13 × 8 | 75 | 34 m | 6 | no |

Aiming (`right mouse`) moves the camera to an over-the-shoulder position and
points the player where the camera looks. Shooting uses the camera ray to pick
an aim point on the chest plane, then fires from the player's muzzle towards
that point, so the crosshair is truthful in third person.

The pistol and shotgun fire once per press. The SMG keeps firing while held.
The player starts with a pistol and 48 rounds in reserve. Weapon pickups are
scattered around the city.

## Wanted system

`Wanted` holds a fractional **heat** value; the star level is `floor(heat)`
capped at 5. Escalation is calibrated for progressive intensity:

| Event | Heat |
| --- | --- |
| Firing a weapon in public | 0.05 (SMG) – 0.20 (shotgun); pistol 0.14, unarmed 0.02 |
| Hitting a civilian pedestrian | +0.25 |
| Killing a pedestrian | +0.80 |
| Running a pedestrian over (player only) | +0.35 / +0.70 |
| Shooting a police car | +0.45 |
| Colliding with a police car | +0.28 |
| Stealing a car in front of police | +0.80 |

Heat decays at 0.45/s once the police have lost sight of the player for 4.5 s.
Raising the level starts a 1.2 s dispatch delay and a 3.5 s grace period
before officers can bust you.

## Missions

`MissionSystem` runs a state machine over a list of missions. Each mission is
a list of steps; each step has a kind, an objective string, an optional marker
position, an optional time limit and completion rules.

| Mission | Reward | Steps |
| --- | --- | --- |
| Welcome to Neon Coast | $750 | Walk to the plaza marker → take any car |
| Grand Theft Auto | $2 500 | Steal the marked sports car → deliver it to the garage (150 s) |
| Special Delivery | $1 800 | Collect the package on foot → deliver it (120 s) |
| Heat | $5 000 | Lose the police (the level is forced to two stars) |
| Clean Sweep | $3 500 | Destroy three marked vehicles |
| Courier Run | $1 200 | Collect → deliver (150 s) — repeats forever |

Step kinds: `goto`, `steal`, `deliver`, `collect`, `escape`, `destroy`. Steps
can require the player to be on foot or driving, and can carry a time limit.

The active mission drives the HUD banner, the radar blip and the rotating
marker cylinder in the world.

## Economy

- Missions pay their reward on completion.
- Killed pedestrians drop a cash pile that is collected by walking or driving
  over it.
- Health, armour and weapon pickups are scattered around the city.
- Respawning after a WASTED costs up to $500.

Vehicle contacts use oriented body rectangles. Pedestrian impacts use circle-to-body
intersection, so passing beside a car with sufficient clearance is safe.
