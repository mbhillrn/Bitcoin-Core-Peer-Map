#!/usr/bin/env python3
"""
MBTC-DASH - FastAPI Web Server
Local web dashboard for Bitcoin Core peer monitoring

Features:
- Dynamic port selection (49152-65535)
- Single password auth for remote access
- Real-time updates via WebSocket
- Map with Leaflet.js
- All peer columns available
"""

import json
import os
import queue
import random
import secrets
import socket
import sqlite3
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

import requests
import uvicorn
from fastapi import FastAPI, Request, Depends, HTTPException, status
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from sse_starlette.sse import EventSourceResponse

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

REFRESH_INTERVAL = 10  # Seconds between peer refreshes
GEO_API_DELAY = 1.5    # Seconds between API calls
GEO_API_URL = "http://ip-api.com/json"
GEO_API_FIELDS = "status,country,countryCode,region,regionName,city,district,lat,lon,isp,as,hosting,query"
RECENT_WINDOW = 20     # Seconds for recent changes

# Port range for dynamic selection
PORT_RANGE_START = 49152
PORT_RANGE_END = 65535

# Paths
SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
DATA_DIR = PROJECT_DIR / 'data'
CONFIG_FILE = DATA_DIR / 'config.conf'
DB_FILE = DATA_DIR / 'peers.db'
STATIC_DIR = SCRIPT_DIR / 'static'
TEMPLATES_DIR = SCRIPT_DIR / 'templates'

# Geo status codes
GEO_OK = 0
GEO_PRIVATE = 1
GEO_UNAVAILABLE = 2

RETRY_INTERVALS = [86400, 259200, 604800, 604800]

# ═══════════════════════════════════════════════════════════════════════════════
# GLOBAL STATE
# ═══════════════════════════════════════════════════════════════════════════════

# FastAPI app
app = FastAPI(title="MBTC-DASH", description="Bitcoin Peer Dashboard")
security = HTTPBasic()
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

# Session password (generated on each startup)
SESSION_PASSWORD = ""

# Thread-safe state
current_peers = []
peers_lock = threading.Lock()

recent_changes = []
changes_lock = threading.Lock()

addrman_ips = set()
addrman_lock = threading.Lock()

geo_queue = queue.Queue()
pending_lookups = set()
pending_lock = threading.Lock()

stop_flag = threading.Event()

# SSE clients and update events
sse_update_event = threading.Event()
last_update_type = "connected"


# ═══════════════════════════════════════════════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════════════════════════════════════════════

