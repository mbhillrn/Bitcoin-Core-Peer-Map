# Next Session Handoff

This file contains instructions for the next Claude session.

## Step 5: Rename Repository

The user wants to rename this repository from `Bitcoin-Core-Peer-Map` to `bitcoin-core-geolocated-peer-map`.

This could not be done in the current session because renaming the repo would break the git remote connection.

### What needs to happen:

1. **Rename the repo on GitHub** — either the user does this in GitHub Settings, or use `gh api` to rename
2. **Update all internal references** to the old repo name:
   - `README.md` — GitHub URLs, clone commands
   - `QUICKSTART.md` — GitHub URLs, clone commands
   - `da.sh` — `GITHUB_REPO` variable (line ~20), any GitHub URLs in terminal output
   - `web/MBCoreServer.py` — any GitHub URLs in the terminal banner or elsewhere
   - `web/templates/bitindex.html` — GitHub link in the logo/footer
   - `lib/prereqs.sh` — any GitHub references
3. **Update the git remote** to point to the new repo name
4. **Update GitHub repo settings**:
   - About/description: "MBCore Dashboard — Geolocated Peer Map and Tools for Bitcoin Core"
   - Topics: bitcoin, bitcoin-core, peer-map, geolocation, dashboard, bitcoin-cli, bitcoin-node, geoip, bitcoin-peers, monitoring
5. **Verify** everything works after rename

### Current repo references to update:

- `da.sh` line ~20: `GITHUB_REPO="mbhillrn/Bitcoin-Core-Peer-Map"`
- `da.sh` line ~21: `GITHUB_VERSION_URL` uses GITHUB_REPO
- `web/templates/bitindex.html` line ~14-15: GitHub link in logo
- `web/templates/bitindex.html` line ~149: Footer GitHub link
- `README.md`: clone URL, issue links
- `QUICKSTART.md`: clone URL

### Also: Step 4 tasks

- Change VERSION if needed (currently 6.0)
- Merge the branch to main
- Create a GitHub release for v6.0
- Update repo about page description and topics
