#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
#  MBTC-DASH - Bitcoin Core Dashboard
#  A monitoring and management interface for Bitcoin Core
# ═══════════════════════════════════════════════════════════════════════════════

set -e

# Get the directory where this script lives
MBTC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export MBTC_DIR

# Source libraries
source "$MBTC_DIR/lib/ui.sh"
source "$MBTC_DIR/lib/prereqs.sh"
source "$MBTC_DIR/lib/config.sh"

# Read version from VERSION file
VERSION=$(cat "$MBTC_DIR/VERSION" 2>/dev/null || echo "0.0.0")
GITHUB_REPO="mbhillrn/Bitcoin-Core-Peer-Map"
GITHUB_VERSION_URL="https://raw.githubusercontent.com/$GITHUB_REPO/main/VERSION"
GITHUB_CHANGES_URL="https://raw.githubusercontent.com/$GITHUB_REPO/main/CHANGES"
GEOIP_REPO="mbhillrn/Bitcoin-Node-GeoIP-Dataset"
GEOIP_DB_URL="https://raw.githubusercontent.com/$GEOIP_REPO/main/geo.db"
UPDATE_AVAILABLE=0
LATEST_VERSION=""
LATEST_CHANGES=""

# Venv paths
VENV_DIR="$MBTC_DIR/venv"
VENV_PYTHON="$VENV_DIR/bin/python3"

# ═══════════════════════════════════════════════════════════════════════════════
# CTRL+C HANDLING
# ═══════════════════════════════════════════════════════════════════════════════

CTRL_C_COUNT=0
CTRL_C_TIME=0

handle_ctrl_c() {
    local now
    now=$(date +%s)

    if (( now - CTRL_C_TIME > 2 )); then
        CTRL_C_COUNT=0
    fi

    CTRL_C_TIME=$now
    ((CTRL_C_COUNT++))

    if [[ $CTRL_C_COUNT -eq 1 ]]; then
        echo ""
        msg_warn "Press Ctrl+C again to quit"
    else
        echo ""
        msg_info "Goodbye!"
        cursor_show
        exit 0
    fi
}

trap handle_ctrl_c SIGINT

# ═══════════════════════════════════════════════════════════════════════════════
# BANNER
# ═══════════════════════════════════════════════════════════════════════════════

show_banner() {
    # First call during startup skips clear so user can scroll up through
    # prereqs/update check. All subsequent calls (returning from submenus) clear.
    if [[ "${FIRST_MENU_DISPLAY:-0}" -eq 1 ]]; then
        FIRST_MENU_DISPLAY=0
    else
        clear
    fi
    echo ""
    echo -e "${T_PRIMARY}"
    cat << 'EOF'
███╗   ███╗██████╗  ██████╗ ██████╗ ██████╗ ███████╗
████╗ ████║██╔══██╗██╔════╝██╔═══██╗██╔══██╗██╔════╝
██╔████╔██║██████╔╝██║     ██║   ██║██████╔╝█████╗
██║╚██╔╝██║██╔══██╗██║     ██║   ██║██╔══██╗██╔══╝
██║ ╚═╝ ██║██████╔╝╚██████╗╚██████╔╝██║  ██║███████╗
╚═╝     ╚═╝╚═════╝  ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝
EOF
    echo -e "${RST}"
    echo -e "  ${T_WHITE}Dashboard${RST}  ${T_DIM}v${VERSION}${RST} ${T_WHITE}(Bitcoin Core peer info/map/tools)${RST}"
    echo -e "  ────────────────────────────────────────────────────"
    echo -e "  ${T_DIM}Created by mbhillrn${RST}"
    echo -e "  ${T_DIM}MIT License - Free to use, modify, and distribute${RST}"
    echo ""
}

# ═══════════════════════════════════════════════════════════════════════════════
# STATUS DISPLAY
# ═══════════════════════════════════════════════════════════════════════════════

show_status() {
    echo ""
    echo -e "${T_SECONDARY}${BOLD}Current Configuration${RST}"
    echo ""

    if [[ "$MBTC_CONFIGURED" -eq 1 ]]; then
        print_kv "Bitcoin CLI" "${MBTC_CLI_PATH:-not set}" 16
        print_kv "Data Directory" "${MBTC_DATADIR:-not set}" 16
        print_kv "Network" "${MBTC_NETWORK:-main}" 16
        print_kv "RPC" "${MBTC_RPC_HOST:-127.0.0.1}:${MBTC_RPC_PORT:-8332}" 16

        # Show auth method
        if [[ -n "$MBTC_COOKIE_PATH" && -f "$MBTC_COOKIE_PATH" ]]; then
            print_kv "Auth" "Cookie" 16
        elif [[ -n "$MBTC_RPC_USER" ]]; then
            print_kv "Auth" "RPC User ($MBTC_RPC_USER)" 16
        else
            print_kv "Auth" "Default" 16
        fi

        # Quick RPC test
        if test_rpc 2>/dev/null; then
            echo ""
            msg_ok "Bitcoin Core is running and responding"
        else
            echo ""
            msg_warn "Bitcoin Core not responding (is bitcoind running?)"
        fi
    else
        msg_warn "Not configured - run detection first"
    fi
    echo ""
}

# ═══════════════════════════════════════════════════════════════════════════════
# MAIN MENU
# ═══════════════════════════════════════════════════════════════════════════════

show_menu() {
    echo ""
    echo -e "${T_SECONDARY}${BOLD}Main Menu${RST}"
    echo ""
    echo -e "  ${T_INFO}1)${RST} Enter MBCore Web Dashboard"
    echo -e "     ${T_DIM}- Bitcoin Core peer info/map/tools${RST}"
    echo -e "     ${T_DIM}- Instructions on access viewable on the next page!${RST}"
    echo -e "  ${T_INFO}2)${RST} Reset MBCore Config"
    echo -e "     ${T_DIM}- Clear saved configuration${RST}"
    echo -e "  ${T_INFO}3)${RST} Firewall Helper"
    echo -e "     ${T_DIM}- Configure firewall for network access${RST}"
    echo ""
    echo -e "  ${T_DIM}─────────────────────────────────────────────────────────────${RST}"
    echo ""
    echo -e "  ${T_SECONDARY}g)${RST} Geo/IP Database     ${T_DIM}- Configure IP location database${RST}"
    echo -e "  ${T_SECONDARY}m)${RST} Manual Settings     ${T_DIM}- Manually enter Bitcoin Core settings${RST}"
    echo -e "  ${T_SECONDARY}n)${RST} Network/Port        ${T_DIM}- Server security and port settings${RST}"
    if [[ "$UPDATE_AVAILABLE" -eq 1 ]]; then
        echo -e "  ${T_WARN}u)${RST} Update              ${T_DIM}- Update to v${LATEST_VERSION}${RST}"
    fi
    echo ""
    echo -e "  ${T_ERROR}q)${RST} Quit"
    echo ""
}

