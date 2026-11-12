# Quote Slip

**Idea.** wantlist as a well-made pocket tool: warm paper, keycaps that press down, figures set like a price list. Its signature is the **dotted leader** in every row (name, dots, figure), which grows into a **perforated quote slip** for a Hunt's best offer.

## Key UX decisions

- **Home fits one screen.** At the top is a one-line capture field. Below it are three short sections: **Needs you** (action, leader, figure), **With the researcher** (one line each, with the live step) and **Pantry** (covered refills, each with a **Running low** button). Nothing expands on home, so the common case ends near 710 of 844 px.
- **Explore is lively.** One pick card at a time. Numbered pips take each reaction's colour. Three labelled keycaps (No way / Kind of / Yes) stay pressed; tap again to clear. Yes and Kind of deal the next card. No way opens an optional "What's off?". A sticky dock shows "Refine with N" or says why it is disabled. Below the card: preferences (editable, locked during a round), keepers, folded earlier rounds and "Nothing new found" with Loosen / Reword.
- **Hunt is an exact quote.** A plate names the exact match. The slip lists the pack, shipping and what you really pay. Price per unit appears only when packs differ, so the iPhone shows its price, seller trust and warranty. Only offers checked at the shop and in stock can win. A cheaper ≈ price gets one quiet note. Mismatches (refurbished, 512 GB, import, Optimum, Intenso) sit in a closed group.
- **One-off vs refill.** **Bought here** asks for the price paid and "Will you buy this again?", pre-filled from research. Yes means **Covered**: the slip becomes a stub with **Running low**, which starts a new hunt in the background. No moves it to Bought.
- **Waiting** is one calm block per idea, and the header chip mirrors it.

## Visual system

- **Type.** Bricolage Grotesque, with DM Mono for aligned figures only.
- **Colour.** Warm paper and ink. Deep green means act, best or checked; brass means Hunt. The reactions use rust, ochre and green. All colours are `:root` tokens, light and dark.
- **Spacing and shape.** 16 px gutters and 44 to 56 px targets. Keycap shadows, never loud fills.
- **Motion.** A card deal, a key press and a breathing dot, all off under reduced motion.

## Left out

Price watching, schedules, notifications, price charts, an Explore compare view and in-place idea editing.
