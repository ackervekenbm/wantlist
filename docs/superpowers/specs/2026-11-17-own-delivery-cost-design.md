# Your own delivery cost on a hunt offer

## Intent

A hunt often doesn't know what delivery costs: the shop page doesn't say, or
it says "free over €49" and the item costs less. The owner can find out by
putting the item in the shop's cart, then wants the offers ranked on the full
price.

## Decided (owner approved)

- Every hunt offer (best slip, Other shops, the folded unavailable ones) has
  a **Delivery** control that opens a sheet: what the shop page said, a cost
  field (`0` = free), **Clear** and **Save**.
- Saved, the offer shows the cost with "you checked", and the hunt's offers
  re-rank at once on the full price, partner discount included, exactly as a
  hunt ranks them. A known delivery makes an offer eligible for best (checked
  price, in stock, exact match still required). A cost on a pick-up-only or
  no-delivery-to-Belgium offer means it does deliver.
- **Clear** brings back what the researcher found.
- Per offer only (owner's choice over per shop): a new hunt run starts fresh.
- Delivery is its own line on every offer, as on the best slip ("Delivery ···· not shown",
  the word being the button); the line above keeps price and stock ("✓ checked · in
  stock"), so the ✓ no longer reads as belonging to "in stock" (owner, mid-build).

## How (Claude's calls)

- `OfferFacts.foundDelivery` keeps the researcher's `delivery` while the
  owner's cost is in place (`delivery` = `{ kind: 'free' | 'paid', cost }`);
  its presence means "you checked". No migration: offers are JSON.
- `PATCH /api/picks/:id` takes `delivery`: euros (0 to 1000, cents) or null to
  clear; 400 for a pick that is not a hunt offer.
- `setOfferDelivery` (db) updates the offer and re-ranks that hunt round in
  one transaction, with `rankOffers` passed in by the route (target and
  partner discount live there).

## Approaches considered

- Remember the cost per shop for this idea, or per shop everywhere: survives
  re-hunts, but the owner chose per offer for now.
- Overlay the owner's cost only at display time: cheaper, but the ranking and
  the best offer would not change, which is the point.
