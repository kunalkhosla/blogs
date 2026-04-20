---
layout: post
title: "Three home networks, and the firewall rules that hold them together"
date: 2026-04-20 20:00:00 -0400
tags: [home-networking, unifi, home-assistant, vlans]
excerpt: "Why my smart house lives on its own Wi-Fi network, what the three-network split actually costs, and the seven firewall rules that keep it from breaking Home Assistant."
excerpt_override: "Why my smart house lives on its own Wi-Fi network, what the three-network split actually costs, and the seven firewall rules that keep it from breaking Home Assistant."
---

I have 193 tracked wireless devices. That's not a typo. Phones, laptops, two Chromecasts, three printers, a weather station, a pool-pump Wi-Fi box ([see earlier](/blogs/2026/04/20/ecoplug-pool-pump.html)), a garage-door controller, every single smart bulb, a few smart plugs that should probably be smart plugs but aren't, some cameras, a watering controller, a smart scale, a smart lock, a robot vacuum, and so on. Until 2023 they all lived on one flat LAN.

That was fine until it wasn't.

## Why split

Two reasons, in order of how much they bothered me.

**1. Trust asymmetry.** Most of the devices on a home network should not be trusted. That Wi-Fi candle from the Christmas box is running a five-year-old ARM firmware with a hard-coded telnet password and a DNS query for some server you've never heard of. My laptop and my bank's 2FA app live on the same physical switch it does. There's no compelling technical reason for the candle and the laptop to be able to ping each other, and if the candle ever gets rolled into a botnet, I'd prefer it couldn't ARP-scan my printer.

**2. Inventory hygiene.** It's almost impossible to keep mental track of which device is which on a flat network of 200 clients. The moment you separate "things humans interact with" from "infrastructure that quietly does its job," everything gets easier — finding a device, blocking a device, rebooting a rogue device, auditing what's talking to the internet at 3 AM.

## The three networks

After a weekend with UniFi's interface and about six broken integrations to reassemble, I landed on three WLANs, each on its own VLAN.

### Main

Humans. Phones, laptops, tablets, the Apple TV the kids use, my work MacBook. Small number of devices — maybe 20 — but these are the ones with actual trust. This LAN can reach the internet and it can reach certain things on the IoT LAN via explicit firewall rules (below). Nothing can reach *into* this LAN from outside it.

### IoT

Everything else in the house. Smart bulbs, plugs, cameras, thermostats, the pool pump, the garage doors, appliances, the robot vacuum, the weather station, the irrigation controller, and roughly 150 clients I forget I own. The rule I enforce: if it's Wi-Fi-connected and you don't actively touch it every day, it lives here. This VLAN is firewalled off from Main entirely by default — IoT devices cannot initiate connections into the Main LAN. They can reach the internet (some of them *must* — that's how the vendor apps work) but they can't spider the house.

### Guest

Captive portal. Anyone who visits connects, enters their name, and gets an internet-only connection that's walled off from both Main and IoT. No device discovery. No mDNS leakage. Each guest is client-isolated from the other guests too, so a friend's phone can't see my parents' laptop.

That's the shape. Main / IoT / Guest. All the complexity comes from the fact that these three networks *must occasionally talk to each other*.

## The part nobody warns you about

The moment you put Home Assistant on the Main VLAN and your plugs on the IoT VLAN, everything breaks.

- Your Chromecasts vanish from the laptop because mDNS doesn't cross VLAN boundaries.
- Your Home Assistant dashboard shows a switch that Home Assistant itself can no longer reach.
- SSDP / UPnP discovery stops working for the streaming devices.
- The printer disappears from everyone.

Segmentation is not a free lunch. You pay for it in packets that used to travel freely and now require explicit permission to cross a boundary. The UniFi interface calls these DPI-based policies "Traffic Rules" or "Firewall Rules" depending on the era of the UI you're looking at. They're `iptables` rules underneath.

## The rules I wrote

Seven of them, all documented in UniFi with useful names so future-me remembers:

1. **Allow Home Assistant → IoT** — Home Assistant's static IP on Main is permitted to open unicast connections to anything on IoT. This is the big one. HA can poll, push, and listen to my plugs and cameras and bulbs. Without this rule, the dashboard is a museum exhibit.

2. **Allow Home Assistant → IoT (cameras + media + mgmt)** — a richer version of the above for specific ports. NVR (RTSP), media server (DLNA / Plex), and management (SSH / HTTP admin). Separate from rule 1 because the ports are different and I wanted the audit trail split.

3. **Allow IoT → Home Assistant (device-triggered)** — the reverse path, scoped tight. Some integrations need the device to initiate (webhooks, MQTT push, multicast announcements). Without this, certain "instant" state updates become 30-second polls.

4. **Allow Chromecast (cross-VLAN)** — an mDNS / multicast relay so the Chromecasts on IoT still show up in the phone's Cast picker when the phone is on Main. UniFi's "mDNS reflector" does the heavy lifting; this rule permits the return traffic.

5. **Allow Home Assistant → Guest** — this one sounds wrong and it's worth explaining. Guests occasionally need to cast to the living-room TV. The TV is on IoT. mDNS is blocked across all three VLANs by default. This rule (plus an mDNS relay on the Guest network) bridges just enough multicast for the cast picker to work. No unicast, no device control.

6. **Grown-up devices** — a small DPI group and a rule that routes specific devices through a more permissive set of destinations. Mostly used for work devices that need to reach particular corporate VPN ranges that'd otherwise be blocked.

7. **Allow HA to Guest for notifications** — HA can push announcements to guest devices (like "the garage is open") if they've joined a specific integration. Rarely used. Exists for completeness.

Every rule is labelled with *why it exists*. Not what it does — the what is in the rule body. The why is in the label. Six months from now I won't remember the scenario; the label will.

## What I'd do differently

**Start with the three networks on day one**, not after two years of one flat LAN. Migrating 150+ devices across VLANs means re-pairing half of them, because the vendor app has cached the original subnet and the device refuses to rejoin. Start clean and the pain is frontloaded and smaller.

**Use UniFi's *Device Groups* feature instead of per-device firewall rules.** I spent too long writing one-off rules for specific IPs. A group-based approach ("cameras," "media servers," "kids-only") scales better once you're past about ten devices.

**Pick DHCP reservations over static IPs wherever possible.** Every integration docs page tells you to set the device to a static IP. Don't. Use DHCP reservations on the controller. If you ever renumber the subnet, it's one file to edit instead of forty.

**Use a shorter DHCP lease on the IoT VLAN.** Many IoT devices don't gracefully handle IP changes. A 1-hour lease means when a device misbehaves and you force a rejoin, its old lease is gone by the time it comes back. Default lease is 24h, which is purgatory.

## The bigger lesson

Network segmentation at home is mostly a documentation problem disguised as a networking problem. The actual VLAN setup takes an afternoon. What takes months is *remembering* which rule applies to what, which device you put on which network, and why the printer suddenly doesn't work two years later.

Name your WLANs something descriptive. Name your firewall rules better than the UI suggests. Write them down somewhere you'll actually look. Future-you will be grateful.