run_web_dashboard() {
    if [[ "$MBTC_CONFIGURED" -ne 1 ]]; then
        msg_err "Bitcoin Core not configured. Run detection first."
        echo ""
        echo -en "${T_DIM}Press Enter to continue...${RST}"
        read -r
        return
    fi

    # Check if web packages are available
    if ! is_web_available; then
        msg_err "Web dashboard packages not installed"
        msg_info "Please run the prerequisites check to install web packages"
        echo ""
        echo -en "${T_DIM}Press Enter to continue...${RST}"
        read -r
        return
    fi

    # Check internet connectivity with countdown
    MBTC_OFFLINE_START=0
    if ! check_connectivity_countdown; then
        show_offline_warning
    fi

    # Only do geo DB download if we're online
    if [[ "$MBTC_OFFLINE_START" -eq 0 ]]; then
        local geo_auto_update geo_db_enabled
        geo_auto_update=$(get_config "GEO_DB_AUTO_UPDATE" "false")
        geo_db_enabled=$(get_config "GEO_DB_ENABLED" "false")
        if [[ "$geo_db_enabled" == "true" ]]; then
            local geo_db_file="$MBTC_DIR/data/geo.db"
            if [[ -f "$geo_db_file" ]]; then
                local db_count
                db_count=$(sqlite3 "$geo_db_file" "SELECT COUNT(*) FROM geo_cache" 2>/dev/null || echo "0")
                msg_ok "Geo/IP Database: ${db_count} cached entries"
            fi
            if [[ "$geo_auto_update" == "true" ]]; then
                msg_info "Checking for Geo/IP Database updates..."
                if ! download_geoip_dataset; then
                    msg_warn "Bitcoin Node GeoIP Dataset is not currently available"
                    echo -e "  ${T_DIM}Your local database will cache peers you discover.${RST}"
                fi
                sleep 1
            fi
        fi
    else
        # Offline — show DB status but skip download
        local geo_db_enabled
        geo_db_enabled=$(get_config "GEO_DB_ENABLED" "false")
        if [[ "$geo_db_enabled" == "true" ]]; then
            local geo_db_file="$MBTC_DIR/data/geo.db"
            if [[ -f "$geo_db_file" ]]; then
                local db_count
                db_count=$(sqlite3 "$geo_db_file" "SELECT COUNT(*) FROM geo_cache" 2>/dev/null || echo "0")
                msg_ok "Geo/IP Database: ${db_count} cached entries (offline — skipping update)"
            fi
        fi
    fi

    # Run web server using venv, pass offline flag
    clear
    MBTC_OFFLINE_START="$MBTC_OFFLINE_START" "$VENV_PYTHON" "$MBTC_DIR/web/MBCoreServer.py"
}

run_detection() {
    local rc=0
    "$MBTC_DIR/scripts/detect.sh" || rc=$?
    # Propagate user abort (Ctrl+C) instead of swallowing it
    if [[ $rc -eq 130 ]]; then
        exit 130
    fi
    # Reload config after detection (|| true: don't crash under set -e if config missing)
    load_config 2>/dev/null || true
}

run_manual_config() {
    clear
    show_banner

    echo ""
    echo -e "${T_SECONDARY}${BOLD}Manual Configuration${RST}"
    echo ""
    echo -e "${T_DIM}Enter the paths to your Bitcoin Core configuration.${RST}"
    echo -e "${T_DIM}(After entering these, the rest will be auto-detected)${RST}"
    echo -e "${T_DIM}(You may enter * to go back to detection, or just press Enter to use the example path)${RST}"
    echo ""

    # Try to detect a default conf path
    local default_conf=""
    if [[ -f "/srv/bitcoin/bitcoin.conf" ]]; then
        default_conf="/srv/bitcoin/bitcoin.conf"
    elif [[ -f "$HOME/.bitcoin/bitcoin.conf" ]]; then
        default_conf="$HOME/.bitcoin/bitcoin.conf"
    elif [[ -f "/etc/bitcoin/bitcoin.conf" ]]; then
        default_conf="/etc/bitcoin/bitcoin.conf"
    fi

    # Ask for bitcoin.conf path
    local conf_path=""
    while true; do
        if [[ -n "$default_conf" ]]; then
            echo -en "${T_INFO}Location of bitcoin.conf${RST} ${T_DIM}(ex: ${default_conf}):${RST} "
        else
            echo -en "${T_INFO}Location of bitcoin.conf:${RST} "
        fi
        read -r conf_path

        # Handle * to go back
        if [[ "$conf_path" == "*" ]]; then
            run_detection
            return
        fi

        # Use default if just Enter pressed
        if [[ -z "$conf_path" && -n "$default_conf" ]]; then
            conf_path="$default_conf"
        fi

        conf_path="${conf_path/#\~/$HOME}"

        if [[ -z "$conf_path" ]]; then
            msg_err "Please enter a path"
        elif [[ -f "$conf_path" ]]; then
            msg_ok "Found: $conf_path"
            break
        else
            msg_err "File not found: $conf_path"
        fi
    done

    # Ask for datadir (optional if we can find it)
    local datadir=""
    local conf_dir
    conf_dir=$(dirname "$conf_path")

    if [[ -d "$conf_dir/blocks" ]] || [[ -f "$conf_dir/.cookie" ]]; then
        echo ""
        echo -e "${T_INFO}Detected datadir:${RST} $conf_dir"
        if prompt_yn "Use this as data directory?"; then
            datadir="$conf_dir"
        fi
    fi

    if [[ -z "$datadir" ]]; then
        echo ""
        # Use conf_dir as the example/default
        local default_datadir="$conf_dir"

        while true; do
            echo -en "${T_INFO}Location of Bitcoin Core data directory${RST} ${T_DIM}(ex: ${default_datadir}):${RST} "
            read -r datadir

            # Handle * to go back
            if [[ "$datadir" == "*" ]]; then
                run_detection
                return
            fi

            # Use default if just Enter pressed
            if [[ -z "$datadir" ]]; then
                datadir="$default_datadir"
            fi

            datadir="${datadir/#\~/$HOME}"

            if [[ -d "$datadir" ]]; then
                msg_ok "Found: $datadir"
                break
            else
                msg_err "Directory not found: $datadir"
            fi
        done
    fi

    # Set the manual values
    MBTC_CONF="$conf_path"
    MBTC_DATADIR="$datadir"

    # Now run detection to fill in the rest (CLI, network, auth, etc.)
    echo ""
    echo -e "${T_SECONDARY}${BOLD}Auto-detecting remaining settings...${RST}"

    # Source detection script functions
    source "$MBTC_DIR/scripts/detect.sh"

    # Detect CLI
    if detect_bitcoin_cli; then
        msg_ok "Found bitcoin-cli: $MBTC_CLI_PATH"
    fi

    # Parse config file for network settings
    if [[ -f "$MBTC_CONF" ]]; then
        parse_conf_file "$MBTC_CONF"
    fi

    # Find cookie
    find_cookie
    if [[ -n "$MBTC_COOKIE_PATH" && -f "$MBTC_COOKIE_PATH" ]]; then
        msg_ok "Found cookie auth: $MBTC_COOKIE_PATH"
    fi

    # Test RPC
    echo ""
    if test_rpc; then
        msg_ok "RPC connection successful!"
    else
        msg_warn "RPC connection failed - bitcoind may not be running"
    fi

    # Save config
    save_config
    msg_ok "Configuration saved!"

    echo ""
    echo -en "${T_DIM}Press Enter to continue...${RST}"
    read -r
}

