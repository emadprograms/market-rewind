import streamlit as st
import pandas as pd
import numpy as np
import time
import datetime
import os
import pytz
from streamlit_js_eval import streamlit_js_eval
from lightweight_charts.widgets import StreamlitChart
from libsql_client import create_client_sync, ClientSync

# ========================================
# 1. PAGE CONFIG
# ========================================
st.set_page_config(
    layout="wide",
    page_title="Market Rewind",
    initial_sidebar_state="collapsed"
)

# ========================================
# 2. CSS STYLING
# ========================================
st.markdown("""
    <style>
        /* Reduce padding around the main block */
        .block-container {
            padding-top: 3rem;
            padding-bottom: 0rem;
            padding-left: 1rem;
            padding-right: 1rem;
        }
        
        /* Tighten vertical gaps between elements */
        div[data-testid="stVerticalBlock"] > div {
            gap: 0.5rem;
        }
        
        /* Better alignment for the playback buttons */
        div.stButton > button {
            width: 100%;
            border-radius: 4px;
        }
        
        /* Centered Global Time Display */
        .global-time {
            text-align: center;
            font-size: 1.2rem;
            font-weight: 600;
            color: #4CAF50; /* Green highlight for time */
            margin-bottom: 10px;
            font-family: monospace;
        }
        
        /* Error Message Styling for Missing Data */
        .no-data-msg {
            text-align: center;
            color: #ef5350;
            font-weight: bold;
            margin-bottom: 10px;
        }
        
        /* Sidebar Status */
        .db-status-ok {
            padding: 10px;
            background-color: #d4edda;
            color: #155724;
            border-radius: 5px;
            border: 1px solid #c3e6cb;
            text-align: center;
            font-weight: bold;
        }
    </style>
""", unsafe_allow_html=True)

# ========================================
# 3. DATABASE CONNECTION & HELPERS
# ========================================
@st.cache_resource
def get_db_connection():
    """
    Establishes a connection to the Turso (LibSQL) database.
    Performs a strict connectivity check.
    """
    try:
        # 1. Credentials
        if "turso" in st.secrets:
            url = st.secrets["turso"]["db_url"]
            token = st.secrets["turso"]["auth_token"]
        else:
            url = os.environ.get("TURSO_DB_URL")
            token = os.environ.get("TURSO_AUTH_TOKEN")

        if not url or not token:
            st.error("❌ CRITICAL: Missing Turso DB credentials (Secrets/Env Vars).")
            st.stop()

        # 2. Connection Logic
        http_url = url.replace("libsql://", "https://")
        config = {"url": http_url, "auth_token": token}
        
        client = create_client_sync(**config)
        
        # 3. Connectivity Check (The 'Ping')
        try:
            client.execute("SELECT 1")
        except Exception as ping_error:
            st.error(f"❌ DATABASE CONNECTION FAILED.\n\nCould not execute handshake query.\nError: {ping_error}")
            st.stop()
            
        return client

    except Exception as e:
        st.error(f"❌ DATABASE INITIALIZATION ERROR: {e}")
        st.stop()
        return None

@st.cache_data
def get_available_tickers(_client: ClientSync):
    """
    Fetches the list of available tickers from the symbol_map table.
    """
    try:
        rs = _client.execute("SELECT user_ticker FROM symbol_map ORDER BY user_ticker;")
        return [row["user_ticker"] for row in rs.rows]
    except Exception as e:
        st.error(f"Failed to fetch tickers: {e}")
        return []

@st.cache_data
def load_master_data(_client: ClientSync, ticker: str, earliest_date_str: str, include_eth: bool):
    """
    Loads raw 1-minute data from the database.
    Includes explicit error reporting for debugging data issues.
    """
    try:
        if include_eth:
            query = """
                SELECT timestamp, open, high, low, close, volume 
                FROM market_data 
                WHERE symbol = ? AND timestamp >= ?
                ORDER BY timestamp;
            """
            params = [ticker, earliest_date_str]
        else:
            query = """
                SELECT timestamp, open, high, low, close, volume 
                FROM market_data 
                WHERE symbol = ? AND session = 'REG' AND timestamp >= ?
                ORDER BY timestamp;
            """
            params = [ticker, earliest_date_str]
            
        rs = _client.execute(query, params)
        
    except Exception as e:
        # EXPLICIT ERROR REPORTING
        st.error(f"❌ DB READ ERROR for {ticker}: {e}")
        return pd.DataFrame()

    df = pd.DataFrame(rs.rows, columns=["timestamp", "open", "high", "low", "close", "volume"])
    
    if df.empty:
        # Debug info if data is missing but no error occurred
        # Only show this if specific dates (like 2024/2025) are expected but missing
        # st.warning(f"⚠️ Query returned 0 rows for {ticker} (>= {earliest_date_str}).")
        return df

    # Ensure timezone aware (UTC)
    # If the DB string format is weird, this line might fail, so we wrap it
    try:
        df['time'] = pd.to_datetime(df['timestamp'], utc=True)
        # Convert numeric columns
        for col in ['open', 'high', 'low', 'close', 'volume']:
            df[col] = pd.to_numeric(df[col])
    except Exception as parse_error:
        st.error(f"❌ DATA PARSING ERROR: {parse_error}")
        return pd.DataFrame()
    
    return df[['time', 'open', 'high', 'low', 'close', 'volume']]

