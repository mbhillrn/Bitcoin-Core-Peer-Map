# MBCore Dashboard (Bitcoin Core Geolocated Peer Map, GUI, and Tools)

A real-time monitoring dashboard for your personal Bitcoin Core node. Automatically geolocates your connected peers, places them on an interactive canvas world map, and provides tools to manage connections, all from a GUI browser.

![MBCore Dashboard Peer Table Expanded](docs/images/1.hero1.png)

![MBCore Dashboard Full Map View](docs/images/1.hero2.png)

*Note: CJDNS, I2P, and Tor peers are displayed in Antarctica as they cannot be geolocated.*

![MBCore Dashboard Customizable Themes](docs/images/1.hero3.customizable.maps.png)

*Note: Here is the light theme with green land, blue oceans, and iced polar poles, completely customizable.*

MBCore Dashboard uses `bitcoin-cli` to query your running Bitcoin Core node, geolocates public peers via a maintained database and online ip geolocation searches like [ip-api.com](http://ip-api.com). Maintains a local SQLite database of peer locations (latitude, longitude, ISP, AS info, and more) for instant recall. The database is continuously updated with new IP geolocations from the [Bitcoin Node GeoIP Dataset](https://github.com/mbhillrn/Bitcoin-Node-GeoIP-Dataset).

- Interactive HTML5 Canvas world map with geolocated Bitcoin Core peers
- Supports all 5 Bitcoin Core network types: **IPv4**, **IPv6**, **Tor**, **I2P**, **CJDNS**
- Real-time peer data, system stats, and live Bitcoin price
- Connect, disconnect, and ban peers directly from the dashboard
- Local GeoIP database with automatic updates, works offline for cached peers
- Zero config, auto-detects your Bitcoin Core installation
- Single script install, no accounts, no external services requiring signup

**Requires:** [Bitcoin Core](https://bitcoincore.org/) (`bitcoind`) installed and running.

---

## Quick Start

```bash
git clone https://github.com/mbhillrn/Bitcoin-Core-Peer-Map.git
cd Bitcoin-Core-Peer-Map
./da.sh
```

On first run, the script checks prerequisites and sets up a Python virtual environment:

![Prerequisites and Setup](docs/images/2.prereqs.png)

Bitcoin Core is auto-detected and configured. The GeoIP database is automatically enabled and downloaded. If auto-detection can't find your setup (rare), use **m) Manual Settings** from the main menu to enter your paths.

You'll land at the main menu. Press **1** to launch the dashboard:

![Main Menu](docs/images/5.menu.png)

If the geolocation service is unreachable (no internet), you'll see a warning before the dashboard launches. Your local GeoIP database is used automatically for cached peers. Press **Enter** to continue or **R** to retry:

![Cannot Reach Geolocation Service](docs/images/6.cannot-reach-geo.png)

The dashboard starts and shows access URLs tailored to your detected environment:

**Local (desktop):** Shows your localhost URL with a LAN address for other devices on your network.

![Local Instructions](docs/images/6.local-instructions.png)

**Remote (SSH/headless):** Shows your LAN IP as the primary URL, with firewall guidance if one is detected.

![Remote Instructions](docs/images/6.remote-instructions.png)

Open the URL in your browser and you're in.

For detailed access scenarios (headless servers, SSH tunnels, firewall setup), see the [QUICKSTART.md](QUICKSTART.md).

---

## Dashboard Overview

### Network Bar (Flight Deck)

![Network Bar and Bitcoin Price](docs/images/15.topmenunetwork.bitcoinprice.png)

The top bar shows all five Bitcoin Core network types as individual chips: **IPv4**, **IPv6**, **Tor**, **I2P**, and **CJDNS**. Each chip displays a colored status dot, the protocol name, and live inbound/outbound peer counts.

- **Green dot** - the network is enabled and has active peers (working properly)
- **Red/gray dot** - the network is disabled, not configured, or has no connected peers

Each chip shows real-time counts like `3 in / 5 out`. When a peer connects or disconnects, an animated delta indicator (e.g. `+1`, `-2`) briefly appears next to the affected count so you can see connection changes as they happen.

![Network Info Popup](docs/images/20.network-info-popup.png)

**Hover** over any network chip to see a detailed popup with:
- The full network name and enabled/disabled status
- Inbound peer count
- Outbound peer count
- **Local Bitcoin Core Network Score** (for IPv4 and IPv6 only - overlay networks like Tor, I2P, and CJDNS do not have a reliable local score)
- Configuration status message (whether the network appears properly configured or needs attention)

### Bitcoin Price

Below the network bar, the live Bitcoin price updates every 10 seconds (configurable). The price turns **green** when it goes up from the last update and **red** when it goes down. Click to change currency (USD, EUR, GBP, JPY, CHF, CAD, AUD, CNY, HKD, SGD) or adjust the update frequency.

### Map

The full-screen canvas map displays your node's connected peers as color-coded dots by network type. Click any peer dot to see detailed information:

![Peer Popup](docs/images/7.popup.png)

The popup shows the peer's ID, address, network type, connection direction, software version, geographic location, ISP, ping latency, and connection duration. Pinned popups include a **Disconnect** button for quick peer management.

#### Private Networks (Antarctica)

![Antarctica](docs/images/8.antarctica1.png)

Peers on private networks (Tor, I2P, CJDNS) don't have real geographic coordinates. These peers are placed at Antarctic research stations for visualization. Their real locations are hidden by design.

![Antarctica Peer Card](docs/images/8.antarctica2.png)

Toggle Antarctica visibility from the Table Settings gear menu.

### Left Overlay: System Stats

![System Info](docs/images/13.systeminfo.png)

The upper-left overlay shows at a glance:
- **Peers** total connected peer count
- **CPU** processor utilization percentage
- **RAM** memory usage percentage
- **NET ↓ / NET ↑** real-time network download/upload with animated bars

Click CPU, RAM, or NET for a detailed **System Info** modal with full breakdowns: CPU bar, RAM (MB used/total), system uptime, load averages, disk usage, and network traffic scaling options (auto-detect or manual). You can also toggle which stats appear on the overlay.

### Right Overlay: Node Info and Database

- **Update in** countdown to next peer data refresh
- **Status** geolocation progress for newly discovered peers
- **NODE INFO** click to open a detailed modal with node version, peer count, blockchain size, TX index status, sync progress, block height, mempool size, and full blockchain/mempool details

![Node Info](docs/images/12.nodeinfo.png)

The Node Info modal has three sections: **Node** (version, peers, disk size, pruning, sync status), **Mempool** (pending TXs, data size, memory usage, total fees, min accepted/relay fees, Full RBF status), and **Blockchain** (chain, block height, sync progress, best block hash, difficulty, median time, softforks).

- **MBCORE DB** click for GeoIP database stats: entry count, database size, newest/oldest entry age, file path, auto-resolve status, and an **Update Database** button to pull new geolocations without leaving the dashboard. Toggle **Auto-update** (green/red slider) to enable automatic database updates at startup and once per hour while the map is open - this setting persists across restarts and syncs with the terminal menu. Toggle **API Lookup** (green/red slider) to control whether unknown IPs are resolved via ip-api.com or only cached database entries are used

![GeoIP Database Modal](docs/images/16.geodb-modal.png)

### Peer Table

![Peer Table](docs/images/9.table.png)

The bottom panel shows all connected peers in a sortable, filterable table. The header displays network filter badges with live peer counts.

**Features:**
- **Network filters** - filter by All, IPv4, IPv6, Tor, I2P, or CJDNS
- **Sortable** - click any column header (cycles: unsorted, ascending, descending)
- **Resizable** - drag column edges
- **Auto-fit** - automatically sizes columns to fit content; turns off when you manually resize
- **Hide/Show Table** - minimize the peer table for a full map view
- **Click to fly** - click any row to zoom to that peer on the map

#### Default Columns (16 visible)

| Column | Label | Description |
|--------|-------|-------------|
| ID | ID | Peer identifier assigned by Bitcoin Core |
| Net | Net | Network type: IPv4, IPv6, Tor, I2P, or CJDNS |
| Duration | Duration | How long the peer has been connected (formatted as hours/minutes/seconds) |
| Type | Type | Connection type and direction (see connection types below) |
| IP:Port | IP:Port | Peer's network address and port |
| Software | Software | The peer's Bitcoin Core version string (subver) |
| Services | Services | Service flags advertised by the peer (see service flags below) |
| City | City | Geolocated city |
| Region | Region | State or province |
| Country | Country | Country name |
| Continent | Cont. | Continent abbreviation |
| ISP | ISP | Internet Service Provider |
| Ping | Ping | Round-trip latency in milliseconds |
| Sent | Sent | Total bytes sent to this peer |
| Received | Recv | Total bytes received from this peer |
| Addrman | Addrman | Whether this peer's address is in Bitcoin Core's address manager (Yes/No) |

#### Advanced Columns (17 additional, hidden by default)

Enable these from the Table Settings gear menu. These provide deeper geolocation and network metadata.

| Column | Label | Description |
|--------|-------|-------------|
| Direction | Dir | IN or OUT (raw direction without connection type) |
| Country Code | CC | Two-letter country code (e.g. US, DE, JP) |
| Continent Code | CntC | Continent code (e.g. NA, EU, AS) |
| Latitude | Lat | Geographic latitude (2 decimal places) |
| Longitude | Lon | Geographic longitude (2 decimal places) |
| Region Code | Rgn | State/province abbreviation code |
| AS Number | AS | Autonomous System number (e.g. AS13335) |
| AS Name | AS Name | Organization that owns the AS (e.g. Cloudflare, Hetzner) |
| District | District | Sub-city regional subdivision (where available) |
| Mobile | Mob | Whether the peer is on a mobile/cellular network (Y/N) |
| Organization | Org | Organization name associated with the IP |
| Timezone | TZ | Peer's timezone (e.g. America/New_York) |
| Currency | Curr | Local currency for the peer's country |
| Hosting | Host | Whether the IP belongs to a hosting/datacenter provider (Y/N) |
| UTC Offset | UTC | UTC offset in seconds |
| Proxy | Proxy | Whether the IP is a known proxy (Y/N) |
| ZIP | ZIP | Postal/ZIP code |

#### Connection Types

The **Type** column shows how each peer is connected. Outbound peers include the subtype after a slash (e.g. `OUT/OFR`). Hover any type for the full description.

| Abbreviation | Full Name | Description |
|-------------|-----------|-------------|
| IN | Inbound | A peer that connected to your node |
| OFR | Outbound Full Relay | Your node connected for full block and transaction relay |
| BRO | Block Relay Only | Your node connected for blocks only (no transaction relay, for privacy) |
| MAN | Manual | A peer you manually connected to via `addnode` |
| AF | Address Fetch | A short-lived connection to learn about other peers' addresses |
| FLR | Feeler | A short-lived connection to test if an address in the address manager is reachable |

#### Service Flags

The **Services** column shows abbreviated service flags that each peer advertises. These indicate what capabilities the peer supports. Hover over the services cell to see full descriptions.

| Flag | Name | Bitcoin Core Constant | What It Means |
|------|------|----------------------|---------------|
| **N** | Network | NODE_NETWORK | The peer stores and serves the **complete blockchain history**. It can provide any historical block on request. Most full nodes advertise this flag. |
| **W** | Witness | NODE_WITNESS | The peer supports **Segregated Witness** (SegWit). It can relay and validate witness data for transactions. Nearly all modern nodes have this. |
| **NL** | Network Limited | NODE_NETWORK_LIMITED | The peer stores only the **last 288 blocks** (roughly 2 days of history). This is typical of pruned nodes that keep a minimal chain tail. NL peers can still relay new blocks and transactions normally. |
| **P** | P2P V2 | P2P_V2 | The peer supports **BIP324 encrypted transport**. All traffic between your node and this peer is encrypted, preventing passive eavesdropping on the connection. |
| **CF** | Compact Filters | NODE_COMPACT_FILTERS | The peer serves **BIP157/158 compact block filters**, which allow lightweight clients to privately determine whether a block contains relevant transactions without downloading the full block. |
| **B** | Bloom | NODE_BLOOM | The peer supports **BIP37 Bloom filters**, an older lightweight client protocol. Bloom filters allow SPV wallets to request only transactions matching a filter pattern, though they leak some privacy to the serving node. |

A typical modern full node will show `N W P` (full chain, SegWit, encrypted transport). A pruned node will show `NL W P` instead of `N W P`.

### Display Settings

![Display Settings](docs/images/14.displaysettings.png)

Click the **Update in** or **Map Status** rows in the right overlay to open Display Settings:
- **Update Frequency** configure how often peer data and node info are refreshed (3-120 seconds)
- **Show/Hide** toggle visibility of Map Status, Node Info, and MBCore DB on the right overlay
- **Advanced** opens the Advanced Display Settings panel (see below)

### Advanced Display Settings

![Advanced Display Settings](docs/images/19.advanced-display-options.png)

Click **Advanced** at the bottom of the Display Settings popup to open a floating, draggable panel with full control over the map's visual appearance. All changes are live and you see the effect immediately as you drag each slider.

**Theme**

Choose from four built-in themes that set all sliders to curated presets:
- **Dark** the original dark canvas dashboard, ideal for low-light environments
- **Light** bright, clean interface with green land and blue ocean, best for well-lit rooms
- **OLED** pure black for OLED screens, maximum contrast, minimum power draw
- **Midnight** deep indigo-blue tones with purple accents, rich and atmospheric

**Peer Effects**
- **Shimmer** ambient twinkle intensity for long-lived peers (0 = off, which is the default)
- **Pulse Depth In / Out** how deep the breathing pulse goes for inbound vs outbound peers
- **Pulse Speed In / Out** how fast the pulse cycles (50 = original speed)

**Land**
- **Hue** shift the land color across the full spectrum (default 215 = dark blue-gray)
- **Brightness** darken or brighten the landmasses
- **Snow the Poles** gradually frost Antarctica and Arctic regions (Greenland, Svalbard, etc.) with an icy gray-white. Drag from 0 (off) to 100 (full ice). Tip: when using snowy poles, decrease the peer table transparency with the gear icon on the peer list title bar so the table doesn't cover the effect.

**Ocean**
- **Preset** choose between Original (full hue range) and Light Blue (constrained sky blue range)
- **Hue** shift the ocean color (range depends on selected preset)
- **Brightness** darken or brighten the ocean and lakes

**Lat/Lon Grid**
- **Visible** toggle the latitude/longitude grid on or off
- **Thickness** grid line width
- **Hue** shift the grid line color
- **Brightness** grid line opacity (raise this to make hue changes more visible)

**Borders**
- **Thickness** scale country and state/region borders together (0 = hidden, 50 = default, 100 = 2x thick)
- **Hue** shift the border line color

**HUD Overlays**
- **Solid Backgrounds** adds semi-opaque backgrounds behind stats, price, and info panels for improved readability on lighter maps

**Saving and Resetting**
- **Permanent Save** persists your settings to localStorage so they survive browser refreshes and new sessions. Hover the button for details.
- **Reset** snaps every slider back to the original defaults and resets the theme to Dark.
- To keep changes for the current session only, just close the panel. Your settings stay active until you reload.
- Every slider label is a clickable link that resets just that one slider to its default.

![Advanced Display Panel](docs/images/17.advanced-display.png)

Here is an example of a customized map using the Advanced Display Settings:

![Customized Map Example](docs/images/18.advanced-display-example.png)

### Table Settings

The gear (⚙) button opens Table Settings where you can:
- Adjust **panel transparency** (0-100% opacity slider)
- Toggle individual **columns** on/off
- Toggle **Private Networks in Antarctica**
- **Reset to Defaults** restore default columns, transparency, and settings

### Connect Peer

![Connect Peer](docs/images/10.connect.png)

Click **Connect Peer** to manually connect to a new peer. Enter an address in any supported format (IPv4, IPv6, Tor .onion, I2P .b32.i2p, CJDNS). The modal auto-generates the `bitcoin-cli addnode` command and a `bitcoin.conf` entry you can copy.

### Disconnect and Ban Peers

![Disconnect Peer](docs/images/11.disconnect.png)

Click the **Disconnect** button on any peer row in the table to open the disconnect dialog. You can disconnect only, or disconnect and **ban the IP for 24 hours** (ban option available for IPv4/IPv6 peers only). Manage all active bans from the **Banned Peers** button in the peer panel header.

---

## Main Menu

![Main Menu](docs/images/5.menu.png)

| Option | Description |
|--------|-------------|
| **1) Enter MBCore Dashboard** | Launch the web dashboard |
| **2) Reset MBCore Config** | Clear saved configuration (option to keep or delete database) |
| **3) Firewall Helper** | Detect your network and configure UFW to allow dashboard access from other devices |
| **g) Geo/IP Database** | Manage the GeoIP cache, toggle auto-updates, check integrity, purge old entries |
| **m) Manual Settings** | Manually enter Bitcoin Core paths if auto-detection didn't work |
| **p) Port Settings** | Change the dashboard port (default: 58333, persists across restarts) |
| **u) Update** | Update to the latest version (appears when an update is available) |
| **q) Quit** | Exit |