reset_config() {
    echo ""
    echo -e "${T_SECONDARY}${BOLD}Reset Options${RST}"
    echo ""
    echo -e "  ${T_INFO}1)${RST} Reset settings only (keep database)"
    echo -e "     ${T_DIM}Clears configuration, keeps your geo/IP database intact${RST}"
    echo ""
    echo -e "  ${T_WARN}2)${RST} Reset everything (settings + database)"
    echo -e "     ${T_DIM}Clears configuration AND deletes the geo/IP database${RST}"
    echo ""
    echo -e "  ${T_DIM}b)${RST} Back"
    echo ""
    echo -en "${T_DIM}Choice:${RST} "
    read -r reset_choice

    case "$reset_choice" in
        1)
            echo ""
            if prompt_yn "Reset all settings? (database will be kept)"; then
                clear_config
                msg_ok "Configuration cleared (database preserved)"
            else
                msg_info "Cancelled"
            fi
            ;;
        2)
            echo ""
            if prompt_yn "Reset settings AND delete the geo/IP database?"; then
                clear_config
                rm -f "$MBTC_DIR/data/geo.db"
                msg_ok "Configuration and database cleared"
            else
                msg_info "Cancelled"
            fi
            ;;
        b|B|"")
            return
            ;;
        *)
            msg_warn "Invalid option"
            ;;
    esac
    echo ""
    echo -en "${T_DIM}Press Enter to continue...${RST}"
    read -r
}

reset_database() {
    echo ""
    local db_path="$MBTC_DIR/data/geo.db"
    if [[ -f "$db_path" ]]; then
        if prompt_yn "Are you sure you want to clear the geolocation database?"; then
            rm -f "$db_path"
            msg_ok "Geo/IP database cleared"
        else
            msg_info "Cancelled"
        fi
    else
        msg_info "No geolocation database found to clear"
    fi
    echo ""
    echo -en "${T_DIM}Press Enter to continue...${RST}"
    read -r
}

# ═══════════════════════════════════════════════════════════════════════════════
# GEO/IP DATABASE DOWNLOAD
# ═══════════════════════════════════════════════════════════════════════════════

# Download or merge the Bitcoin Node GeoIP Dataset into local geo.db
# Returns: 0 = success, 1 = download failed, 2 = no new data
download_geoip_dataset() {
    local geo_db_file="$MBTC_DIR/data/geo.db"
    local tmp_db="$MBTC_DIR/data/geo_download.tmp"
    local local_count=0 remote_count=0 new_count=0

    mkdir -p "$MBTC_DIR/data"

    # Count local entries if DB exists
    if [[ -f "$geo_db_file" ]]; then
        local_count=$(sqlite3 "$geo_db_file" "SELECT COUNT(*) FROM geo_cache" 2>/dev/null || echo "0")
    fi

    # Download remote database
    if ! curl -sL --connect-timeout 10 --max-time 60 -o "$tmp_db" "$GEOIP_DB_URL" 2>/dev/null; then
        rm -f "$tmp_db"
        return 1
    fi

    # Validate downloaded file is a real SQLite database
    if ! sqlite3 "$tmp_db" "SELECT COUNT(*) FROM geo_cache" &>/dev/null; then
        rm -f "$tmp_db"
        return 1
    fi

    remote_count=$(sqlite3 "$tmp_db" "SELECT COUNT(*) FROM geo_cache" 2>/dev/null || echo "0")

    if [[ "$remote_count" -eq 0 ]]; then
        rm -f "$tmp_db"
        return 2
    fi

    if [[ ! -f "$geo_db_file" ]]; then
        # No local DB - just use the downloaded one
        mv "$tmp_db" "$geo_db_file"
        msg_ok "Downloaded Geo/IP Database (${remote_count} entries)"
        return 0
    fi

    # Merge: INSERT OR IGNORE keeps local entries, adds new ones from remote
    # Newer timestamp wins for existing entries
    new_count=$(sqlite3 "$geo_db_file" "
        ATTACH '$tmp_db' AS remote;
        INSERT OR IGNORE INTO geo_cache SELECT * FROM remote.geo_cache;
        SELECT changes();
    " 2>/dev/null || echo "0")

    rm -f "$tmp_db"

    local total_count
    total_count=$(sqlite3 "$geo_db_file" "SELECT COUNT(*) FROM geo_cache" 2>/dev/null || echo "0")

    if [[ "$new_count" -gt 0 ]]; then
        msg_ok "Database updated (+${new_count} new entries, ${total_count} total)"
    else
        msg_ok "Database is up to date (${total_count} entries)"
    fi
    return 0
}

# ═══════════════════════════════════════════════════════════════════════════════
# INTERNET CONNECTIVITY CHECK
# ═══════════════════════════════════════════════════════════════════════════════

check_connectivity_countdown() {
    # Ping google.com with a 5-second countdown.
    # Returns immediately on success. Returns 1 if all 5 seconds pass.
    echo -n "  Checking connection... "
    for i in 5 4 3 2 1; do
        # Try a quick 1-second ping to google
        if curl -s --connect-timeout 1 --max-time 1 -o /dev/null "https://www.google.com" 2>/dev/null; then
            echo -e "${T_OK}Connected${RST}"
            return 0
        fi
        echo -n "${i} "
    done
    echo -e "${T_ERROR}No connection${RST}"
    return 1
}

show_offline_warning() {
    # Show warning when internet is unavailable at startup
    # Sets MBTC_OFFLINE_START=1 if user continues without connection
    local geo_db_enabled
    geo_db_enabled=$(get_config "GEO_DB_ENABLED" "false")

    clear
    echo ""
    echo -e "${T_WARN}${BOLD}═══════════════════════════════════════════════════════════════${RST}"
    echo -e "${T_WARN}${BOLD}  Warning: Cannot reach the internet${RST}"
    echo -e "${T_WARN}${BOLD}═══════════════════════════════════════════════════════════════${RST}"
    echo ""

    if [[ "$geo_db_enabled" == "true" ]]; then
        echo -e "  ${T_OK}Geo/IP Database: ENABLED ✓${RST}"
        echo ""
        echo -e "  ${T_DIM}Your local database will be used for known addresses.${RST}"
        echo -e "  ${T_DIM}Newly discovered IP addresses will not be geolocated${RST}"
        echo -e "  ${T_DIM}until an internet connection is available.${RST}"
        echo ""
        echo -e "  ${T_DIM}Database settings: Geo/IP Database Settings (option g)${RST}"
    else
        echo -e "  ${T_DIM}Without internet access, peer locations${RST}"
        echo -e "  ${T_DIM}will be limited or unavailable.${RST}"
        echo ""
        echo -e "  ${T_INFO}We strongly recommend enabling the Geo/IP Database.${RST}"
        echo -e "  ${T_INFO}This caches location data for known Bitcoin nodes${RST}"
        echo -e "  ${T_INFO}and greatly improves performance.${RST}"
        echo ""
        echo -e "  ${T_DIM}You can enable this in: Geo/IP Database Settings (option g)${RST}"
    fi
    echo ""
    echo -e "  ${T_DIM}If continuing without a connection, the dashboard will${RST}"
    echo -e "  ${T_DIM}continue to retry connection during operation.${RST}"
    echo ""
    echo -e "  ${T_SECONDARY}[R]${RST} Retry connection    ${T_SECONDARY}[Enter]${RST} Continue"
    echo ""

    while true; do
        read -r -n1 choice
        case "$choice" in
            r|R)
                echo ""
                if check_connectivity_countdown; then
                    msg_ok "Connection restored!"
                    MBTC_OFFLINE_START=0
                    sleep 1
                    return 0
                else
                    show_offline_warning
                    return $?
                fi
                ;;
            "")
                MBTC_OFFLINE_START=1
                return 0
                ;;
        esac
    done
}

