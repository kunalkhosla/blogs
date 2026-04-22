---
layout: post
title: "I renamed every automation in my house and found four bugs"
date: 2026-04-22 09:00:00 -0400
tags: [home-assistant, automation, smart-home]
excerpt: "Four years of ad-hoc alias choices, fifty-six automations, one sitting to rename them all — and four real bugs I'd assumed were working fine."
excerpt_override: "Four years of ad-hoc alias choices, fifty-six automations, one sitting to rename them all — and four real bugs I'd assumed were working fine."
---

My Home Assistant automations list had grown to 56 entries over four years, each one created in a different mood by the person I was that week. Some started with verbs (`Turn off iron after 30 mins`), some with subjects (`Family Room Block Button`), some with vendor names (`Reolink driveway person/animal/vehicle notification`), one with all-caps for no reason (`OFF - Driveway Retaining Wall - 10 PM`). When I wanted to find the motion-lights automation for the kitchen, I had to scroll past every automation whose name started with "Turn" before I got there.

I renamed all of them in one sitting. Here's what I landed on and why.

## the convention

Every automation now looks like this:

```
[Area] Subject — qualifier
```

Three examples from mine:

```
[Kitchen] Lights on with motion — after sunset
[Pool] Cover pump off — below 35°F
[Side Yard] Camera — motion describe + notify
```

- `[Area]` is square-bracketed so it reads as a tag and not as part of an English sentence.
- The subject is whatever the thing *is* — `Lights`, `Camera`, `Iron`, `Cover pump`. No verb.
- The qualifier (after the em-dash) is the narrowing condition — the trigger, the threshold, the time of day.

This beat every other format I considered because of how the HA automations list is sorted: alphabetically, with no grouping. Area-first means everything in the kitchen clusters together; subject-second means I can find "Lights" within an area by eye rather than by search. The qualifier at the end is scannable because the em-dash gives it a visual handle.

The format I *didn't* use was verb-first (`Turn on kitchen lights...`). It reads nicely as an English sentence, and it's the default when you're writing an automation from scratch. But every single verb-first automation I had started with the word "Turn" — which is exactly the column where I needed variation to find things.

## the second dimension: labels

HA has a label system that most people seem to ignore. Labels are orthogonal to areas: each label is a tag that can apply across rooms, and an automation can have multiple labels.

I created eleven:

```
lights     cameras    ai         safety     security
presence   climate    kids       schedule   infra
notifications
```

Every automation got one to three labels. A motion-triggered light in the kitchen gets `lights` + `presence`. The pool cover pump freeze-protector gets `safety` + `climate`. The router auto-restart gets `infra`.

The payoff isn't the labels themselves — it's that I can now ask the list "show me everything labeled `safety`" and get back ten automations that protect the house in some way, across kitchen, bath, deck, pool, and outdoor zones. Before, those ten were scattered across my "Turn", "Close", and "OFF -" piles.

The eleven labels are a deliberately small vocabulary. I resisted the urge to create `lighting-bedroom` and `lighting-outdoor`; the area already tells you that. I skipped anything that reads like a *workflow* tag — `daily`, `weekly`, `one-off` — because `schedule` does the job.

## what I found during the rename

The rename pass doubled as an audit. Things I hadn't noticed until I read every automation in order:

- **A duplicate.** Two different automations both named *"Restart Optimum Switch if Internet is down"*. One was a three-line version I'd written eagerly late at night; the other was a properly debounced version I'd written six months later after the first one misfired. I'd never deleted the first one. They were both firing.

- **A typo.** *"Reolink frontyard person/animal/vehicle **notifcation**"* — spelled wrong. Two years in the list. Nobody noticed (least of all me).

- **A copy-paste bug.** The gravel-garden motion notification had a second notify block (for a phone I rarely use) that referenced the *sideyard* image and title — because I'd duplicated the sideyard automation to start the gravel-garden one. The block was disabled, but had it ever been enabled, every gravel-garden alert on that phone would have shown the wrong camera.

- **A stub.** An automation called "New automation" from four months ago, one I'd started and abandoned. It was still wired up, referencing a deleted AI-task entity, quietly erroring at 7 AM every morning.

None of these were findable by reading the file randomly. All of them fell out of a sequential pass.

## the tooling part

I did the rename in a script, not by clicking through the UI. A hundred UI clicks is a hundred opportunities to misread my own new convention. The script read `automations.yaml`, applied a dict of `{old_id: new_alias}`, wrote it back, reloaded.

HA automations carry a stable `id` field that's separate from the alias, which makes this safe: renaming the alias doesn't change the entity ID, which means no dashboards or other automations that reference `automation.my_old_name` break as a side effect.

Labels and areas were done separately via the WebSocket API (`config/entity_registry/update`), because those live in the entity registry, not in `automations.yaml`.

## // the general thing

A naming convention isn't really about the names. It's a forcing function for reading everything you've built in one sitting. The format you land on matters less than the fact that you have to open every automation to apply it. I found four real bugs doing this — in code that was, by my estimation, *"working fine."*

Block out a few hours. Pick any convention that reads cleanly in *your* automations list, not someone else's. The part that pays back isn't the alphabetical clustering — it's the audit you do on the way there.