def resample_data(df, timeframe):
    """
    Aggregates raw 1-minute data into larger candles (5Min, 15Min, 1Day, etc).
    """
    if df.empty:
        return pd.DataFrame(columns=['time', 'open', 'high', 'low', 'close', 'volume', 'color'])

    df = df.set_index('time')
    
    agg = {
        'open': 'first', 
        'high': 'max', 
        'low': 'min', 
        'close': 'last', 
        'volume': 'sum'
    }
    
    resampled = df.resample(timeframe).agg(agg).dropna().reset_index()
    
    # Apply color logic AFTER aggregation
    resampled['color'] = np.where(
        resampled['open'] > resampled['close'],
        'rgba(239, 83, 80, 0.8)',  # Red
        'rgba(38, 166, 154, 0.8)'   # Green
    )
    return resampled

# ========================================
# 4. CHART LAYOUT HELPER
# ========================================
def get_dynamic_chart_height(num_charts, viewport_height):
    """
    Calculates the height of each chart based on the window size.
    """
    if viewport_height is None or viewport_height <= 0:
        viewport_height = 900 

    reserved_top_px = 40 
    reserved_bottom_px = 120 # Space for control bar and time display

    usable = max(300, viewport_height - reserved_top_px - reserved_bottom_px)

    rows = 1 if num_charts <= 2 else 2
    per_chart = usable / rows

    return int(per_chart)