class Config:
    def __init__(self):
        self.cli_path = "bitcoin-cli"
        self.datadir = ""
        self.conf = ""
        self.network = "main"

    def load(self) -> bool:
        if not CONFIG_FILE.exists():
            return False
        try:
            with open(CONFIG_FILE, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line.startswith('#') or '=' not in line:
                        continue
                    key, value = line.split('=', 1)
                    value = value.strip('"').strip("'")
                    if key == 'MBTC_CLI_PATH':
                        self.cli_path = value
                    elif key == 'MBTC_DATADIR':
                        self.datadir = value
                    elif key == 'MBTC_CONF':
                        self.conf = value
                    elif key == 'MBTC_NETWORK':
                        self.network = value
            return bool(self.cli_path)
        except Exception:
            return False

    def get_cli_command(self) -> list:
        cmd = [self.cli_path]
        if self.datadir:
            cmd.append(f"-datadir={self.datadir}")
        if self.conf:
            cmd.append(f"-conf={self.conf}")
        if self.network == "test":
            cmd.append("-testnet")
        elif self.network == "signet":
            cmd.append("-signet")
        elif self.network == "regtest":
            cmd.append("-regtest")
        return cmd


config = Config()


# ═══════════════════════════════════════════════════════════════════════════════
# DATABASE
# ═══════════════════════════════════════════════════════════════════════════════

def init_database():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_FILE)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS peers_geo (
            ip TEXT PRIMARY KEY,
            network_type TEXT,
            geo_status INTEGER DEFAULT 0,
            geo_retry_count INTEGER DEFAULT 0,
            geo_last_lookup INTEGER,
            country TEXT,
            country_code TEXT,
            region TEXT,
            region_name TEXT,
            city TEXT,
            district TEXT,
            lat REAL,
            lon REAL,
            isp TEXT,
            as_info TEXT,
            hosting INTEGER,
            first_seen INTEGER,
            last_seen INTEGER,
            connection_count INTEGER DEFAULT 1
        )
    ''')
    conn.commit()
    conn.close()


def get_peer_geo(ip: str) -> Optional[dict]:
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.execute('SELECT * FROM peers_geo WHERE ip = ?', (ip,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def upsert_peer_geo(ip: str, network_type: str, geo_status: int, **kwargs):
    now = int(time.time())
    conn = sqlite3.connect(DB_FILE)
    conn.execute('''
        INSERT INTO peers_geo (ip, network_type, geo_status, geo_last_lookup,
            country, country_code, region, region_name, city, district,
            lat, lon, isp, as_info, hosting, first_seen, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(ip) DO UPDATE SET
            geo_status = excluded.geo_status,
            geo_last_lookup = excluded.geo_last_lookup,
            country = COALESCE(NULLIF(excluded.country, ''), country),
            country_code = COALESCE(NULLIF(excluded.country_code, ''), country_code),
            region = COALESCE(NULLIF(excluded.region, ''), region),
            region_name = COALESCE(NULLIF(excluded.region_name, ''), region_name),
            city = COALESCE(NULLIF(excluded.city, ''), city),
            lat = CASE WHEN excluded.lat != 0 THEN excluded.lat ELSE lat END,
            lon = CASE WHEN excluded.lon != 0 THEN excluded.lon ELSE lon END,
            isp = COALESCE(NULLIF(excluded.isp, ''), isp),
            as_info = COALESCE(NULLIF(excluded.as_info, ''), as_info),
            hosting = excluded.hosting,
            last_seen = excluded.last_seen
    ''', (ip, network_type, geo_status, now,
          kwargs.get('country', ''), kwargs.get('country_code', ''),
          kwargs.get('region', ''), kwargs.get('region_name', ''),
          kwargs.get('city', ''), kwargs.get('district', ''),
          kwargs.get('lat', 0), kwargs.get('lon', 0),
          kwargs.get('isp', ''), kwargs.get('as_info', ''),
          kwargs.get('hosting', 0), now, now))
    conn.commit()
    conn.close()


def get_db_stats() -> dict:
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.execute('''
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN geo_status = 0 THEN 1 ELSE 0 END) as geo_ok,
            SUM(CASE WHEN geo_status = 1 THEN 1 ELSE 0 END) as private,
            SUM(CASE WHEN geo_status = 2 THEN 1 ELSE 0 END) as unavailable
        FROM peers_geo
    ''')
    row = cursor.fetchone()
    conn.close()
    return {'total': row[0] or 0, 'geo_ok': row[1] or 0,
            'private': row[2] or 0, 'unavailable': row[3] or 0}


# ═══════════════════════════════════════════════════════════════════════════════
# NETWORK UTILITIES
# ═══════════════════════════════════════════════════════════════════════════════

def get_network_type(addr: str) -> str:
    if '.onion' in addr:
        return 'onion'
    elif '.i2p' in addr:
        return 'i2p'
    elif addr.startswith('fc') or addr.startswith('fd'):
        return 'cjdns'
    elif ':' in addr and addr.count(':') > 1:
        return 'ipv6'
    return 'ipv4'


def is_private_ip(ip: str) -> bool:
    if ip.startswith('10.') or ip.startswith('192.168.'):
        return True
    if ip.startswith('172.'):
        try:
            if 16 <= int(ip.split('.')[1]) <= 31:
                return True
        except:
            pass
    if ip.startswith('127.') or ip == 'localhost':
        return True
    if ip.startswith('fe80:') or ip == '::1':
        return True
    return False


def is_public_address(network_type: str, ip: str) -> bool:
    return network_type in ('ipv4', 'ipv6') and not is_private_ip(ip)


def extract_ip(addr: str) -> str:
    if addr.startswith('['):
        return addr.split(']')[0][1:]
    elif ':' in addr and addr.count(':') <= 1:
        return addr.rsplit(':', 1)[0]
    return addr.split(':')[0] if ':' in addr else addr


def extract_port(addr: str) -> str:
    if addr.startswith('[') and ']:' in addr:
        return addr.split(']:')[1]
    elif ':' in addr and addr.count(':') <= 1:
        return addr.rsplit(':', 1)[1]
    return ""


def get_local_ips() -> list:
    """Get all local IP addresses"""
    ips = []
    try:
        # Get hostname IPs
        hostname = socket.gethostname()
        ips.append(socket.gethostbyname(hostname))

        # Try to get all interfaces
        import subprocess
        result = subprocess.run(['ip', '-4', 'addr', 'show'], capture_output=True, text=True)
        for line in result.stdout.split('\n'):
            if 'inet ' in line:
                ip = line.strip().split()[1].split('/')[0]
                if ip not in ips and not ip.startswith('127.'):
                    ips.append(ip)
    except:
        pass

    if not ips:
        ips.append('127.0.0.1')
    return ips


def find_available_port() -> int:
    """Find an available port in the ephemeral range"""
    for _ in range(100):
        port = random.randint(PORT_RANGE_START, PORT_RANGE_END)
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.bind(('', port))
            sock.close()
            return port
        except OSError:
            continue
    raise RuntimeError("Could not find available port")


# ═══════════════════════════════════════════════════════════════════════════════
# BITCOIN RPC
# ═══════════════════════════════════════════════════════════════════════════════

def get_peer_info() -> list:
    try:
        cmd = config.get_cli_command() + ['getpeerinfo']
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            return json.loads(result.stdout)
    except:
        pass
    return []


def refresh_addrman():
    global addrman_ips
    try:
        cmd = config.get_cli_command() + ['getnodeaddresses', '0']
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.returncode == 0:
            data = json.loads(result.stdout)
            new_ips = {e.get('address', '') for e in data if e.get('address')}
            with addrman_lock:
                addrman_ips = new_ips
    except:
        pass


def is_in_addrman(ip: str) -> bool:
    with addrman_lock:
        return ip in addrman_ips


# ═══════════════════════════════════════════════════════════════════════════════
# GEO LOOKUP
# ═══════════════════════════════════════════════════════════════════════════════

def fetch_geo_api(ip: str) -> Optional[dict]:
    try:
        url = f"{GEO_API_URL}/{ip}?fields={GEO_API_FIELDS}"
        response = requests.get(url, timeout=10)
        data = response.json()
        if data.get('status') == 'success':
            return data
    except:
        pass
    return None


def geo_worker():
    """Background thread for geo lookups"""
    while not stop_flag.is_set():
        try:
            ip, network_type = geo_queue.get(timeout=0.5)
        except queue.Empty:
            continue

        data = fetch_geo_api(ip)
        if data:
            upsert_peer_geo(ip, network_type, GEO_OK,
                           country=data.get('country', ''),
                           country_code=data.get('countryCode', ''),
                           region=data.get('region', ''),
                           region_name=data.get('regionName', ''),
                           city=data.get('city', ''),
                           lat=data.get('lat', 0),
                           lon=data.get('lon', 0),
                           isp=data.get('isp', ''),
                           as_info=data.get('as', ''),
                           hosting=1 if data.get('hosting') else 0)
        else:
            upsert_peer_geo(ip, network_type, GEO_UNAVAILABLE)

        with pending_lock:
            pending_lookups.discard(ip)

        broadcast_update('geo_update', {'ip': ip})
        time.sleep(GEO_API_DELAY)


def queue_geo_lookup(ip: str, network_type: str):
    with pending_lock:
        if ip in pending_lookups:
            return
        pending_lookups.add(ip)
    geo_queue.put((ip, network_type))


# ═══════════════════════════════════════════════════════════════════════════════
# DATA REFRESH
# ═══════════════════════════════════════════════════════════════════════════════

def refresh_worker():
    """Background thread for periodic data refresh"""
    global current_peers, recent_changes
    previous_ids = set()

    while not stop_flag.is_set():
        peers = get_peer_info()

        with peers_lock:
            current_peers = peers

        # Track changes
        current_ids = set()
        now = time.time()

        for peer in peers:
            peer_id = str(peer.get('id', ''))
            current_ids.add(peer_id)
            addr = peer.get('addr', '')
            network_type = peer.get('network', get_network_type(addr))
            ip = extract_ip(addr)

            if peer_id not in previous_ids and previous_ids:
                with changes_lock:
                    recent_changes.append((now, 'connected', {'ip': ip, 'port': extract_port(addr), 'network': network_type}))

            if is_public_address(network_type, ip):
                geo = get_peer_geo(ip)
                if not geo:
                    queue_geo_lookup(ip, network_type)
            else:
                geo = get_peer_geo(ip)
                if not geo:
                    upsert_peer_geo(ip, network_type, GEO_PRIVATE)

        for pid in previous_ids - current_ids:
            with changes_lock:
                recent_changes.append((now, 'disconnected', {'ip': f'peer#{pid}', 'network': '?'}))

        # Prune old changes
        with changes_lock:
            recent_changes = [(t, c, p) for t, c, p in recent_changes if now - t < RECENT_WINDOW]

        previous_ids = current_ids

        # Refresh addrman
        refresh_addrman()

        # Broadcast update
        broadcast_update('peers_update', {})

        time.sleep(REFRESH_INTERVAL)


# ═══════════════════════════════════════════════════════════════════════════════
# WEBSOCKET
# ═══════════════════════════════════════════════════════════════════════════════

def broadcast_update(event_type: str, data: dict):
    """Signal SSE clients of update"""
    global last_update_type
    last_update_type = event_type
    sse_update_event.set()


# ═══════════════════════════════════════════════════════════════════════════════
# AUTH
# ═══════════════════════════════════════════════════════════════════════════════

def verify_password(credentials: HTTPBasicCredentials = Depends(security)):
    """Verify the session password"""
    if credentials.password != SESSION_PASSWORD:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid password",
            headers={"WWW-Authenticate": "Basic"},
        )
    return True


# ═══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

def format_bytes(b: int) -> str:
    """Format bytes to human readable string"""
    if b < 1024:
        return f"{b}B"
    elif b < 1024 * 1024:
        return f"{b / 1024:.1f}KB"
    elif b < 1024 * 1024 * 1024:
        return f"{b / (1024 * 1024):.1f}MB"
    else:
        return f"{b / (1024 * 1024 * 1024):.2f}GB"


# ═══════════════════════════════════════════════════════════════════════════════
# API ROUTES
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/peers")
async def api_peers(auth: bool = Depends(verify_password)):
    """Get all current peers with full data"""
    with peers_lock:
        peers_snapshot = list(current_peers)

    result = []
    for peer in peers_snapshot:
        addr = peer.get('addr', '')
        network_type = peer.get('network', get_network_type(addr))
        ip = extract_ip(addr)
        port = extract_port(addr)
        geo = get_peer_geo(ip)

        # Determine location status
        if network_type in ('onion', 'i2p', 'cjdns') or is_private_ip(ip):
            location_status = 'private'
            location = 'PRIVATE LOCATION'
        elif geo and geo['geo_status'] == GEO_OK and geo.get('city'):
            location_status = 'ok'
            location = f"{geo['city']}, {geo['country_code']}"
        elif geo and geo['geo_status'] == GEO_UNAVAILABLE:
            location_status = 'unavailable'
            location = 'LOCATION UNAVAILABLE'
        else:
            location_status = 'pending'
            location = 'Stalking location...'

        # Services abbreviation
        services = peer.get('servicesnames', [])
        services_abbrev = ' '.join([s[0] if s else '' for s in services[:5]])

        # Connection time formatted
        conntime = peer.get('conntime', 0)
        if conntime:
            elapsed = int(time.time()) - conntime
            if elapsed < 3600:
                conn_fmt = f"{elapsed // 60}m"
            elif elapsed < 86400:
                conn_fmt = f"{elapsed // 3600}h {(elapsed % 3600) // 60}m"
            else:
                conn_fmt = f"{elapsed // 86400}d {(elapsed % 86400) // 3600}h"
        else:
            conn_fmt = "-"

        result.append({
            'id': peer.get('id'),
            'ip': ip,
            'port': port,
            'addr': addr,
            'direction': 'IN' if peer.get('inbound') else 'OUT',
            'network': network_type,
            'in_addrman': is_in_addrman(ip),
            'location': location,
            'location_status': location_status,
            'country': geo.get('country', '') if geo else '',
            'country_code': geo.get('country_code', '') if geo else '',
            'region': geo.get('region_name', '') if geo else '',
            'city': geo.get('city', '') if geo else '',
            'lat': geo.get('lat', 0) if geo else 0,
            'lon': geo.get('lon', 0) if geo else 0,
            'isp': geo.get('isp', '') if geo else '',
            'as_info': geo.get('as_info', '') if geo else '',
            'hosting': geo.get('hosting', 0) if geo else 0,
            'geo_status': geo.get('geo_status', -1) if geo else -1,
            'first_seen': geo.get('first_seen', 0) if geo else 0,
            'last_seen': geo.get('last_seen', 0) if geo else 0,
            'version': peer.get('version', 0),
            'subver': peer.get('subver', '').replace('/', ''),
            'ping_ms': int((peer.get('pingtime') or 0) * 1000),
            'minping_ms': int((peer.get('minping') or 0) * 1000),
            'bytessent': peer.get('bytessent', 0),
            'bytesrecv': peer.get('bytesrecv', 0),
            'bytessent_fmt': format_bytes(peer.get('bytessent', 0)),
            'bytesrecv_fmt': format_bytes(peer.get('bytesrecv', 0)),
            'lastsend': peer.get('lastsend', 0),
            'lastrecv': peer.get('lastrecv', 0),
            'conntime': conntime,
            'conntime_fmt': conn_fmt,
            'services': services,
            'services_abbrev': services_abbrev,
            'connection_type': peer.get('connection_type', ''),
            'addr_relay_enabled': peer.get('addr_relay_enabled', False),
            'addr_rate_limited': peer.get('addr_rate_limited', 0),
        })

    return result


@app.get("/api/changes")
async def api_changes(auth: bool = Depends(verify_password)):
    """Get recent peer changes"""
    with changes_lock:
        changes = list(recent_changes)
    return [{'time': t, 'type': c, 'peer': p} for t, c, p in changes]


@app.get("/api/stats")
async def api_stats(auth: bool = Depends(verify_password)):
    """Get dashboard statistics"""
    with peers_lock:
        peers_snapshot = list(current_peers)

    peer_count = len(peers_snapshot)
    with pending_lock:
        pending = len(pending_lookups)

    # Count by network type
    network_counts = {'ipv4': 0, 'ipv6': 0, 'onion': 0, 'i2p': 0, 'cjdns': 0}
    for peer in peers_snapshot:
        addr = peer.get('addr', '')
        network = peer.get('network', get_network_type(addr))
        if network in network_counts:
            network_counts[network] += 1

    db_stats = get_db_stats()

    return {
        'connected': peer_count,
        'pending_geo': pending,
        **db_stats,
        **network_counts,
        'addrman_size': len(addrman_ips),
        'last_update': datetime.now().strftime('%H:%M:%S'),
    }


@app.get("/api/events")
async def api_events(request: Request):
    """Server-Sent Events endpoint for real-time updates"""

    async def event_generator():
        global last_update_type
        # Send initial connected message
        yield {"event": "message", "data": json.dumps({"type": "connected"})}

        while True:
            # Check if client disconnected
            if await request.is_disconnected():
                break

            # Wait for update event or timeout for keepalive
            if sse_update_event.wait(timeout=15):
                sse_update_event.clear()
                yield {"event": "message", "data": json.dumps({"type": last_update_type})}
            else:
                # Send keepalive
                yield {"event": "message", "data": json.dumps({"type": "keepalive"})}

    return EventSourceResponse(event_generator())


@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    """Serve the main dashboard page"""
    return templates.TemplateResponse("index.html", {"request": request})


# Mount static files
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════

import asyncio

def main():
    global SESSION_PASSWORD

    # Initialize
    init_database()

    if not config.load():
        print("Error: Configuration not found. Run ./da.sh first to configure.")
        sys.exit(1)

    # Generate session password
    SESSION_PASSWORD = secrets.token_urlsafe(16)

    # Find available port
    port = find_available_port()

    # Get local IPs
    local_ips = get_local_ips()

    # Start background threads
    geo_thread = threading.Thread(target=geo_worker, daemon=True)
    geo_thread.start()

    refresh_thread = threading.Thread(target=refresh_worker, daemon=True)
    refresh_thread.start()

    # Initial data fetch
    refresh_addrman()

    # Print access info
    print("\n" + "=" * 60)
    print("  MBTC-DASH Web Dashboard")
    print("=" * 60)
    print(f"\n  Password for this session: {SESSION_PASSWORD}")
    print(f"\n  Access URLs:")
    print(f"    Local:    http://127.0.0.1:{port}")
    for ip in local_ips:
        if ip != '127.0.0.1':
            print(f"    LAN:      http://{ip}:{port}")
    print(f"\n  Username: (any)")
    print(f"  Password: {SESSION_PASSWORD}")
    print("\n  Press Ctrl+C to stop")
    print("=" * 60 + "\n")

    # Run server
    try:
        uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
    except KeyboardInterrupt:
        pass
    finally:
        stop_flag.set()
        print("\nShutting down...")


if __name__ == "__main__":
    main()
