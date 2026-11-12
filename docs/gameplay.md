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

- `E` near a vehicle gets in, `E` while below 6 m/s gets out.
- Taking the wheel of a car in front of police adds one star of heat.
- The character rig is hidden while driving and re-anchored beside the car on
  exit.

**Character rig** — a low-poly humanoid built from boxes: hips, torso, head,
hair, two arms, two legs, two shoes. Limbs are pivoted at the shoulder and hip
so the walk cycle can swing them. The leg pivots sit at hip height (0.88 m) so
the legs reach the ground instead of sinking through it.

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

Police use the sedan with a black-and-white livery; the player's starter car is
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
5. **Traffic lights.** If the light for the car's axis is red and the stop
   distance is under 16 m, the target speed becomes `stopDistance * 0.75`.
6. **Car following.** Any vehicle within 25 m ahead, within 2.8 m laterally and
   heading roughly the same way reduces the target speed to
   `(gap - 5.5) * 1.1`.
7. **Unstick.** A car that cannot move for 2.4 s reverses with opposite lock.

Cars spawn **in the correct lane, pointing down the road**, on a random edge
mid-block. Spawning them on the centre line with a random heading was the
original bug: every car immediately fought the lane logic with full steering
lock and ended up circling or stuck.

## Pedestrians

Civilians walk the **sidewalk loop of their block** — a rectangle inset by half
the pavement width — and walk around it in one direction until something
distracts them. They flee (and leave the loop) when:

- the player is within 14 m
- a gun is fired within 26 m
- the player's car or the horn comes close

A pedestrian hit by a car at over 3 m/s is knocked down and dies; if the
driver was the player, that is a crime (heat). If an AI driver hit them, it is
not — only the player's actions feed the wanted system.

Population is topped up around the player (26 pedestrians) and pedestrians
further than 190 m away are recycled.

## Police

Two kinds of officer:

**Cruisers** — spawned when the wanted level is higher than the number of
units on the map, 32–62 m away. `PoliceAI` chases the player directly,
predicting their position from their velocity, with wall avoidance: a short
raycast ahead detects a building and biases the steering toward the open side.
A cruiser that gets stuck reverses and re-aims.

**Officers on foot** (`FootCop.ts`) — from two stars. They spawn 26–48 m away,
walk toward the player, stop at about 11 m, raise their sidearm and fire every
1.1–1.9 s. The hit chance falls with distance (50 % at point blank down to
about 24 % at 26 m). If an officer gets within 2.6 m of an on-foot player, the
player is busted. There is a 3.5 s grace period after the heat rises so you
always get a chance to run.

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

The player starts with a pistol and 48 rounds in reserve. Weapon pickups are
scattered around the city.

## Wanted system

`Wanted` holds a fractional **heat** value; the star level is `floor(heat)`
capped at 5.

| Event | Heat |
| --- | --- |
| Firing a weapon | 0.3 (SMG) – 0.6 (shotgun); pistol 0.45, unarmed 0.35 |
| Hitting a pedestrian | +0.3 |
| Killing a pedestrian | +1.1 |
| Running a pedestrian over (player only) | +0.45 / +0.8 |
| Shooting a police car | +0.8 |
| Colliding with a police car | +0.5 |
| Stealing a car in front of police | +1.0 |

Heat decays at 0.32/s once the police have lost sight of the player for 9 s.
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