# ========================================
# 5. RENDER CHART UNIT (The Logic Core)
# ========================================
def render_chart_unit(chart_id, db_client, chart_height, global_dt, show_border=True, default_tf="1 Min", default_ticker=None):
    """
    Renders a single chart unit.
    Implements Dynamic Construction (Slice -> Resample) to prevent look-ahead bias.
    """
    # Unique keys for session state
    k_ticker = f"c{chart_id}_ticker"
    k_tf = f"c{chart_id}_tf"
    k_eth = f"c{chart_id}_eth" 
    k_view_mode = f"c{chart_id}_view_mode" 
    
    # --- Initialize Local State ---
    if k_ticker not in st.session_state:
        tickers = get_available_tickers(db_client)
        if default_ticker and default_ticker in tickers:
            st.session_state[k_ticker] = default_ticker
        else:
            st.session_state[k_ticker] = tickers[0] if tickers else ""
        
    if k_tf not in st.session_state:
        st.session_state[k_tf] = default_tf
        
    if k_eth not in st.session_state:
        st.session_state[k_eth] = False 
    
    if k_view_mode not in st.session_state:
        st.session_state[k_view_mode] = "Viewer Mode"

    # --- Render Controls ---
    with st.container(border=show_border):
        c1, c2, c3, c4, _ = st.columns([1.5, 1.5, 2.0, 1.0, 1.0])
        
        with c1:
            tickers = get_available_tickers(db_client)
            sel_ticker = st.selectbox(
                "Ticker", tickers, 
                key=k_ticker, 
                label_visibility="collapsed"
            )
        
        with c2:
            tf_map = {
                "1 Min": "1min", 
                "5 Min": "5min", 
                "15 Min": "15min", 
                "30 Min": "30min", 
                "1 Hr": "1H", 
                "1 Day": "1D"
            }
            sel_tf_str = st.selectbox(
                "TF", list(tf_map.keys()), 
                key=k_tf, 
                label_visibility="collapsed"
            )
            sel_tf_agg = tf_map[sel_tf_str]
        
        with c3:
            st.selectbox(
                "Mode", ["Viewer Mode", "Replay Mode"], 
                key=k_view_mode, 
                label_visibility="collapsed"
            )

        with c4:
            is_eth = st.toggle("ETH", key=k_eth)

        is_replay_mode = (st.session_state[k_view_mode] == "Replay Mode")

        # --- Data Loading (Raw 1-Min) ---
        EARLIEST = "2024-01-01"
        master_data_raw = load_master_data(db_client, sel_ticker, EARLIEST, is_eth)
        
        # Determine latest date for initial setup (runs once)
        if not master_data_raw.empty and "global_latest_db_date" not in st.session_state:
            st.session_state.global_latest_db_date = master_data_raw['time'].max().date()

        # --- Data Guard (Check if Date Exists) ---
        if not master_data_raw.empty:
            current_picker_date = st.session_state.get("global_picker_val", datetime.date.today())
            # Check if we have data for this specific day
            has_data_for_date = (master_data_raw['time'].dt.date == current_picker_date).any()
            if has_data_for_date:
                st.session_state.has_valid_data = True
        
        # Report Timeframe Delta (for Global Stepper)
        if "chart_deltas" not in st.session_state: 
            st.session_state.chart_deltas = {}
        st.session_state.chart_deltas[chart_id] = pd.to_timedelta(sel_tf_agg)

        # --- Dynamic Resampling Logic ---
        if not master_data_raw.empty:
            if is_replay_mode and global_dt is not None:
                # Filter raw data to current time
                sliced_raw = master_data_raw[master_data_raw['time'] <= global_dt]
                # Resample ONLY the visible data
                final_chart_data = resample_data(sliced_raw, sel_tf_agg)
            else:
                # Viewer Mode: Full Data
                final_chart_data = resample_data(master_data_raw, sel_tf_agg)
        else:
             final_chart_data = pd.DataFrame(columns=['time', 'open', 'high', 'low', 'close', 'volume', 'color'])

        # --- Chart Rendering ---
        try:
            chart = StreamlitChart(height=chart_height)
            chart.layout(background_color="#0f111a", text_color="#ffffff")
            chart.price_scale()
            chart.volume_config()

            # --- Visual Settings (Spacing & Offsets) ---
            if is_replay_mode:
                # Custom Spacing & Offset per Timeframe
                if sel_tf_str == "1 Min": 
                    spacing = 8.0
                    offset = 45
                elif sel_tf_str == "5 Min": 
                    spacing = 10.0
                    offset = 30
                elif sel_tf_str == "15 Min": 
                    spacing = 12.0
                    offset = 20
                elif sel_tf_str == "30 Min": 
                    spacing = 14.0
                    offset = 10 
                elif sel_tf_str == "1 Hr": 
                    spacing = 16.0
                    offset = 5
                elif sel_tf_str == "1 Day": 
                    spacing = 20.0
                    offset = 2 
                else: 
                    spacing = 10.0
                    offset = 20
            else:
                # Viewer Mode (Dense Overview)
                offset = 5
                if sel_tf_str == "1 Min": spacing = 0.5
                elif sel_tf_str == "5 Min": spacing = 2.0
                elif sel_tf_str == "15 Min": spacing = 4.0
                elif sel_tf_str == "30 Min": spacing = 7.0
                elif sel_tf_str == "1 Hr": spacing = 8.0
                elif sel_tf_str == "1 Day": spacing = 10.0
                else: spacing = 5.0

            chart.time_scale(min_bar_spacing=spacing, right_offset=offset)

            # --- Set Data ---
            if not final_chart_data.empty:
                c_data = final_chart_data.copy()
                # Format time for Lightweight Charts
                c_data['time'] = c_data['time'].apply(lambda x: x.isoformat())
                chart.set(c_data)
            
            chart.load()

        except Exception as e:
            st.error(f"Chart Error: {e}")

