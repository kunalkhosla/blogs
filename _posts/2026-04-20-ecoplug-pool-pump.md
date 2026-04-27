---
layout: post
title: "Cracking a pool pump's Wi-Fi protocol in an evening"
date: 2026-04-20 12:00:00 -0400
tags: [home-assistant, reverse-engineering, iot, udp]
excerpt: "How we reverse-engineered the DEWENWILS / ECO Plugs protocol and built a local Home Assistant integration — with Claude Code as the co-pilot."
excerpt_override: "A dead community integration, a broken Google Home linking flow, and an evening with a packet sniffer. Notes on building a local Home Assistant integration for a pool-pump Wi-Fi box."
---

> Code: **[github.com/kunalkhosla/ecoplug-homeassistant](https://github.com/kunalkhosla/ecoplug-homeassistant)**
>
> HACS PR: [hacs/default#7150](https://github.com/hacs/default/pull/7150) (in review)
>
> The device: **[DEWENWILS Pool Pump Timer (Wi-Fi) on Amazon](https://www.amazon.com/DEWENWILS-Outdoor-Wireless-Controller-Compatible/dp/B07PP2KNNH)**

I have an outdoor Wi-Fi switch on my pool pump — a DEWENWILS box that runs on the ECO Plugs app. Nice hardware, but the app is the only way to talk to it, and I wanted it in Home Assistant so I could schedule it alongside everything else in the house. None of the obvious paths worked, so I sat down one evening and reverse-engineered the thing.

Total time: about three hours. I worked alongside [Claude Code](https://claude.com/claude-code) (Anthropic's CLI coding agent, running as Opus 4.7 with 1M context). I drove from my Mac, walked outside to the plug whenever we needed to confirm something physically, and acted as the human in the loop. Claude Code did the packet analysis, the cryptanalysis, the Python, and the deploy-over-SSH dance. I'd never reverse-engineered a network protocol before.

The whole thing used pretty ordinary tools: Wireshark, PCAPdroid on my Android phone, `tcpdump` from the HAOS SSH add-on, and Python's standard library. Nothing exotic.

## How it actually went

### The first hour was all dead ends

A few things I tried before resorting to packet captures:

1. **Assumed it was a Tuya device.** These plugs *look* like every other rebranded Tuya/Smart Life gadget, so I figured Home Assistant's Tuya integration would just pick it up. Nope — DEWENWILS uses the ECO Plugs app, which is its own little ecosystem.
2. **Tried the existing `pyecoplug` HACS integration.** Installed cleanly, then sat there forever. Never discovered the plug, never produced a switch entity. It seems to be aimed at an older firmware.
3. **Tried Google Home as a bridge.** The ECO Plugs OAuth flow into Google completes the login… and then hands Google zero devices. So that was out.
4. **Looked at flashing Tasmota or ESPHome.** The hardware is an ESP8266, so technically possible — but it lives inside a sealed 240V outdoor box on the side of my house. Disassembling and soldering on that felt like the wrong evening project.
5. **Considered just replacing it** with a Shelly Pro 2 plus a contactor. Works fine long-term, but it's roughly $80 plus an electrician.

By that point I was a little annoyed and a lot curious, so we went straight at the protocol.

### Watching the wire

**First capture, from the HAOS Ethernet port:**
The plug is chatty. It broadcasts a 272-byte UDP packet to `255.255.255.255:10228` every two seconds, starting with a recognizable magic header that includes the literal string `"ECO Plugs"`. It also resolves `server1.eco-plugs.net` from time to time, but never actually phones home during my capture. Notably, I saw nothing flowing the other direction — no phone-to-plug traffic at all.

**Second capture, while toggling from the phone:**
Still nothing from phone to plug on the wire. The phone *is* sending out `pyecoplug`-style discovery broadcasts on ports 25 and 5888, but the plug is ignoring them — clearly a different protocol version. Meanwhile, toggling from the phone works perfectly (I went outside; the pump turned on and off), and yet the wire shows nothing.

That's the moment things clicked: **most APs don't bridge Wi-Fi-to-Wi-Fi unicast onto the wired segment.** The phone and the plug were both Wi-Fi clients on the same access point, so their conversation never crossed onto Ethernet. HAOS was sitting in the wrong seat.

**Third capture, this time from the phone itself using PCAPdroid:**
There it was. The phone fires UDP unicast from `:9090` to the plug at `:1022`. The plug answers back the same way. Each command gets repeated about four times for reliability. Now we had the channel.

### Decoding the packets

Each command is 152 bytes and breaks down like this:

| Bytes | What it is |
|-------|------------|
| 0–3 | Transaction ID (random per command; the response echoes it back) |
| 4–15 | Fixed header `17 00 00 00 00 00 00 00 DA E2 0C 00` |
| 16–71 | XOR-obfuscated body (56 bytes) |
| 72–75 | `00 00 00 00` |
| 76–79 | Opcode — `6A` for commands, `69` for queries/replies |
| 80–83 | State — `00` off, `01` on |
| 84+ | Padding or response-only fields |

The "encryption" on the body turns out to be **XOR with the 4-byte transaction ID, repeated**. We figured that out by lining up two same-type packets side by side: the XOR of their bodies matched the XOR of their transaction IDs at every 4-byte boundary. That's the classic fingerprint of a short repeating-key XOR.

Once you peel the XOR off, the body is the *same 56 bytes every time* — it starts with the ASCII `"yvQC"` and is padded with what looks like simple arithmetic-progression filler. The plug doesn't seem to validate the contents at all, only the structure. So to talk to it, you XOR that known plaintext against a fresh transaction ID and drop in the opcode and state byte.

### The first live test

Before getting clever, I wanted the simplest possible proof that we understood the channel: **just replay a captured OFF command, byte for byte**, from the HAOS shell.

```
python3 /tmp/replay_test.py 192.168.0.87
[OFF replay] sending 152 bytes → 192.168.0.87:1022
[OFF replay] REPLY from ('192.168.0.87', 1022): 152 bytes
  state[80:84] = 00000000
```

I walked outside. The pump was off. Replay works — there's no nonce, no timestamp, no anti-replay check. The plug just trusts the packet.

### Crafting fresh packets

Replay is fine for one plug, but useless for a real integration. So we wrote a small crafter that takes a desired state and produces a valid packet with a fresh random transaction ID. As a sanity check, we re-built every captured command using its captured TXID and confirmed all sixteen matched the originals byte for byte.

Then a live test from the Mac with a transaction ID the plug had never seen before:

```
[OFF] txid=7cdd2dac sending 152 bytes
  reply: txid=7cdd2dac state=OFF
```

Pump off. Then on with another fresh ID. Pump on. We were officially driving the thing.

### Wrapping it up

- `custom_components/ecoplug/protocol.py` — about 150 lines of pure asyncio, with `craft_command`, `craft_query`, and `send_and_wait`.
- `custom_components/ecoplug/switch.py` — a thin Home Assistant switch wrapper that polls every 10 seconds.
- 8 unit tests, including a byte-for-byte rebuild of a captured packet.
- Deployed via SSH to `/config/custom_components/ecoplug/`, restart Home Assistant, switch shows up, switch works.
- Tagged v0.2.0 and cut a GitHub release so anyone can install it through HACS as a custom repository.

## Credit

**Investigation, protocol analysis, Python, tests, documentation:** [Claude Code](https://claude.com/claude-code) (Opus 4.7).

**Hardware, physical validation, and pointing at the next thing to try:** [Kunal Khosla](https://github.com/kunalkhosla).

If you've got a [DEWENWILS / ECO Plugs](https://www.amazon.com/DEWENWILS-Outdoor-Wireless-Controller-Compatible/dp/B07PP2KNNH) box and Google Home is broken for you too, [the integration](https://github.com/kunalkhosla/ecoplug-homeassistant) is right here. Issues and PRs welcome.
