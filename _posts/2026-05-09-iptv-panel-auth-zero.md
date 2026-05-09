---
layout: post
title: "The IPTV panel that won't say no out loud"
date: 2026-05-09 18:00:00 -0400
tags: [iptv, debugging, http, caching]
excerpt: "An upstream that returns 200 OK with a 'sorry, busy' body, and the three layers of code I wrote that all assumed the body was the data they asked for."
excerpt_override: "An upstream that returns 200 OK with a 'sorry, busy' body, and the three layers of code I wrote that all assumed the body was the data they asked for."
---

I pay an IPTV reseller about a hundred dollars a year for access to several thousand live channels and a backlog of movies. The streams themselves are fine. The Android app the reseller ships, the web portal, the M3U-via-VLC workflow — all wretched. So a few months ago I [built my own UI](https://github.com/kunalkhosla/iptv-webui): a small Express server in front of the panel's JSON API, a vanilla-JS frontend, hls.js for browser playback, an ffmpeg transcoder for the channels that still send MPEG-2 in 2026.

It's been quietly running on a small Hostinger VPS, fronted by Traefik with a Let's Encrypt cert, for months.

Last weekend I deployed a small CSS fix and the whole thing fell over.

## the symptom

The grid was empty. Every category I clicked: "Empty category." A toast at the bottom of the page kept reappearing every few seconds: `m.categories.map is not a function`. The `/api/bootstrap` endpoint returned 200 with what looked like real JSON, but instead of a list of channels, every category in the response was this:

```json
{ "user_info": { "auth": 0 } }
```

Just that. No `auth: 1`, no `username`, no `max_connections`, no `exp_date`. Not as an HTTP error — as the body of an HTTP 200.

The Android app the reseller ships, on the same network, was fine.

## the panel's vocabulary

Xtream Codes is a panel that thousands of IPTV resellers run. It exposes everything through one endpoint, `player_api.php`, and the contract is loose enough to be charitable. A successful call returns the resource you asked for. A *failed* call returns `{user_info: {auth: 0}}`. Same status code (200), same content type, same shape — *almost* — except it's an object instead of the array you were expecting.

There are at least three things that get you `auth: 0`:

1. Wrong username or password. (Permanent — fix the credentials.)
2. Account suspended or expired. (Semi-permanent — call the reseller.)
3. Your subscription has reached `max_connections` and the panel doesn't feel like negotiating right now. (Transient — minutes.)

My account's `max_connections` is **1**. (More cost more.) That third case happens any time a stream is being pulled — by my browser, by my Android phone, by a tab I forgot to close last week, by an ffmpeg transcoder my server spawned and didn't quite finish reaping. The panel's reply, with no extra detail, is identical to "your password is wrong."

## the three layers that broke

When I pushed the CSS fix, the GitHub Actions workflow built a Docker image and asked Hostinger to recreate the container. The new container started fresh: empty in-memory cache, a freshly-spawned indexer, freshly-issued credentials in the URL. All of that fired against the panel as fast as Node could load it.

The panel had a slot held by some other client of mine. So:

**Layer 1: the per-category handler, dying on a `.map()`.**

The streams handler looked, more or less, like this:

```js
app.get("/api/:mode(live|movie|series)/streams", async (req, res, next) => {
  const v = await xtream(m.list, params);
  res.json(v.map(s => projectStream(mode, s)));
});
```

When `v` is `{user_info: {auth: 0}}` instead of an array, `.map` doesn't exist, and the response is HTTP 500 with `{"error":"v.map is not a function"}`. Hence the every-few-seconds toast in the browser.

**Layer 2: the in-memory cache, storing the lie for 24 hours.**

This was the funnier one. My `xtream()` helper caches every successful upstream response for `TTL_MS = 24 hours`. "Successful" was defined as "the panel returned 200." Which it did. So the auth-rejection *body* got cached. Even after the panel slot freed up — even after I hit refresh, even after I fixed Layer 1 — every call still returned the cached auth-rejection from the moment of the cold start. For 24 hours.

I figured this out staring at production logs while the panel itself, hit directly with `curl`, was returning `auth: 1` happily. The container was lying to me on its own.

**Layer 3: the frontend, blindly assigning a non-array to `categories`.**

```js
state.modes.live.categories = d.categories.live || [];
```

The `|| []` defends against `null` and `undefined`. It does not defend against `{user_info: {auth: 0}}`, which is truthy. Later code did `m.categories.map(...)` and the bottom-of-page error banner read: *"Cannot reach provider. m.categories.map is not a function. Check IPTV_HOST on the VPS and that the panel is online."* — a misleading enough message that I almost spent an hour SSHing into the VPS to confirm the host was, in fact, online.

## the fixes, in order

The clean version, after I'd untangled it, is three small edits.

**1. Don't cache auth-rejection bodies.**

```js
const v = await res.json();
const isAuthReject =
  !Array.isArray(v) && v && v.user_info && Number(v.user_info.auth) === 0;
if (!isAuthReject) cache.set(key, { t: Date.now(), v });
return v;
```

Six lines that turn a 24-hour outage into "retry on the next request." I considered shortening the TTL across the board, but that would hurt the much more common case (panel responds, response is a real array, cache for an hour saves dozens of upstream calls).

**2. Serve from the in-memory index when ready, instead of always hitting the panel.**

The streams handler was naively calling the panel for *every* per-category click, even when I had a complete on-disk index that already knew which streams belong to which category. Switching to use the index first means user-driven category browsing doesn't compete for the panel slot at all:

```js
app.get("/api/:mode(live|movie|series)/streams", (req, res) => {
  const ix = indexes[req.params.mode];
  if (ix.ready && ix.byId.size > 0) {
    const all = [...ix.byId.values()];
    return res.json(catId ? all.filter(s => s.category_id === catId) : all);
  }
  // fall back to the panel only if the index isn't built yet
});
```

This is the change with the biggest user-visible effect. After the deploy, browsing categories no longer touches the panel.

**3. Persist categories to disk, fall back when the panel is unhappy.**

The bootstrap call still needs `get_live_categories` and friends, which the in-memory streams index doesn't replace. So now when those calls succeed, the response is also written to `data/categories-{mode}.json`. When they return `{auth: 0}`, the bootstrap loads the disk cache instead and the sidebar still populates. The user sees an accurate banner — *"Panel busy. Likely your subscription's connection limit is saturated."* — instead of being misled about credentials.

## the general thing

Every upstream that overloads the success channel for "I can't help you right now, try later" is a future bug. HTTP gives you *both* status codes and bodies for a reason; an upstream that signals failure inside the body has effectively halved your error-handling toolkit. You can't `if (!res.ok) throw` your way out — you have to inspect the shape every time.

The defensible posture is: parse upstream responses as untrusted data even when the upstream is *yours*. Validate the shape (`Array.isArray`? Has the field you actually need?). Refuse to cache responses that fail that validation. And make sure the user-facing error message can distinguish between *"actually broken"* and *"transiently busy"* — because the day it can't, you're the one staring at logs telling you everything is fine while the UI insists it isn't.

The IPTV panel will, eventually, return a real array again. Until then, the UI shows the cached library and a banner explaining why the live data is stale. Which is what it should have done from the start.