# ========================================
# 6. WORKSPACE FRAGMENT (The Global Loop)
# ========================================
@st.fragment
def render_workspace_fragment(db_client, num_charts, chart_height):
    """
    Renders the unified chart grid and the global control bar.
    """
    
    # Define Timezone
    ny_tz = pytz.timezone('America/New_York')

    # --- Initialize Global Session State ---
    if "global_dt" not in st.session_state:
        start_date = st.session_state.get("global_latest_db_date", datetime.date.today())
        # Default start: 9:29 AM ET (Pre-open)
        dt_ny = datetime.datetime.combine(start_date, datetime.time(9, 29))
        st.session_state.global_dt = ny_tz.localize(dt_ny).astimezone(pytz.UTC)
    
    if "global_playing" not in st.session_state:
        st.session_state.global_playing = False
        
    if "global_speed_val" not in st.session_state:
        st.session_state.global_speed_val = 1.0 

    if "replay_active" not in st.session_state:
        st.session_state.replay_active = False

    if "global_picker_val" not in st.session_state:
        st.session_state.global_picker_val = st.session_state.get("global_latest_db_date", datetime.date.today())

    # Reset frame-specific flags
    st.session_state.has_valid_data = False
    st.session_state.chart_deltas = {}

    # --- CALLBACKS ---
    def on_date_change():
        """Handles date change logic: Slice data to 9:29 AM immediately."""
        new_date = st.session_state.global_picker_input
        st.session_state.global_picker_val = new_date
        
        # 1. Reset Time to 9:29 AM
        dt_ny = datetime.datetime.combine(new_date, datetime.time(9, 29))
        st.session_state.global_dt = ny_tz.localize(dt_ny).astimezone(pytz.UTC)
        
        # 2. Activate Replay State (Planning Mode)
        st.session_state.global_playing = False
        st.session_state.replay_active = True 
        
        # 3. Force All Charts to Replay Mode
        for i in range(num_charts):
            st.session_state[f"c{i}_view_mode"] = "Replay Mode"

    def on_play_click():
        if not st.session_state.get("has_valid_data", False):
            st.toast("⚠️ No data available for this date!", icon="🚫")
            return
            
        st.session_state.global_playing = True
        st.session_state.replay_active = True
        
        # Ensure mode is correct
        for i in range(num_charts):
            st.session_state[f"c{i}_view_mode"] = "Replay Mode"

    def on_pause_click():
        st.session_state.global_playing = False
    
    def on_prev_click():
        if not st.session_state.get("has_valid_data", False):
             st.toast("⚠️ No data available for this date!", icon="🚫")
             return

        if st.session_state.chart_deltas:
            md = min(st.session_state.chart_deltas.values())
        else:
            md = pd.Timedelta("1min")
        st.session_state.global_dt -= md
        st.session_state.replay_active = True

    def on_next_click():
        if not st.session_state.get("has_valid_data", False):
             st.toast("⚠️ No data available for this date!", icon="🚫")
             return

        if st.session_state.chart_deltas:
            md = min(st.session_state.chart_deltas.values())
        else:
            md = pd.Timedelta("1min")
        st.session_state.global_dt += md
        st.session_state.replay_active = True
        
    def on_reset_click():
        # Reset to 9:29 AM on the current date
        dt_ny = datetime.datetime.combine(st.session_state.global_picker_val, datetime.time(9, 29))
        st.session_state.global_dt = ny_tz.localize(dt_ny).astimezone(pytz.UTC)
        st.session_state.global_playing = False
        st.session_state.replay_active = True
        
        # Force Replay Mode
        for i in range(num_charts):
            st.session_state[f"c{i}_view_mode"] = "Replay Mode"

    # --- RENDER CHART GRID ---
    current_dt = st.session_state.global_dt

    if num_charts == 1:
        render_chart_unit(0, db_client, chart_height, current_dt, show_border=False, default_tf="1 Min")
    
    elif num_charts == 2:
        c1, c2 = st.columns(2)
        with c1: render_chart_unit(0, db_client, chart_height, current_dt, default_tf="1 Min")
        with c2: render_chart_unit(1, db_client, chart_height, current_dt, default_tf="1 Day")
    
    elif num_charts == 3:
        c1, c2 = st.columns(2)
        with c1: render_chart_unit(0, db_client, chart_height, current_dt, default_tf="1 Min")
        with c2: render_chart_unit(1, db_client, chart_height, current_dt, default_tf="30 Min")
        render_chart_unit(2, db_client, chart_height, current_dt, default_tf="1 Day")
    
    elif num_charts == 4:
        c1, c2 = st.columns(2)
        with c1: render_chart_unit(0, db_client, chart_height, current_dt, default_tf="1 Min")
        with c2: render_chart_unit(1, db_client, chart_height, current_dt, default_tf="30 Min")
        c3, c4 = st.columns(2)
        with c3: render_chart_unit(2, db_client, chart_height, current_dt, default_tf="1 Day")
        with c4: render_chart_unit(3, db_client, chart_height, current_dt, default_tf="30 Min", default_ticker="SPY")

    # --- Determine Minimum Step ---
    if st.session_state.chart_deltas:
        min_delta = min(st.session_state.chart_deltas.values())
    else:
        min_delta = pd.Timedelta("1min")

    st.markdown("---")

    # --- Display Global Time ---
    if not st.session_state.get("has_valid_data", False):
        st.markdown(f"<div class='no-data-msg'>⚠️ No market data available for {st.session_state.global_picker_val}. Select another date.</div>", unsafe_allow_html=True)
        st.markdown("<div class='global-time' style='color:transparent'>.</div>", unsafe_allow_html=True)
    elif st.session_state.replay_active:
        curr_ny = st.session_state.global_dt.astimezone(ny_tz)
        time_str = curr_ny.strftime('%Y-%m-%d  %H:%M:%S %Z')
        st.markdown(f"<div class='global-time'>{time_str}</div>", unsafe_allow_html=True)
    else:
        # Placeholder to keep layout stable
        st.markdown("<div class='global-time' style='color:transparent'>.</div>", unsafe_allow_html=True)

    # --- RENDER UNIFIED CONTROL BAR ---
    c_date, c_prev, c_play, c_next, c_reset, c_speed = st.columns([2, 0.7, 1.5, 0.7, 1.5, 1.5])

    with c_date:
        # Date Input with Callback
        st.date_input(
            "Start", 
            value=st.session_state.global_picker_val,
            key="global_picker_input",
            label_visibility="collapsed",
            on_change=on_date_change
        )

    with c_prev:
        st.button("⏮", key="g_prev", use_container_width=True, help="Step Back", on_click=on_prev_click)

    with c_play:
        if st.session_state.global_playing:
            st.button("⏸ Pause", key="g_pause", use_container_width=True, type="primary", on_click=on_pause_click)
        else:
            st.button("▶ Play", key="g_play", use_container_width=True, on_click=on_play_click)

    with c_next:
        st.button("⏭", key="g_next", use_container_width=True, help="Step Forward", on_click=on_next_click)

    with c_reset:
        st.button("↺ 9:30 AM", key="g_reset", use_container_width=True, help="Reset to Market Open", on_click=on_reset_click)

    with c_speed:
        speed_options = [0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0]
        st.selectbox(
            "Spd", 
            speed_options,
            index=3, # Default 1.0s
            format_func=lambda x: f"{x}s",
            key="global_speed_val",
            label_visibility="collapsed"
        )

    # --- EXECUTE PLAY LOOP ---
    if st.session_state.global_playing:
        time.sleep(float(st.session_state.global_speed_val))
        st.session_state.global_dt += min_delta
        st.rerun()