### Geo/IP Database Settings

![Geo/IP Database Settings](docs/images/3.geomenu.png)

Manage the local GeoIP cache database. Toggle auto-updates on or off, check database integrity, view stats, download the latest dataset, or purge old entries. The auto-update setting syncs with the web dashboard - toggling it in one place updates the other.

### Port Settings

![Port Settings](docs/images/4.portset.png)

Change the dashboard port if 58333 conflicts with another service. The setting persists across restarts and updates.

### Firewall Helper

If another device on your network can't reach the dashboard, the built-in Firewall Helper (option **3**) detects your IP, subnet, and firewall status, then offers to add the rule for you. It also provides the command to reverse the change later.

### Automatic Updates

MBCore Dashboard has two independent auto-update systems: one for the application itself and one for the GeoIP database.

**System Update Check (Application)**

The dashboard automatically checks GitHub for new versions of MBCore Dashboard:
- Checks on dashboard startup, then every 55 minutes while the dashboard is open
- The backend fetches the remote `VERSION` file from the GitHub repository and compares it to the locally installed version
- Results are cached for 30 minutes to avoid excessive network requests
- When a new version is available, a banner appears in the top-right corner of the dashboard: **"Update Available! v6.2.2 -> v6.3.0"** (for example)
- Hover the banner to see the changelog (pulled from the `CHANGES` file) and instructions for how to update
- From the terminal menu, use **u) Update** to pull the latest version via `git pull` and auto-restart