# ═══════════════════════════════════════════════════════════════════════════════
# GEOLOCATION DATABASE SETTINGS
# ═══════════════════════════════════════════════════════════════════════════════

show_geo_db_settings() {
    local geo_db_enabled
    local geo_db_auto_update
    local geo_db_file="$MBTC_DIR/data/geo.db"

    geo_db_enabled=$(get_config "GEO_DB_ENABLED" "false")
    geo_db_auto_update=$(get_config "GEO_DB_AUTO_UPDATE" "true")

    clear
    show_banner
    echo ""
    echo -e "${T_INFO}${BOLD}═══════════════════════════════════════════════════════════════${RST}"
    echo -e "${T_INFO}${BOLD}  Geo/IP Database Settings${RST}"
    echo -e "${T_INFO}${BOLD}═══════════════════════════════════════════════════════════════${RST}"
    echo ""

    # Show database status
    if [[ "$geo_db_enabled" == "true" ]]; then
        echo -e "  ${T_OK}Database Status: ENABLED${RST}"
    else
        echo -e "  ${T_WARN}Database Status: DISABLED${RST}"
    fi

    # Show database stats if it exists
    if [[ -f "$geo_db_file" ]]; then
        local entries size_kb
        entries=$(sqlite3 "$geo_db_file" "SELECT COUNT(*) FROM geo_cache" 2>/dev/null || echo "0")
        size_kb=$(du -k "$geo_db_file" 2>/dev/null | cut -f1)
        echo -e "  ${T_DIM}Entries: ${entries} | Size: ${size_kb} KB${RST}"
    else
        echo -e "  ${T_DIM}Database file does not exist yet${RST}"
    fi
    echo ""
    echo -e "${T_DIM}─────────────────────────────────────────────────────────────────${RST}"
    echo ""

    # Menu options
    if [[ "$geo_db_enabled" == "true" ]]; then
        local auto_status=$([ "$geo_db_auto_update" == "true" ] && echo "ON" || echo "OFF")
        echo -e "  ${T_INFO}1)${RST} Toggle auto-update on start: ${T_SECONDARY}${auto_status}${RST}"
        echo -e "     ${T_DIM}(Currently: ${auto_status} - Select 1 to toggle)${RST}"
        echo ""
        echo -e "  ${T_INFO}2)${RST} Update database now"
        echo -e "     ${T_DIM}(Manually fetch latest entries)${RST}"
        echo ""
        echo -e "  ${T_INFO}3)${RST} Reset database"
        echo -e "     ${T_DIM}(Delete all cached data and start fresh)${RST}"
        echo ""
        echo -e "  ${T_WARN}4)${RST} Disable database"
        echo -e "     ${T_DIM}(Rely on API only)${RST}"
        echo ""
        echo -e "  ${T_INFO}5)${RST} Check database integrity"
        echo -e "     ${T_DIM}(Verify database file is not corrupted)${RST}"
        echo ""
        echo -e "  ${T_SECONDARY}6)${RST} [ADVANCED] Purge old entries"
        echo -e "     ${T_DIM}(Remove entries older than a specified number of days)${RST}"
    else
        echo -e "  ${T_OK}1)${RST} Enable geolocation database"
        echo -e "     ${T_DIM}(Recommended - provides faster location lookups)${RST}"
    fi
    echo ""
    echo -e "  ${T_SECONDARY}0)${RST} Back to Main Menu"
    echo ""

    read -r -p "Enter choice: " choice

    case "$choice" in
        1)
            if [[ "$geo_db_enabled" == "true" ]]; then
                # Toggle auto-update
                if [[ "$geo_db_auto_update" == "true" ]]; then
                    set_config "GEO_DB_AUTO_UPDATE" "false"
                    msg_ok "Auto-update disabled"
                else
                    set_config "GEO_DB_AUTO_UPDATE" "true"
                    msg_ok "Auto-update enabled"
                fi
            else
                # Enable database
                set_config "GEO_DB_ENABLED" "true"
                set_config "GEO_DB_AUTO_UPDATE" "true"
                msg_ok "Geo/IP database enabled"
            fi
            sleep 1
            show_geo_db_settings
            ;;
        2)
            if [[ "$geo_db_enabled" == "true" ]]; then
                echo ""
                msg_info "Downloading Bitcoin Node GeoIP Dataset..."
                if ! download_geoip_dataset; then
                    msg_warn "Bitcoin Node GeoIP Dataset is not currently available"
                    echo -e "  ${T_DIM}Your local database will still cache peers you discover.${RST}"
                fi
                echo ""
                echo -en "${T_DIM}Press Enter to continue...${RST}"
                read -r
                show_geo_db_settings
            fi
            ;;
        3)
            if [[ "$geo_db_enabled" == "true" ]]; then
                echo ""
                if prompt_yn "Are you sure you want to reset the database?"; then
                    rm -f "$geo_db_file"
                    msg_ok "Database reset - will rebuild as you discover peers"
                else
                    msg_info "Cancelled"
                fi
                sleep 1
                show_geo_db_settings
            fi
            ;;
        4)
            if [[ "$geo_db_enabled" == "true" ]]; then
                set_config "GEO_DB_ENABLED" "false"
                msg_ok "Geo/IP database disabled"
                sleep 1
                show_geo_db_settings
            fi
            ;;
        5)
            if [[ "$geo_db_enabled" == "true" ]]; then
                echo ""
                if [[ -f "$geo_db_file" ]]; then
                    msg_info "Checking database integrity..."
                    local integrity
                    integrity=$(sqlite3 "$geo_db_file" "PRAGMA integrity_check" 2>&1)
                    if [[ "$integrity" == "ok" ]]; then
                        msg_ok "Database integrity check passed"
                    else
                        msg_err "Database integrity check failed: $integrity"
                    fi
                else
                    msg_info "No database file to check"
                fi
                echo ""
                echo -en "${T_DIM}Press Enter to continue...${RST}"
                read -r
                show_geo_db_settings
            fi
            ;;
        6)
            if [[ "$geo_db_enabled" == "true" ]]; then
                show_advanced_purge
            fi
            ;;
        0|"")
            return
            ;;
        *)
            show_geo_db_settings
            ;;
    esac
}