# ========================================
# 7. MAIN EXECUTION FLOW
# ========================================

db_client = get_db_connection()
if not db_client:
    # This point is usually unreachable due to st.stop() in get_db_connection
    # but kept for safety.
    st.stop()

# --- SIDEBAR: GLOBAL SETTINGS ---
with st.sidebar:
    st.header("Market Rewind")
    
    # NEW: Connection Status Indicator
    st.markdown("<div class='db-status-ok'>✅ Connected to Turso DB</div>", unsafe_allow_html=True)
    st.markdown("---")
    
    with st.expander("⚙️ Layout & Settings", expanded=True):
        screen_height = streamlit_js_eval(
            js_code="window.innerHeight",
            key="screen_height_js",
            default=1080,
        )
        default_height = int(screen_height or 1080)

        st.markdown("**Chart Height Override (px)**")
        manual_height = st.number_input(
            "Height",
            min_value=300,
            max_value=2000,
            value=default_height,
            step=50,
            label_visibility="collapsed",
            key="manual_height_input"
        )
        
        st.markdown("---")
        
        if st.button("⚠️ Reset Entire Layout", type="secondary", use_container_width=True):
            for key in list(st.session_state.keys()):
                del st.session_state[key]
            st.rerun()

# --- STEP 1: LAYOUT CONFIGURATION ---
if "layout_set" not in st.session_state:
    st.info("Configure your workspace to begin.")
    with st.form("layout_config"):
        st.markdown("#### Initialize Workspace")
        num_charts = st.selectbox("Number of Charts", [1, 2, 3, 4])
        submitted = st.form_submit_button("Start Market Rewind")
        if submitted:
            st.session_state.num_charts = num_charts
            st.session_state.layout_set = True
            st.rerun()

# --- STEP 2: RENDER WORKSPACE ---
else:
    n = st.session_state.num_charts
    
    # Calculate chart height dynamically
    viewport_height = manual_height if 'manual_height' in locals() else screen_height
    st.session_state["chart_height_px"] = get_dynamic_chart_height(n, viewport_height)
    
    # Render the main application fragment
    render_workspace_fragment(db_client, n, st.session_state["chart_height_px"])