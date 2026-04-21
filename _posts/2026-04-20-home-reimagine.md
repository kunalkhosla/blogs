---
layout: post
title: "Honey, what if we painted it all black"
date: 2026-04-20 21:30:00 -0400
tags: [ai, home, nextjs, gemini, side-project]
excerpt: "How one evening, Gemini 2.5 Flash Image, Next.js, and a Hostinger VPS became a private reimagining studio for exactly one address."
excerpt_override: "How one evening, Gemini 2.5 Flash Image, Next.js, and a Hostinger VPS became a private reimagining studio for exactly one address."
---

We've lived in our house for a few years and have a running list of "what if we changed the…" arguments that never quite resolve. Repaint the whole thing black? Swap the shingles for standing-seam metal? Gut the landscaping? Every one of those ideas dies somewhere between the conversation and Google Images, because none of those renders are of *our* house.

So I built a tool that *is* of our house. One address, a few pre-uploaded angles, a prompt box, and three photorealistic variations per tap. About an hour of work, most of it spent on the loop polish rather than the model call. I'm keeping the URL off this post — it's a single-address tool for one household and there's no reason to put up a public sign.

## What it does

1. You open it. A pre-loaded library of seven photos of the house (front, back, side, a few drone shots) is sitting there as thumbnails.
2. You tap one. You type what you want — _"modern farmhouse, board-and-batten, black standing-seam roof"_, or _"French country with blue shutters and a fountain in the driveway"_.
3. It generates **three photorealistic variations** in parallel.
4. You pick the one closest to what you want. It opens in a big hero view with a thumbnail strip for comparison and an **⇄ Compare with original** toggle that splits the image so you can see side-by-side what changed.
5. From there you can **tweak**: _"change the roof to warm terracotta"_, _"add copper gutters"_, _"remove the mailbox"_. Every edit stacks on the previous render, with a history strip of thumbnails to jump back to any point.
6. When you like it, you **share** — a button creates a short URL like `reimagine…/s/Ab3xR7_k2g-z` with proper Open Graph metadata so WhatsApp renders a preview card instead of a cold link. You and your spouse argue about roof color via that URL instead of via screenshots.

That's the whole thing. No accounts, no pricing page, no feature gate.

## The stack

- **Google's Gemini 2.5 Flash Image** (codename _Nano Banana_) does the actual reimagining. Image in, text prompt in, image out. Very fast, surprisingly good at "keep the house, change the skin" style edits when you constrain it properly.
- **Next.js 15 (App Router)** + Tailwind for the UI. Server API routes hide the Gemini API key from the client.
- **Docker** multi-stage build with Next's `output: "standalone"` for a small runtime image.
- **GitHub Actions** builds the image on push to `main` and pushes to GHCR.
- **Hostinger VPS** runs the container behind an existing **Traefik** reverse proxy. Deployment is `docker compose pull && docker compose up -d`.
- **IndexedDB** on the client persists an in-progress session (source photo, variations, refinement history) so a refresh doesn't lose the state of what you're working on.

Total external dependencies I wrote: zero. It's stdlib-Next.js + one Google SDK + a 200-line React page.

## Three small choices that mattered more than they sound

### 1. Pre-load the photos

The first version of this tool asked the user to upload a photo each time. That was fine for a one-off. For "my wife and I argue about paint color over a weekend", the repeated upload was the biggest friction. Solution: a volume-mounted directory on the VPS with every angle of the house we care about. The app lists the filenames as thumbnails. Seven taps away from seven generations.

The photos never touch the git repo — they're bind-mounted at container runtime. That lets me keep the source public while the actual address imagery stays on the box.

```yaml
services:
  home-reimagine:
    volumes:
      - ./photos:/app/photos:ro
      - ./shares:/app/data/shares:rw
```

### 2. Staple a structural constraint onto every prompt

Nano Banana is happy to _"reimagine"_ anything, including turning a two-story colonial into a mid-century ranch. We didn't want ranch. We wanted *our* house, painted differently. So every prompt gets prefixed server-side with a hard constraint:

> **DO NOT CHANGE THE STRUCTURE OF THE HOUSE:** footprint, roofline shape, window and door locations, number and placement of stories, chimneys, dormers, porches, garage, and structural proportions stay exactly as they are. Only surface-level elements may change: cladding, colors, roof material, window frame color, door color, trim, lighting fixtures, landscaping, driveway surface.

Before: variations were creative but often unrecognizable as my house. After: they're my house with different paint, different roof, different plantings. Every time. The single biggest quality improvement in the whole build, and it was one paragraph of prompt.

### 3. Share *links*, not *images*

The first share button used the Web Share API with the image file attached. Fine on iOS, nice on Android, but WhatsApp attaching a file takes up a chat slot and doesn't compose well with "what do you think of this?". What you actually want is a _link with a preview card_.

So I added a server-side share store — each generated image gets written to `/app/data/shares/<id>.png` with an optional JSON sidecar for the label. The share page at `/s/<id>` is a tiny server-rendered viewer with full Open Graph metadata:

```html
<meta property="og:title"       content="A Home Reimagining">
<meta property="og:description" content='"Modern farmhouse, black metal roof…"'>
<meta property="og:image"       content="https://…/api/shares/Ab3xR7_k2g-z">
<meta property="og:image:type"  content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:url"         content="https://…/s/Ab3xR7_k2g-z">
```

Paste the URL in WhatsApp and it shows the image inline. Paste it in iMessage, it shows the image inline. Paste it in a text to anyone — same thing. That's the whole point of OG.

The wire cost of sharing dropped from "download, wait, find file, attach, wait, send" to "tap Share link, paste". Which means it actually gets used.

## Working loop, not demo

Most AI-generated-image demos are impressive one-shots: _look what I prompted!_. That's not useful for decisions. Decisions need _loop_: generate, react, tweak, compare, backtrack, commit. The refine step is where the tool earns its keep — each edit builds on the previous render, with a thumbnail strip to revisit any earlier state.

The whole UI is optimized for the fact that you'll run ten rounds before landing on a direction:

- Big hero image so the details are legible.
- Compare-with-original always one tap away.
- History strip of prior refinements so you can ditch a bad turn and restart from wherever.
- Session persisted to IndexedDB so an accidental refresh doesn't nuke twenty minutes of decisions.

The model gets used as a collaborator, not a slot machine.

## What this isn't

- **Not a product.** There's no login, no multi-tenant anything, no pricing. It's literally one Traefik routing rule to one container for one address.
- **Not a Google Images killer.** It's a house-picture-with-a-prompt app. Deliberately narrow.
- **Not always right.** Nano Banana occasionally hallucinates a door that wasn't there, or moves a window. The structural constraint catches most of it; some slip through. You tweak or regenerate.

What it _is_ is an example of how cheap it's become to build a specific tool for a specific problem. The entire setup — Next.js scaffolding, Gemini API calls, Docker + Traefik + GHCR deploy, share-link subsystem, structured-prompt tuning, iterative refinement loop, IndexedDB persistence, WhatsApp-ready OG metadata — took one evening. Five years ago this would have been a company.

Now it's a git repo I share with my wife.