show_first_run_db_setup() {
    # Check if database has already been configured (GEO_DB_ENABLED key exists in config)
    if has_config "GEO_DB_ENABLED"; then
        return 0
    fi

    clear
    show_banner
    echo ""
    echo -e "${T_INFO}${BOLD}═══════════════════════════════════════════════════════════════${RST}"
    echo -e "${T_INFO}${BOLD}  Geo/IP Database Setup${RST}"
    echo -e "${T_INFO}${BOLD}═══════════════════════════════════════════════════════════════${RST}"
    echo ""
    echo -e "  ${T_DIM}The Geo/IP Database caches location data for Bitcoin nodes.${RST}"
    echo -e "  ${T_DIM}This reduces API calls and improves performance.${RST}"
    echo ""

    # On first boot, auto-choose option 1 (recommended)
    echo -e "  ${T_INFO}Enabling database with auto-updates (recommended)...${RST}"
    echo ""
    set_config "GEO_DB_ENABLED" "true"
    set_config "GEO_DB_AUTO_UPDATE" "true"
    msg_ok "Database enabled with auto-updates"
    echo ""
    msg_info "Downloading Bitcoin Node GeoIP Dataset..."
    if ! download_geoip_dataset; then
        echo ""
        msg_warn "Bitcoin Node GeoIP Dataset is not currently available"
        echo -e "  ${T_DIM}Will attempt again on dashboard startup.${RST}"
        echo -e "  ${T_DIM}Your local database will cache peers you discover.${RST}"
        echo -e "  ${T_DIM}Change settings via: Geo/IP Database Settings (option g) in the main menu${RST}"
    fi
    echo ""
    sleep 1
}

show_advanced_purge() {
    local geo_db_file="$MBTC_DIR/data/geo.db"

    clear
    echo ""
    echo -e "${T_WARN}${BOLD}═══════════════════════════════════════════════════════════════${RST}"
    echo -e "${T_WARN}${BOLD}  [ADVANCED] Purge Old Entries${RST}"
    echo -e "${T_WARN}${BOLD}═══════════════════════════════════════════════════════════════${RST}"
    echo ""
    echo -e "  ${T_DIM}Remove entries from the geo database that haven't been${RST}"
    echo -e "  ${T_DIM}updated in a specified number of days.${RST}"
    echo ""

    if [[ -f "$geo_db_file" ]]; then
        local entries oldest_ts now age_days
        entries=$(sqlite3 "$geo_db_file" "SELECT COUNT(*) FROM geo_cache" 2>/dev/null || echo "0")
        oldest_ts=$(sqlite3 "$geo_db_file" "SELECT MIN(last_updated) FROM geo_cache" 2>/dev/null || echo "")
        now=$(date +%s)

        echo -e "  ${T_INFO}Current entries:${RST} ${entries}"
        if [[ -n "$oldest_ts" && "$oldest_ts" != "NULL" && "$oldest_ts" -gt 0 ]] 2>/dev/null; then
            age_days=$(( (now - oldest_ts) / 86400 ))
            echo -e "  ${T_INFO}Oldest entry:${RST} ${age_days} days old"
        fi
        echo ""
    else
        echo -e "  ${T_DIM}No database file found.${RST}"
        echo ""
        echo -en "${T_DIM}Press Enter to go back...${RST}"
        read -r
        show_geo_db_settings
        return
    fi

    echo -e "${T_DIM}─────────────────────────────────────────────────────────────────${RST}"
    echo ""
    echo -en "  ${T_INFO}Purge entries older than how many days?${RST} (or 'b' to go back): "
    read -r purge_days

    if [[ "$purge_days" == "b" || "$purge_days" == "B" || -z "$purge_days" ]]; then
        show_geo_db_settings
        return
    fi

    # Validate input is a number
    if [[ ! "$purge_days" =~ ^[0-9]+$ ]]; then
        msg_err "Please enter a valid number"
        sleep 1
        show_advanced_purge
        return
    fi

    if [[ "$purge_days" -eq 0 ]]; then
        msg_err "Cannot purge entries 0 days old (that would delete everything)"
        sleep 1
        show_advanced_purge
        return
    fi

    local cutoff_ts=$(( $(date +%s) - (purge_days * 86400) ))
    local to_delete
    to_delete=$(sqlite3 "$geo_db_file" "SELECT COUNT(*) FROM geo_cache WHERE last_updated < $cutoff_ts" 2>/dev/null || echo "0")

    if [[ "$to_delete" -eq 0 ]]; then
        echo ""
        msg_info "No entries older than ${purge_days} days found"
        echo ""
        echo -en "${T_DIM}Press Enter to continue...${RST}"
        read -r
        show_geo_db_settings
        return
    fi

    echo ""
    echo -e "  ${T_WARN}This will delete ${to_delete} entries older than ${purge_days} days.${RST}"
    echo ""
    if prompt_yn "Continue?"; then
        sqlite3 "$geo_db_file" "DELETE FROM geo_cache WHERE last_updated < $cutoff_ts" 2>/dev/null
        local remaining
        remaining=$(sqlite3 "$geo_db_file" "SELECT COUNT(*) FROM geo_cache" 2>/dev/null || echo "0")
        msg_ok "Purged ${to_delete} entries (${remaining} remaining)"
    else
        msg_info "Cancelled"
    fi

    echo ""
    echo -en "${T_DIM}Press Enter to continue...${RST}"
    read -r
    show_geo_db_settings
}

# ═══════════════════════════════════════════════════════════════════════════════
# FIREWALL HELPER
# ═══════════════════════════════════════════════════════════════════════════════