**GeoIP Database Auto-Update**

The GeoIP database that stores peer locations can also update itself:
- When enabled, the database syncs from the [Bitcoin Node GeoIP Dataset](https://github.com/mbhillrn/Bitcoin-Node-GeoIP-Dataset) at startup and once per hour while the dashboard is running
- Toggle auto-update on/off from the dashboard's **MBCORE DB** modal (green/red slider) or from the terminal's **g) Geo/IP Database** menu
- The setting syncs between the dashboard and terminal - toggling it in one place updates the other
- A brief status message appears in the top bar during updates: countdown, checking, and result ("DB already up to date" or "DB successfully updated")
- When auto-update is disabled, the database still works with whatever data it already has cached

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                        YOUR MACHINE                             │
│                                                                 │
│  ┌──────────────┐      bitcoin-cli      ┌──────────────────┐   │
│  │   bitcoind   │ ◄──────────────────► │  FastAPI Server   │   │
│  │ (Bitcoin Core)│        RPC           │  (Python :58333)  │   │
│  └──────────────┘                       └────────┬──────────┘   │
│                                                  │              │
│                                       HTTP + SSE │              │
│                                                  ▼              │
│                                       ┌──────────────────┐      │
│                                       │   Web Browser    │      │
│                                       │  (Canvas Map)    │      │
│                                       └──────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

