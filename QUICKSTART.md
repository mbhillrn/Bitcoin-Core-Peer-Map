# MBCore Dashboard — Quick Start Guide

## Install and Run

```bash
git clone https://github.com/mbhillrn/Bitcoin-Core-Peer-Map.git
cd Bitcoin-Core-Peer-Map
./da.sh
```

On first run, the script handles everything automatically: prerequisites, Python virtual environment, Bitcoin Core detection, and GeoIP database setup.

![Prerequisites and Setup](docs/images/2.prereqs.png)

You'll land at the main menu. Press **1** to launch the dashboard:

![Main Menu](docs/images/5.menu.png)

The terminal shows your access URLs:

![Dashboard Launch](docs/images/6.banner.png)

Open the URL in your browser:

![MBCore Dashboard](docs/images/1.hero1.png)

---

## How to Access the Dashboard

### Same Machine (has a browser)

Run `./da.sh`, press **1** — the URL is `http://127.0.0.1:58333`.

### Another Device on Your Network

1. Run `./da.sh` on the machine with Bitcoin Core
2. Note the LAN IP shown on the launch screen
3. From any device on your network, browse to `http://[that-ip]:58333`

**Can't connect?** Your firewall is probably blocking port 58333. Use the **Firewall Helper** (option **3** from the main menu).

### SSH Tunnel (remote access)

```bash
ssh -L 58333:127.0.0.1:58333 user@remote-machine
```

Then run `./da.sh` in that SSH session and browse to `http://127.0.0.1:58333` on your local machine.

---

## Quick Reference

| Situation | How to Access |
|-----------|---------------|
| GUI machine | `./da.sh` → `http://127.0.0.1:58333` |
| Headless + LAN | `./da.sh` → `http://[ip-on-screen]:58333` from any device |
| SSH tunnel | `ssh -L 58333:... user@host` → `./da.sh` → `http://127.0.0.1:58333` locally |

---

## At a Glance

| Area | What's There |
|------|-------------|
| **Top bar** | Network chips (IPv4/IPv6/Tor/I2P/CJDNS) with inbound/outbound counts |
| **Below top bar** | Live Bitcoin price (green = up, red = down) — click to change currency |
| **Upper left** | Peers, CPU, RAM, NET ↓/↑ — click for detailed system info |
| **Upper right** | Update countdown, geo status, Node Info link, MBCore DB link |
| **Map** | Full-screen canvas map with geolocated peer dots — click any dot for details |
| **Bottom panel** | Peer table with filters, sorting, resizing, connect/disconnect buttons |
| **Antarctica** | Private network peers (Tor, I2P, CJDNS) displayed at research stations |

---

## Key Files

| Item | Location |
|------|----------|
| Main script | `./da.sh` |
| Default port | **58333** (change via **p) Port Settings**) |
| Config | `data/config.conf` |
| GeoIP database | `data/geo.db` |
| Python venv | `./venv/` |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Can't connect from another device | **Firewall Helper** (option 3) or `sudo ufw allow 58333/tcp` |
| Page won't load | Close old browser tabs, check port with `ss -tlnp \| grep 58333` |
| Bitcoin Core not found | Make sure `bitcoind` is running, or use **m) Manual Settings** |

---

For full documentation, see the [README](README.md).