get_local_network_info() {
    # Get primary local IP and subnet
    local ip_info
    ip_info=$(ip -4 addr show 2>/dev/null | grep -oP 'inet \K[0-9./]+' | grep -v '^127\.' | head -1)

    if [[ -n "$ip_info" ]]; then
        LOCAL_IP="${ip_info%/*}"
        local prefix="${ip_info#*/}"

        # Calculate network address from IP and prefix
        if [[ "$prefix" =~ ^[0-9]+$ ]] && [[ "$prefix" -ge 8 ]] && [[ "$prefix" -le 30 ]]; then
            IFS='.' read -ra ip_parts <<< "$LOCAL_IP"
            local mask=$(( 0xFFFFFFFF << (32 - prefix) ))
            local net_int=$(( (ip_parts[0] << 24) | (ip_parts[1] << 16) | (ip_parts[2] << 8) | ip_parts[3] ))
            net_int=$(( net_int & mask ))
            LOCAL_SUBNET="$(( (net_int >> 24) & 0xFF )).$(( (net_int >> 16) & 0xFF )).$(( (net_int >> 8) & 0xFF )).$(( net_int & 0xFF ))/$prefix"
        else
            # Fallback: assume /24 for common home networks
            IFS='.' read -ra ip_parts <<< "$LOCAL_IP"
            LOCAL_SUBNET="${ip_parts[0]}.${ip_parts[1]}.${ip_parts[2]}.0/24"
        fi
    else
        LOCAL_IP="127.0.0.1"
        LOCAL_SUBNET="192.168.0.0/16"
    fi
}

firewall_helper() {
    clear
    show_banner

    echo ""
    echo -e "${T_SECONDARY}${BOLD}Firewall Helper${RST}"
    echo ""
    echo -e "${T_DIM}This tool helps you configure your firewall to allow network access${RST}"
    echo -e "${T_DIM}to the MBCore Dashboard from other computers on your local network.${RST}"
    echo ""

    # Get network info
    get_local_network_info
    local port="${MBTC_WEB_PORT:-58333}"

    echo -e "${T_INFO}Detected Network Info:${RST}"
    echo -e "  Your IP:        ${T_SUCCESS}$LOCAL_IP${RST}"
    echo -e "  Your Subnet:    ${T_SUCCESS}$LOCAL_SUBNET${RST}"
    echo -e "  Dashboard Port: ${T_SUCCESS}$port${RST}"
    echo ""
    echo -e "${T_DIM}Want to use a different port? Go to ${T_SECONDARY}n) Network/Port${RST}${T_DIM} from the main menu${RST}"
    echo -e "${T_DIM}to change the dashboard port, then come back here to configure the firewall.${RST}"
    echo ""

    # Check for UFW
    if command -v ufw &>/dev/null; then
        local ufw_status
        ufw_status=$(sudo ufw status 2>/dev/null)
        local ufw_status_line
        ufw_status_line=$(echo "$ufw_status" | head -1)

        if [[ "$ufw_status_line" == *"active"* ]]; then
            echo -e "${T_SUCCESS}✓${RST} UFW firewall detected and ${T_SUCCESS}active${RST}"
            echo ""

            # Check if port 58333 is already allowed
            if echo "$ufw_status" | grep -qE "$port/(tcp|udp)|$port\s+ALLOW"; then
                echo -e "${T_SUCCESS}✓${RST} Port $port is ${T_SUCCESS}already allowed${RST} in your firewall!"
                echo ""
                echo -e "${T_DIM}Current rules for port $port:${RST}"
                echo "$ufw_status" | grep -E "$port" | while read -r line; do
                    echo -e "  ${T_DIM}$line${RST}"
                done
                echo ""
                echo -e "${T_INFO}You're all set! The dashboard should be accessible from your network.${RST}"
                echo -e "  ${T_SUCCESS}http://$LOCAL_IP:$port${RST}"
                echo ""
                echo -e "${T_DIM}To remove the rule later, run:${RST}"
                echo -e "  ${T_DIM}sudo ufw delete allow from $LOCAL_SUBNET to any port $port proto tcp${RST}"
                echo -e "  ${T_DIM}  - or -${RST}"
                echo -e "  ${T_DIM}sudo ufw delete allow $port/tcp${RST}"
            else
                echo -e "${T_WARN}⚠${RST} Port $port is ${T_WARN}not yet allowed${RST} in your firewall"
                echo ""
                echo -e "${T_INFO}I can add a firewall rule to allow dashboard access.${RST}"
                echo ""
                echo -e "  ${T_DIM}This command will be run:${RST}"
                echo -e "  ${T_WARN}sudo ufw allow from $LOCAL_SUBNET to any port $port proto tcp${RST}"
                echo ""
                echo -e "${T_DIM}This allows computers on your local network ($LOCAL_SUBNET) to connect.${RST}"
                echo ""
                echo -e "${T_DIM}To remove later, run:${RST}"
                echo -e "  ${T_DIM}sudo ufw delete allow from $LOCAL_SUBNET to any port $port proto tcp${RST}"
                echo ""

                if prompt_yn "Add this firewall rule now?"; then
                    echo ""
                    if sudo ufw allow from "$LOCAL_SUBNET" to any port "$port" proto tcp; then
                        echo ""
                        msg_ok "Firewall rule added successfully!"
                        echo ""
                        echo -e "${T_INFO}You can now access the dashboard from other computers at:${RST}"
                        echo -e "  ${T_SUCCESS}http://$LOCAL_IP:$port${RST}"
                    else
                        echo ""
                        msg_err "Failed to add firewall rule"
                    fi
                else
                    msg_info "Cancelled"
                fi
            fi

        elif [[ "$ufw_status_line" == *"inactive"* ]]; then
            echo -e "${T_WARN}⚠${RST} UFW firewall detected but ${T_WARN}inactive${RST}"
            echo ""
            echo -e "${T_DIM}Since UFW is not active, you likely don't need to configure it.${RST}"
            echo -e "${T_DIM}The dashboard should be accessible from your network already.${RST}"
            echo ""
            echo -e "${T_INFO}If you want to enable UFW later, here's the command to allow the dashboard:${RST}"
            echo -e "  ${T_WARN}sudo ufw allow from $LOCAL_SUBNET to any port $port proto tcp${RST}"
        else
            echo -e "${T_WARN}⚠${RST} UFW detected but status unclear"
            echo ""
            echo -e "${T_DIM}Run 'sudo ufw status' to check your firewall status.${RST}"
            echo ""
            echo -e "${T_INFO}If you need to allow dashboard access, run:${RST}"
            echo -e "  ${T_WARN}sudo ufw allow from $LOCAL_SUBNET to any port $port proto tcp${RST}"
        fi
    else
        # UFW not found
        echo -e "${T_INFO}ℹ${RST} Common firewall (UFW) not detected"
        echo ""
        echo -e "${T_DIM}You may not have a firewall enabled, so the dashboard should work fine.${RST}"
        echo ""
        echo -e "${T_DIM}If you know you have a firewall, please open port ${T_WARN}$port/tcp${T_DIM} manually.${RST}"
        echo ""
        echo -e "${T_INFO}If you install UFW later, use this command:${RST}"
        echo -e "  ${T_WARN}sudo ufw allow from $LOCAL_SUBNET to any port $port proto tcp${RST}"
    fi

    echo ""
    echo -en "${T_DIM}Press Enter to continue...${RST}"
    read -r
}