`./da.sh` auto-detects your Bitcoin Core node, launches a FastAPI server on port 58333, and serves the dashboard to your browser. Peer data updates via Server-Sent Events (SSE) for real-time changes.

Geolocation uses [ip-api.com](http://ip-api.com) (free, no API key required) for new peers, with results cached in a local SQLite database (`./data/geo.db`). The [Bitcoin Node GeoIP Dataset](https://github.com/mbhillrn/Bitcoin-Node-GeoIP-Dataset) provides pre-cached locations for thousands of known Bitcoin nodes.

---

## Compatibility

**Tested:**
- Ubuntu 22.04, 24.04, Linux Mint, Debian

**Should work:**
- Fedora, Arch Linux

If you run into issues on your system, [open an issue](https://github.com/mbhillrn/Bitcoin-Core-Peer-Map/issues).

---

## Dependencies

All dependencies are automatically detected and installed on first run.

| Tool | Purpose |
|------|---------|
| `bitcoin-cli` / `bitcoind` | Bitcoin Core RPC interface and daemon |
| `python3` | Python 3.8+ interpreter |
| `jq`, `curl`, `sqlite3` | JSON parsing, HTTP requests, database |
| `fastapi`, `uvicorn`, `jinja2`, `sse-starlette` | Web server (installed in local `./venv/`) |

---

## Project Structure

```
Bitcoin-Core-Peer-Map/
├── da.sh              # Main entry point
├── lib/               # Shell libraries (UI, config, prereqs)
├── scripts/           # Bitcoin Core detection
├── web/               # FastAPI server + frontend (HTML5 Canvas)
├── data/              # Local database and config (created on first run)
└── venv/              # Python virtual environment (created on first run)
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Dashboard won't load from another device | Use the **Firewall Helper** (option 3) or manually allow port 58333 |
| Dashboard won't load at all | Close old browser tabs, check `ss -tlnp \| grep 58333` for port conflicts |
| Bitcoin Core not detected | Make sure `bitcoind` is running, or use **m) Manual Settings** |
| Peers show "Unknown" location | Geolocation is in progress, new peers are looked up as they connect |

---

## License

MIT License. Free to use, modify, and distribute.

## Support

If youre feeling generous:

**Bitcoin:** `bc1qy63057zemrskq0n02avq9egce4cpuuenm5ztf5`

---

*Created by [@mbhillrn](https://github.com/mbhillrn/Bitcoin-Core-Peer-Map)*
