# Backlog — recorded, not scheduled

Ideas the owner asked to keep on file without building yet. Each entry says
what it is, why it came up, and what it would take, so it can be picked up
later without re-deriving it.

## Live TXO quotes away from the owner's computer (recorded 2026-11-02)

**Today.** Live data (the `● SinoPac` / `● IB` badges) needs `server/` running
on the owner's own machine, and the frontend has to be opened locally too:
the deployed Vercel page cannot call a proxy on `localhost`. Away from that
computer — on the phone, say — the site shows the previous session's
TAIFEX / IB snapshots only.

**Idea.** Run the proxy on a small always-on cloud host instead, over HTTPS,
and let the deployed frontend point at it, so live TXO quotes reach any
device.

**What it would take.**
- **SinoPac (TXO)** is the easy half: Shioaji needs only the API key and
  secret key (no certificate, read-only), so it can run headless. Check
  SinoPac's limits on concurrent logins per key before relying on it.
- **IB** is the hard half: it needs TWS or IB Gateway running beside the
  proxy, with its periodic re-login and two-factor prompts. The daily
  snapshot (`ib-eod.js`) is the practical path for the US products.
- **Access control**, or anyone with the URL uses the owner's feed: a token
  the frontend sends, kept out of the repo. Keys live in the host's secret
  store, never in git.
- **CORS** on the proxy for the Vercel origin.
- **Licensing**: exchange data shown live to the public can need a vendor
  licence. Keep the live view private to the owner.
- **Cost**: a small container or VM, a few US$ a month.
