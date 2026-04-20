---
layout: post
title: "Three VLANs, one household: how my home network is actually laid out"
date: 2026-04-20 20:00:00 -0400
tags: [home-networking, unifi, home-assistant, vlans]
excerpt: "Why my smart house lives on its own VLAN, what the three-network split actually costs, and the firewall rules that keep it from breaking Home Assistant."
excerpt_override: "Why my smart house lives on its own VLAN, what the three-network split actually costs, and the firewall rules that keep it from breaking Home Assistant."
---

My UniFi controller currently shows the map below. Three VLANs, each with its own subnet, its own SSID, and its own opinions about what's allowed to talk to what.

| VLAN | ID | Subnet           | Active leases | What lives here |
|------|----|------------------|---------------|-----------------|
| IoT     | 1 | `192.168.10.0/24` | 67  | Everything Wi-Fi-connected that you don't touch daily |
| Guest   | 2 | `192.168.20.0/24` | 3   | Visitors — captive portal, internet-only |
| Primary | 3 | `192.168.30.0/24` | 18  | Humans — phones, laptops, tablets |

88 active leases right now, and Home Assistant has tracked 193 distinct MAC addresses across them over time. The ratio of "things in the house that are on the internet" to "humans in the house" is roughly 4-to-1 and climbing.

## Why three VLANs

Two reasons, in order of how much they bothered me.

**1. Trust asymmetry.** Most of the devices on a home network should not be trusted. That Wi-Fi candle from the Christmas box is running a five-year-old ARM firmware with a hard-coded telnet password and a DNS query for some server you've never heard of. My laptop and my bank's 2FA app used to live on the same flat LAN that it did. There's no compelling technical reason for the candle and the laptop to be able to ping each other, and if the candle ever joins a botnet, I'd prefer it couldn't ARP-scan my printer.

**2. Inventory hygiene.** It's almost impossible to keep mental track of which device is which on a flat network of 200 clients. Separating "things humans interact with" from "infrastructure that quietly does its job" makes everything easier — finding a device, blocking a device, rebooting a rogue device, auditing what's phoning home at 3 AM.

## The three VLANs

### IoT (VLAN 1, `192.168.10.0/24`)

