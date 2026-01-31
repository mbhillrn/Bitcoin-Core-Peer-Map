# MBCore Dashboard

A lightweight monitoring tool for Bitcoin Core nodes that visualizes peer connections on an interactive map.

## Why?

Running a Bitcoin node is more enjoyable when you can see your peers across the globe. Traditional monitoring solutions like Grafana require complex setup and configuration. MBCore Dashboard provides instant visualization with zero configuration beyond pointing it at your node.

## Features

- **Interactive World Map** - Watch your peer connections in real-time on a Leaflet.js map
- **Auto-Detection** - Automatically finds your Bitcoin Core installation, datadir, and authentication
- **Peer Geolocation** - Looks up geographic location for each peer (with smart caching)
- **Real-Time Updates** - Server-Sent Events push changes to your browser instantly
- **Network Stats** - See connection counts by network type (IPv4, IPv6, Tor, I2P, CJDNS)
- **Connection History** - Track recently connected and disconnected peers
- **Web Dashboard** - Clean, responsive interface accessible from any device on your network

## Quick Start

```bash
# Clone the repository
git clone https://github.com/mbhillrn/MBCore-Dashboard.git
cd MBCore-Dashboard

# Run the dashboard
./da.sh
```

The script will:
1. Check for required dependencies (and offer to install missing ones)
2. Auto-detect your Bitcoin Core installation
3. Launch the web dashboard

Then open your browser to the displayed URL (typically `http://localhost:58333`).

## Requirements

- Bitcoin Core (bitcoind running)
- Python 3.8+
- Standard tools: `jq`, `curl`, `sqlite3`

All Python dependencies are installed automatically into a local virtual environment (`./venv/`).

## Project Structure

```
MBCore-Dashboard/
├── da.sh              # Main entry point
├── lib/               # Shell libraries (UI, config, prereqs)
├── scripts/           # Detection and terminal tools
├── web/               # FastAPI server and frontend
├── data/              # Local database and config (created on first run)
└── docs/              # Documentation
```

## License

MIT License - Free to use, modify, and distribute.

## Support

If you find this useful, consider a small donation:

**Bitcoin:** `bc1qy63057zemrskq0n02avq9egce4cpuuenm5ztf5`

---

*Created by mbhillrn with Claude's help*