# ═══════════════════════════════════════════════════════════════════════════════
# NETWORK / PORT / SERVER SETTINGS
# ═══════════════════════════════════════════════════════════════════════════════

network_settings() {
    clear
    show_banner

    local current_port="${MBTC_WEB_PORT:-58333}"
    local current_bind
    current_bind=$(get_config "MBTC_WEB_BIND" "0.0.0.0")
    local bind_label
    if [[ "$current_bind" == "127.0.0.1" ]]; then
        bind_label="Local only (127.0.0.1)"
    else
        bind_label="LAN accessible (0.0.0.0)"
    fi

    echo ""
    echo -e "${T_SECONDARY}${BOLD}Network Server/Security and Port Settings${RST}"
    echo ""
    echo -e "  ${T_INFO}Current port:${RST}    ${T_SUCCESS}$current_port${RST}"
    echo -e "  ${T_INFO}Access mode:${RST}     ${T_SUCCESS}$bind_label${RST}"
    echo ""
    echo -e "  ${T_INFO}1)${RST} Change port"
    echo -e "  ${T_INFO}2)${RST} Reset port to default (58333)"
    echo -e "  ${T_INFO}3)${RST} Server Access Mode"
    echo -e "     ${T_DIM}- Local only vs LAN security settings${RST}"
    echo -e "  ${T_DIM}b)${RST} Back to menu"
    echo ""

    echo -en "${T_DIM}Choice:${RST} "
    read -r net_choice

    case "$net_choice" in
        1)
            echo ""
            echo -e "${T_DIM}Port numbers can range from 1024 to 65535.${RST}"
            echo -e "${T_DIM}Higher numbers (49152-65535) are recommended to avoid conflicts.${RST}"
            echo -e "${T_DIM}Suggested alternatives: 58334, 58335, 49152, 51234, 60000${RST}"
            echo ""
            while true; do
                echo -en "${T_INFO}Enter new port number (1024-65535):${RST} "
                read -r new_port

                # Allow 'b' to go back
                if [[ "$new_port" == "b" || "$new_port" == "B" ]]; then
                    return
                fi

                # Validate port number
                if [[ ! "$new_port" =~ ^[0-9]+$ ]]; then
                    msg_err "Please enter a valid number"
                    continue
                fi

                if [[ "$new_port" -lt 1024 || "$new_port" -gt 65535 ]]; then
                    msg_err "Port must be between 1024 and 65535"
                    continue
                fi

                # Warn if using common ports
                if [[ "$new_port" -lt 49152 ]]; then
                    echo ""
                    msg_warn "Ports below 49152 may conflict with other services"
                    if ! prompt_yn "Use port $new_port anyway?"; then
                        continue
                    fi
                fi

                # Set and save the new port
                MBTC_WEB_PORT="$new_port"
                save_config
                echo ""
                msg_ok "Port changed to $new_port"
                msg_info "This setting will persist across reboots and updates"
                break
            done
            ;;
        2)
            MBTC_WEB_PORT="58333"
            save_config
            echo ""
            msg_ok "Port reset to default (58333)"
            ;;
        3)
            server_access_mode
            return
            ;;
        b|B)
            return
            ;;
        *)
            msg_warn "Invalid option"
            ;;
    esac

    echo ""
    echo -en "${T_DIM}Press Enter to continue...${RST}"
    read -r
}

server_access_mode() {
    clear
    show_banner

    local current_bind
    current_bind=$(get_config "MBTC_WEB_BIND" "0.0.0.0")

    echo ""
    echo -e "${T_SECONDARY}${BOLD}Server Access Mode${RST}"
    echo ""
    echo -e "${T_DIM}Controls which network interfaces the dashboard listens on.${RST}"
    echo ""

    # Show current setting
    if [[ "$current_bind" == "127.0.0.1" ]]; then
        echo -e "  ${T_INFO}Current:${RST} ${T_SUCCESS}Local only (127.0.0.1)${RST}"
    else
        echo -e "  ${T_INFO}Current:${RST} ${T_SUCCESS}LAN accessible (0.0.0.0)${RST}"
    fi
    echo ""

    echo -e "  ${T_INFO}1)${RST} Local only (127.0.0.1)"
    echo -e "     ${T_DIM}- Dashboard is only accessible from a browser on this machine${RST}"
    echo -e "     ${T_DIM}- Optional extra security measure — no network exposure at all${RST}"
    echo ""
    echo -e "  ${T_INFO}2)${RST} LAN accessible (0.0.0.0)"
    echo -e "     ${T_DIM}- Dashboard is accessible from any device on your local network${RST}"
    echo -e "     ${T_DIM}- Required for headless nodes — access from another machine's browser${RST}"
    echo -e "     ${T_DIM}- Use the Firewall Helper (Option 3) to restrict access if needed${RST}"
    echo ""
    echo -e "  ${T_DIM}b)${RST} Back"
    echo ""

    echo -en "${T_DIM}Choice:${RST} "
    read -r access_choice

    case "$access_choice" in
        1)
            set_config "MBTC_WEB_BIND" "127.0.0.1"
            echo ""
            msg_ok "Access mode set to Local only (127.0.0.1)"
            msg_info "Dashboard will only be accessible from this machine"
            ;;
        2)
            set_config "MBTC_WEB_BIND" "0.0.0.0"
            echo ""
            msg_ok "Access mode set to LAN accessible (0.0.0.0)"
            msg_info "Dashboard will be accessible from any device on your network"
            ;;
        b|B)
            return
            ;;
        *)
            msg_warn "Invalid option"
            ;;
    esac

    echo ""
    echo -en "${T_DIM}Press Enter to continue...${RST}"
    read -r
}

# ═══════════════════════════════════════════════════════════════════════════════
# VERSION CHECK AND AUTO-UPDATE
# ═══════════════════════════════════════════════════════════════════════════════