The heaviest VLAN by a wide margin — 67 active leases today. Smart bulbs, plugs, cameras, thermostats, the pool pump from [last week's dispatch](/blogs/2026/04/20/ecoplug-pool-pump.html), the garage-door controllers, every appliance that ships with a Wi-Fi chip, the robot vacuum, the weather station, the irrigation controller.

**Home Assistant itself lives here.** HAOS has a DHCP reservation in this subnet. That is the single most important design choice on this page, because:

- HA is, by volume, a piece of IoT infrastructure. It talks to 60+ devices that all live on VLAN 1. Keeping HA on the same subnet means cross-VLAN firewall rules aren't in the hot path — every automation, every poll, every sensor update stays at L2 inside the same broadcast domain.
- It inverts the usual "how do I let HA reach my isolated IoT devices?" question into the much simpler "how do I let my Primary-LAN phone reach HA?" question, which is one firewall rule instead of dozens.
- It also means HA, if it were ever compromised, is already segmented from the machines I bank on. The trust asymmetry stays intact.

### Guest (VLAN 2, `192.168.20.0/24`)

Captive portal. Three active leases, which is honestly about right for an afternoon. Anyone who visits connects, puts in their name, and gets an internet-only connection that's walled off from both IoT and Primary.

The important bit — easy to miss in UniFi's UI — is **Client Device Isolation** on the guest SSID. Without it, a friend's phone can see my parents' laptop if both are on Guest. With it on, every guest is cordoned into their own tiny bubble.

### Primary (VLAN 3, `192.168.30.0/24`)

Humans. 18 active leases today — phones, laptops, tablets, the Apple TV in the living room, my work MacBook. Small by device count, but the whole point of segmentation is that these 18 devices are the trusted ones. Primary can reach the internet, it can reach HA on IoT via one specific rule, and it can participate in cross-VLAN casting via mDNS reflection. That's it. Nothing else reaches into Primary from anywhere.

## The part nobody warns you about

The moment you isolate IoT from Primary, a lot of stuff quietly stops working.

- Chromecasts vanish from the phone because mDNS does not cross VLAN boundaries by default.
- SSDP / UPnP discovery for media stops working.
- HomeKit / AirPlay targets on the other VLAN go dark.
- The printer on IoT becomes invisible to the laptop on Primary.
- Any new integration you try in Home Assistant that relies on broadcast discovery silently fails — the integration adds fine, it just finds zero devices.

Segmentation is not a free lunch. You pay for it in packets that used to travel freely and now need explicit permission to cross a boundary. UniFi exposes two separate knobs that matter:

1. **Firewall / Traffic rules** — who can open a unicast connection to whom.
2. **mDNS reflector** per-VLAN toggle — whether multicast service discovery gets repeated into neighboring VLANs.

You need both. The firewall gets the data across; the reflector gets the *announcement* across so the sending side knows the receiver exists.

## The rules I wrote

Around half a dozen, all labelled descriptively so future-me remembers why they exist.

1. **Allow Primary → HA (8123)** — phones and laptops on Primary need to reach `http://homeassistant.local:8123` and its API. One rule, one direction, one port. That's the Primary-to-IoT bridge in its entirety for day-to-day use.

2. **Allow HA → IoT internal ports** — HA lives on IoT so most traffic is intra-subnet, but a few integrations need ports or protocols that the VLAN's default egress rules would otherwise drop (specifically outbound multicast for certain Wi-Fi plugs and Matter devices). This rule is narrow and exists because one vendor decided their protocol needed TTL > 1.

3. **Allow Primary → IoT (cameras + media + mgmt)** — direct RTSP from cameras into VLC on the laptop, Plex on the media server, SSH into the NVR for maintenance. Separate from the HA rule because the audit trail is clearer.

4. **Allow Chromecast reflection** — combined with UniFi's mDNS reflector enabled on both Primary and IoT, this lets the phone's Cast picker see the Chromecasts on IoT. Without it, casting silently fails with a "device not found" that's nearly impossible to debug.

5. **Allow Guest mDNS for casting** — same idea as #4 but narrower: guests can cast to the living-room TV, which is on IoT. No unicast, no device control, just enough multicast for the Cast picker to populate.

6. **Block IoT → Primary** — this is the default, but I have an explicit rule near the top of the chain that drops any IoT-initiated connection into Primary. Belt *and* suspenders. The day an IoT device gets popped, I want the answer to "could it reach the laptop?" to be no, twice over.

7. **Device-group-based egress restrictions** for a handful of devices that should only talk to specific WAN destinations (a couple of appliances I don't trust with open internet). Per-device isolation at the firewall level is easier once you have a few days of traffic flow data to look at.

Every rule has a label that names *why* it exists, not what it does. The what is in the rule body; the why is the part I need to read six months later when the printer stops working.

## While we're here: the DNS layer

One benefit of HA living on the IoT VLAN with a DHCP reservation is that it's a stable, always-on box with a known IP. Which makes it the obvious place to host **AdGuard Home** — a DNS-level ad and tracker blocker. It runs as an add-on inside HAOS, listens on port 53, and does two things that compound:

1. **Blocks ads and trackers at the DNS layer, network-wide.** Every device on every VLAN — the phones on Primary, the TV on IoT, even the guest's laptop if they're using DHCP DNS — resolves through AdGuard. Devices that have no plausible way to run their own ad blocker (smart TVs, every IoT appliance that quietly beacons telemetry) get the same filtering for free.

2. **Surfaces what's actually happening on the network.** The AdGuard UI shows which client made which DNS query. When a new IoT gadget gets added and I want to know who it's phoning home to at 3 AM, I just look — the queries are all there, grouped by client IP. This is the only time I've ever found vendor-surveillance concerns to be *inspectable* rather than hand-wavy.

The router is configured to hand out HAOS's IoT-VLAN IP as the DNS server in every DHCP lease, across all three VLANs. AdGuard forwards anything it doesn't block to a real upstream (1.1.1.1 with DNS-over-TLS).

**The tradeoff:** if HA goes down, DNS goes down for the whole house — which, in practice, means the internet feels broken until the box is back. I considered this for a while. Counter-arguments that won me over: HA hasn't crashed in any way that took out the container in the year I've been running this, AdGuard's own uptime is better than most consumer routers' built-in DNS, and the "wait, is the internet down?" failure mode is not meaningfully different from "wait, did the router reboot?" — which I used to get from ISP-supplied hardware routinely.

## What I'd do differently

**Start with the three VLANs on day one**, not after two years of one flat LAN. Migrating 150+ devices across VLANs means re-pairing a chunk of them, because vendor apps cache the original subnet and the device sullenly refuses to rejoin. Start clean and the pain is frontloaded and smaller.

**Put HA on the IoT VLAN from the start.** I did not do this initially; HA was on Primary for about a year. Cross-VLAN firewall rules for every single integration is a worse life than just treating HA as IoT infrastructure and moving it where the traffic naturally is.

**DHCP reservations over static IPs.** Every integration doc says "set the device to a static IP." Don't. Use DHCP reservations at the controller. If you ever renumber the subnet — as I did when I split the VLANs — it's one file to edit instead of forty devices to walk around the house to.

**Short lease on the IoT VLAN.** Many IoT devices don't gracefully handle IP changes. A 1-hour lease means when a device misbehaves and you force a rejoin, its old lease is gone by the time it comes back. The default 24-hour lease is purgatory.

**Point DHCP at AdGuard before you do anything else.** If I'd started with the DNS layer in place, I would have caught a handful of "that integration sends every API call through a telemetry domain" decisions much earlier.

## The bigger lesson

Network segmentation at home is mostly a documentation problem disguised as a networking problem. The VLAN setup takes an afternoon. What takes months is *remembering* which rule applies to what, which device you put on which VLAN, and why the printer stopped working two years later.

Name your VLANs something descriptive. Name your firewall rules better than the UI suggests. Write them down somewhere you'll actually look. Future-you will be grateful.
