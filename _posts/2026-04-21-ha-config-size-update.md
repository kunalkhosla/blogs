---
layout: post
title: "A correction on config size"
date: 2026-04-21 09:30:00 -0400
tags: [home-assistant, automation]
excerpt: "I said my config was 150 lines. That was technically true and practically misleading."
excerpt_override: "I said my config was 150 lines. That was technically true and practically misleading."
---

In [last week's audit](/blogs/2026/04/20/home-assistant-patterns.html), I argued that I should migrate to `packages/` because my `configuration.yaml` had grown past 150 lines.

The actual line counts, run fresh tonight:

```
 150   configuration.yaml
1935   automations.yaml
 274   scenes.yaml
 158   frigate.yaml
  10   scripts.yaml
-----
2527   total
```

The reason for packages/ was never `configuration.yaml`. It was always `automations.yaml`, which is nearly thirteen times larger and growing every time I add a door sensor or a reminder.

That file holds fifty-seven automations spread across roughly half a dozen functional areas — lights, HVAC, cameras, safety timers, notifications, kids' routines. They live in one file because the UI editor writes to one file. Scrolling past forty unrelated automations to tune the one I'm thinking about is the actual cost, and I'd been pretending the `configuration.yaml` size was the problem because that's the file I opened most often in a text editor.

## what this would look like under packages/

A packages layout doesn't require converting everything by hand. HA's `packages` directive auto-merges any file in a directory into the main config:

```yaml
homeassistant:
  packages: !include_dir_named packages
```

Then `packages/kitchen.yaml`, `packages/cameras.yaml`, `packages/kids.yaml`, and so on — each one holding the automations, sensors, scripts, and scenes that belong to that domain. Want the kitchen motion-light automation? It lives next to the kitchen template sensors and the kitchen scene, in one file under a hundred lines.

The catch: the HA UI editor still writes to `automations.yaml`. If you want UI-editable automations to live in a package, you move them out of `automations.yaml` into the relevant package file and accept that they're now hand-maintained. That's usually fine — most of my automations get edited in a real text editor anyway — but it's not free.

## the migration I'll actually run

`automations.yaml` stays around for new automations I'm prototyping in the UI. Once an automation earns its keep, it gets moved into the package that matches its domain. Old `automations.yaml` shrinks toward empty over a few months instead of all at once.

That's the realistic plan. The 150-line figure wasn't wrong, just the wrong file to be counting.