check_for_updates() {
    UPDATE_AVAILABLE=0
    LATEST_VERSION=""
    LATEST_CHANGES=""

    # Only check if curl is available
    if ! command -v curl &>/dev/null; then
        return 1
    fi

    # Fetch the VERSION file from GitHub (with 3 second timeout)
    # Cache-bust to avoid stale CDN responses from raw.githubusercontent.com
    local remote_version
    remote_version=$(curl -s --connect-timeout 3 --max-time 10 "${GITHUB_VERSION_URL}?cb=$(date +%s)" 2>/dev/null | tr -d '[:space:]')

    if [[ -z "$remote_version" ]]; then
        return 1
    fi

    # Compare versions (simple string comparison works for semver)
    if [[ "$remote_version" != "$VERSION" ]]; then
        # Check if remote is newer (compare major.minor.patch)
        local IFS='.'
        read -ra local_parts <<< "$VERSION"
        read -ra remote_parts <<< "$remote_version"

        for i in 0 1 2; do
            local lp=${local_parts[$i]:-0}
            local rp=${remote_parts[$i]:-0}
            if (( rp > lp )); then
                LATEST_VERSION="$remote_version"
                UPDATE_AVAILABLE=1
                # Fetch release notes (non-blocking, ok if it fails)
                LATEST_CHANGES=$(curl -s --connect-timeout 3 --max-time 5 "$GITHUB_CHANGES_URL" 2>/dev/null | head -3)
                return 0
            elif (( rp < lp )); then
                return 0
            fi
        done
    fi

    return 0
}

show_update_banner() {
    if [[ "$UPDATE_AVAILABLE" -eq 1 ]]; then
        echo ""
        echo -e "  ${T_WARN}⚡ Update available!${RST} ${T_DIM}v${VERSION} → v${LATEST_VERSION}${RST}"
        echo -e "  ${T_DIM}Run option 'u' from the menu to update${RST}"
    fi
}

run_update() {
    echo ""
    echo -e "${T_SECONDARY}${BOLD}Updating MBCore Dashboard...${RST}"
    echo ""

    # Check if we're in a git repo
    if [[ ! -d "$MBTC_DIR/.git" ]]; then
        msg_err "Not a git repository. Please update manually:"
        echo ""
        echo -e "  ${T_DIM}cd $MBTC_DIR${RST}"
        echo -e "  ${T_DIM}git pull origin main${RST}"
        echo ""
        echo -en "${T_DIM}Press Enter to continue...${RST}"
        read -r
        return 0
    fi

    # Check for uncommitted changes
    cd "$MBTC_DIR" || return 0

    if ! git diff-index --quiet HEAD -- 2>/dev/null; then
        msg_warn "You have uncommitted changes. Stashing them..."
        git stash || true
    fi

    # Pull the latest changes (with retry on failure)
    while true; do
        echo -e "${T_INFO}Pulling latest changes from GitHub...${RST}"
        if git pull origin main; then
            msg_ok "Update successful!"
            echo ""
            msg_info "Automatically restarting with new version..."
            sleep 1
            # Restart the script with the new version using absolute path
            exec "$MBTC_DIR/da.sh"
        else
            echo ""
            msg_err "Update failed! (git pull returned an error)"
            echo ""
            echo -e "  ${T_INFO}1)${RST} Retry update"
            echo -e "  ${T_INFO}2)${RST} Continue to main menu without updating"
            echo ""
            echo -en "${T_DIM}Choice:${RST} "
            read -r retry_choice
            case "$retry_choice" in
                1)
                    echo ""
                    msg_info "Retrying..."
                    echo ""
                    continue
                    ;;
                *)
                    msg_info "You can update later by pressing 'u' in the menu"
                    sleep 1
                    return 0
                    ;;
            esac
        fi
    done
}

# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════

main() {
    show_banner

    # Check prerequisites
    if ! run_prereq_check; then
        msg_err "Cannot continue without required prerequisites"
        echo ""
        echo -en "${T_DIM}Press Enter to exit...${RST}"
        read -r
        exit 1
    fi

    # Check if config exists — first boot auto-detects without prompts
    if [[ "$MBTC_CONFIGURED" -ne 1 ]]; then
        echo ""
        msg_info "No MBCore configuration found. Running Bitcoin Core detection..."
        sleep 1
        export MBTC_AUTO_DETECT=1
        run_detection
        # Reload config — if detection failed, tell user to use manual
        load_config 2>/dev/null || true
        if [[ "$MBTC_CONFIGURED" -ne 1 ]]; then
            echo ""
            msg_warn "Detection could not fully configure Bitcoin Core."
            msg_info "Use ${T_SECONDARY}m) Manual Settings${RST} from the main menu to enter paths manually."
            sleep 2
        fi
        unset MBTC_AUTO_DETECT
    fi

    # Check for updates (synchronous, always visible)
    echo ""
    echo -e "${T_DIM}Checking for updates...${RST}"
    if check_for_updates; then
        if [[ "$UPDATE_AVAILABLE" -eq 1 ]]; then
            echo ""
            echo -e "  ${T_WARN}═══════════════════════════════════════════════════════════${RST}"
            echo -e "  ${T_WARN}⚡ UPDATE AVAILABLE!${RST}"
            echo -e "  ${T_DIM}Your version:${RST}   v${VERSION}"
            echo -e "  ${T_SUCCESS}Latest version:${RST} v${LATEST_VERSION}"
            if [[ -n "$LATEST_CHANGES" ]]; then
                echo -e "  ${T_WARN}───────────────────────────────────────────────────────────${RST}"
                while IFS= read -r line; do
                    echo -e "  ${T_DIM}${line}${RST}"
                done <<< "$LATEST_CHANGES"
            fi
            echo -e "  ${T_WARN}═══════════════════════════════════════════════════════════${RST}"
            echo ""
            if prompt_yn "Would you like to update now?"; then
                run_update
            else
                msg_info "You can update later by pressing 'u' in the menu"
                sleep 1
            fi
        else
            msg_ok "Running latest version (v${VERSION})"
        fi
    else
        msg_warn "Could not check for updates (no internet connection?)"
    fi

    # First-run database setup prompt (only shown once)
    show_first_run_db_setup

    # Main loop (first iteration preserves startup scrollback)
    FIRST_MENU_DISPLAY=1
    while true; do
        show_banner
        show_update_banner
        show_status
        show_menu

        echo -en "${T_DIM}Choice:${RST} "
        read -r choice

        case "$choice" in
            1)
                run_web_dashboard
                ;;
            2)
                reset_config
                ;;
            3|f|F)
                firewall_helper
                ;;
            g|G)
                show_geo_db_settings
                ;;
            m|M)
                run_manual_config
                ;;
            n|N)
                network_settings
                ;;
            u|U)
                if [[ "$UPDATE_AVAILABLE" -eq 1 ]]; then
                    run_update
                else
                    msg_info "Already running the latest version (v${VERSION})"
                    sleep 1
                fi
                ;;
            q|Q)
                echo ""
                msg_info "Goodbye!"
                exit 0
                ;;
            *)
                msg_warn "Invalid option"
                sleep 0.5
                ;;
        esac
    done
}

main "$@"
