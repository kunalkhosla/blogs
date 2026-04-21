---
layout: post
title: "When the router dies, the house reboots it"
date: 2026-04-21 09:00:00 -0400
tags: [home-assistant, automation, networking]
excerpt: "A twenty-line automation replaced every 'have you tried turning it off and on again' conversation in my house."
excerpt_override: "A twenty-line automation replaced every 'have you tried turning it off and on again' conversation in my house."
---

The Optimum router in the basement has a habit. Every couple of weeks — no pattern, no warning — the WAN light goes amber, the 5 GHz band gets stuck, and every video call in the house dies at once. The fix is always the same: power-cycle the router. Thirty seconds off, ninety seconds on, you're back.

For about a year I was the fix. Someone would text me, I'd walk downstairs, pull the plug, count, plug it back in. It happened enough times that I got fast at it. It never happened enough that I fixed it properly.

## the ingredients

Two pieces of hardware, no custom code:

- A **smart plug** the router is plugged into. Any HA-controllable switch works; I happen to use one flashed with ESPHome so it's local-only.
- A **ping sensor** for `8.8.8.8`. Configured via HA's built-in Ping integration — no YAML needed, just Settings → Devices & Services → Add Integration → Ping.

That gives me `binary_sensor.8_8_8_8`: `on` when the public internet is reachable, `off` when it isn't.

## v1: too twitchy

My first automation was three lines of logic: if the ping sensor is `off` for thirty seconds, turn the switch off, wait ten seconds, turn it back on.

It worked. Too well. The problem wasn't what you'd guess — Google didn't go down. What happens is that the ping sensor itself drops a packet, or the HA host's own network hiccups for a second, and the sensor flips `off` for forty seconds before it recovers. At which point I'd be on a call and the power to the router would drop, unnecessarily.

A single thirty-second threshold can't distinguish "WAN is genuinely dead" from "a single packet got lost." You need to ask the question more than once.

## v2: patient

```yaml
alias: Restart Optimum Switch if Internet is down
description: Restart switch only after 5 failed pings over 2.5 minutes
triggers:
  - trigger: state
    entity_id: binary_sensor.8_8_8_8
    to: ['off', 'unavailable', 'unknown']
actions:
  - repeat:
      count: 12
      sequence:
        - delay: "00:00:05"
        - condition: state
          entity_id: binary_sensor.8_8_8_8
          state: ['off', 'unavailable', 'unknown']
  - action: switch.turn_off
    target: { entity_id: switch.optimum_plug }
  - delay: "00:00:10"
  - action: switch.turn_on
    target: { entity_id: switch.optimum_plug }
  - delay: "00:10:00"
  - action: notify.mobile_app_pixel_8_pro
    data:
      title: Restarted Optimum Router
      message: Internet was down for 2.5 minutes. Switch was restarted.
```

The trick is the `repeat` with a `condition: state` check inside it. If the condition ever fails — that is, if the ping sensor flips back to `on` at any point during the sixty seconds of re-checks — the repeat exits early and skips the whole power-cycle. Only if `8.8.8.8` is consistently unreachable for the entire window does the switch actually cut power.

The ten-minute delay after the power-cycle is a cooldown: without it, the automation would immediately re-trigger during the reboot (since the ping sensor goes `off` again while the router is still coming back up).

## what fires it in practice

A handful of times in the past few months. Each one matched a real outage, not a transient. The phone notification is the first I hear about it — by the time I'd have noticed manually, the house is already back online.

The failure mode I was worried about — false positives cutting the router during normal operation — hasn't happened once since the rewrite.

## the general shape

This pattern — "re-check the trigger condition inside a `repeat` loop before committing to an irreversible action" — is good for anything where a false positive is expensive. Power-cycling the router is mild. Power-cycling a freezer or an outdoor pump on a bad signal is not. Same debounce, different stakes.

Three pieces: a sensor that might lie, a repeat that keeps asking, an action you only want to take if the sensor is still telling you the same story a minute later.
