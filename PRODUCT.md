# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

All of these at once, with no single primary audience:

- **Evan himself**, with NITABot running on a second screen as an ambient fish tank while he works or relaxes.
- **Chicago riders** checking where their CTA 'L' or Metra train is right now.
- **Transit fans** who enjoy watching the whole network move.
- **Viewers of a possible future YouTube live stream** (see Capabilities and Constraints: undecided).

## Product Purpose

NITABot is a live map of every CTA 'L' and Metra train in Chicagoland on one real-geography map. It opens on Chicago and zooms out to all of Metra (Kenosha to University Park). It exists to be pleasant to leave running for hours and useful when someone needs a train.

When ambience and quick information pull in different directions, the balance is **75% calm ambient view, 25% quick train info**: the ambient experience leads, and train information stays one tap away rather than on screen by default.

## Positioning

- The only map that puts the 'L' and Metra together on true geography (not a schematic), with each system's own data.
- Built around honesty about position: each marker is drawn where the train last reported, never extrapolated or invented, and a suspicious jump is held until confirmed.
- An ambient object first (sound modes, train of the moment, voice check-ins, animated lake), not an agency trip planner.

## Operating Context

- Static site on GitHub Pages (https://evan-dawkins.github.io/nitabot/), built from `src/` by `tools/build.py` and `tools/build_layout.py`; data refreshed by GitHub Actions.
- Live data comes through a shared Cloudflare Worker that also serves MetraBot and CTABot. CTA positions and Metra GPS refresh about every 30 seconds.
- Used on desktop second monitors for hours at a time and on phones for quick checks.
- Sibling projects MetraBot and CTABot stay live and unchanged; their future is undecided.

## Capabilities and Constraints

- Live CTA and Metra trains; train cards (destination, next stops, predictions); station sheets with arrivals; Metra downtown departure boards; up to 5 saved stations; CTA and Metra service alerts with system and category filters; line bar showing one line at a time; verified transfers; state lines; light and dark themes; satellite imagery; sound modes (brown noise, water, sonar); cute trains; train of the moment with chase camera and voice check-ins; simulated O'Hare airport train (labelled simulated); welcome guide.
- **Never fabricate train positions.** No extrapolation past the newest real report; unconfirmed trains go grey, then leave the map.
- **Transfers only when verified** by agency data or a CTA station page. Proximity or a line crossing is not a transfer.
- **Metra report card:** deliberately not included.
- **No slogan.**
- **Approval gates:** the shared Cloudflare Worker is never modified or redeployed without Evan's explicit approval; pushes, merges, repo settings and public deploys each need explicit approval.
- **Data terms:** CTA's license forbids implying CTA affiliation or endorsement and limits CTA brand assets; Metra's license requires disclaiming affiliation, not claiming the data is accurate or timely, not using Metra trademarks, and showing when the data was last updated. NITABot does not yet show Metra's last-updated time at all times (open item).
- **Undecided:** a YouTube live stream is an idea only; do not design for it yet.

## Brand Commitments

- Name: **NITABot**.
- Disclaimer, verbatim, kept wherever the project explains itself: "NITABot is an unofficial personal project made for fun and is not affiliated with NITA." Also not affiliated with the CTA, Metra or the RTA.
- No CTA or Metra logos or trademarks as branding. Route colors are used to identify lines.
- Personality: playful details (sounds, cute trains, voice check-ins) stay part of the product.

## Evidence on Hand

- The live site and its screenshots in `docs/` (e.g. `docs/2026-10-25-redesign-after-*.png`).
- Test suites in `tests/` run against a mock Worker; they prove behavior with simulated data, not live-feed accuracy.
- No user research, testimonials, usage numbers or press exist. Do not invent any.

## Product Principles

1. **Truth over smoothness.** A train is shown only where the data puts it; uncertainty is shown, never hidden behind animation.
2. **Calm first.** It must be pleasant to leave on for hours; information is on demand, not shouted.
3. **One network, real geography.** The 'L' and Metra share one true map, and nothing is moved to look tidier.
4. **Simple to use, careful underneath.** The engineering lives in accuracy and reliability, not in visible complexity.
5. **Keep the fun.** The ambient and playful features are part of the product, not decoration to cut.
