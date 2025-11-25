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
# PAGE CONFIG
# ========================================
st.set_page_config(
    layout="wide",
    page_title="Market Rewind",
    initial_sidebar_state="collapsed"
)

# ========================================
# CSS: CLEAN PADDING
# ========================================
st.markdown("""
    <style>
        .block-container {
            padding-top: 1rem;
            padding-bottom: 0rem;
            padding-left: 1rem;
            padding-right: 1rem;
        }
        div[data-testid="stVerticalBlock"] > div {
            gap: 0.5rem;
        }
        /* Better alignment for the playback buttons */
        div.stButton > button {
            width: 100%;
        }
    </style>
""", unsafe_allow_html=True)

# ========================================
# HELPER: DYNAMIC HEIGHT
# ========================================
def get_dynamic_chart_height(num_charts, viewport_height):
    if viewport_height is None or viewport_height <= 0:
        viewport_height = 900 

    reserved_top_px = 40 
    reserved_bottom_px = 80 # Increased for global controls at bottom

    usable = max(300, viewport_height - reserved_top_px - reserved_bottom_px)
    rows = 1 if num_charts <= 2 else 2
    per_chart = usable / rows
    return int(per_chart)

# ========================================
# DATABASE CONNECTION
# ========================================
@st.cache_resource
def get_db_connection():
    try:
        if "turso" in st.secrets:
            url = st.secrets["turso"]["db_url"]
            token = st.secrets["turso"]["auth_token"]
        else:
            url = os.environ.get("TURSO_DB_URL")
            token = os.environ.get("TURSO_AUTH_TOKEN")

        if not url or not token:
            st.error("Missing Turso credentials.")
            return None

        http_url = url.replace("libsql://", "https://")
        config = {"url": http_url, "auth_token": token}
        return create_client_sync(**config)
    except Exception as e:
        st.error(f"Failed to create Turso client: {e}")
        return None

@st.cache_data
def get_available_tickers(_client: ClientSync):
    try:
        rs = _client.execute("SELECT user_ticker FROM symbol_map ORDER BY user_ticker;")
        return [row["user_ticker"] for row in rs.rows]
    except Exception as e:
        st.error(f"Failed to fetch tickers: {e}")
        return []

@st.cache_data
def load_master_data(_client: ClientSync, ticker: str, earliest_date_str: str, include_eth: bool):
    try:
        if include_eth:
            query = """
                SELECT timestamp, open, high, low, close, volume 
                FROM market_data 
                WHERE symbol = ? AND timestamp >= ?
                ORDER BY timestamp;
            """
        else:
            query = """
                SELECT timestamp, open, high, low, close, volume 
                FROM market_data 
                WHERE symbol = ? AND session = 'REG' AND timestamp >= ?
                ORDER BY timestamp;
            """
        
        rs = _client.execute(query, [ticker, earliest_date_str])
        
    except Exception as e:
        st.error(f"DB Query failed for {ticker}: {e}")
        return pd.DataFrame()

    df = pd.DataFrame(rs.rows, columns=["timestamp", "open", "high", "low", "close", "volume"])
    if df.empty:
        return df

    df['time'] = pd.to_datetime(df['timestamp'], utc=True)
    
    for col in ['open', 'high', 'low', 'close', 'volume']:
        df[col] = pd.to_numeric(df[col])
    
    df['color'] = np.where(df['open'] > df['close'],
                           'rgba(239, 83, 80, 0.8)',
                           'rgba(38, 166, 154, 0.8)')
    return df[['time', 'open', 'high', 'low', 'close', 'volume', 'color']]

@st.cache_data
def resample_data(df, timeframe):
    if df.empty:
        return pd.DataFrame(columns=['time', 'open', 'high', 'low', 'close', 'volume', 'color'])

    df = df.set_index('time')
    agg = {'open': 'first', 'high': 'max', 'low': 'min', 'close': 'last', 'volume': 'sum'}
    resampled = df.resample(timeframe).agg(agg).dropna().reset_index()
    
    resampled['color'] = np.where(resampled['open'] > resampled['close'],
                                  'rgba(239, 83, 80, 0.8)',
                                  'rgba(38, 166, 154, 0.8)')
    return resampled

# ========================================
# LOGIC: TIMEFRAME PARSING
# ========================================
def get_step_delta(tf_str_list):
    """
    Determine the smallest playback step based on active charts.
    """
    if not tf_str_list:
        return datetime.timedelta(minutes=1)
    
    # Map selection strings to minutes
    mapping = {
        "1min": 1, "5min": 5, "15min": 15, "30min": 30, "1H": 60, "1D": 1440
    }
    
    min_minutes = 1440
    for tf in tf_str_list:
        val = mapping.get(tf, 1)
        if val < min_minutes:
            min_minutes = val
            
    return datetime.timedelta(minutes=min_minutes)

# ========================================
# COMPONENT: SINGLE CHART VIEW
# ========================================
# Note: This is NOT a fragment anymore, it is called by the main workspace fragment
def render_chart_unit_view(chart_id, db_client, global_replay_time, height):
    """
    Renders the chart UI (Top controls + Chart). 
    It is 'controlled' by the parent workspace and global_replay_time.
    """
    # Keys
    k_ticker = f"c{chart_id}_ticker"
    k_tf = f"c{chart_id}_tf"
    k_eth = f"c{chart_id}_eth" 
    k_view_mode = f"c{chart_id}_view_mode"
    
    # Defaults
    if k_tf not in st.session_state: st.session_state[k_tf] = "1 Min"
    if k_eth not in st.session_state: st.session_state[k_eth] = False
    if k_view_mode not in st.session_state: st.session_state[k_view_mode] = "Viewer Mode"

    # Container
    with st.container(border=True):
        # --- TOP CONTROLS ---
        c1, c2, c3, c4, _ = st.columns([1.5, 1.5, 2.0, 1.0, 1.0])
        
        with c1:
            tickers = get_available_tickers(db_client)
            sel_ticker = st.selectbox("Ticker", tickers, key=k_ticker, label_visibility="collapsed", placeholder="Ticker")
        with c2:
            tf_map = {"1 Min": "1min", "5 Min": "5min", "15 Min": "15min", "30 Min": "30min", "1 Hr": "1H", "1 Day": "1D"}
            sel_tf_str = st.selectbox("TF", list(tf_map.keys()), key=k_tf, label_visibility="collapsed")
            sel_tf_agg = tf_map[sel_tf_str]
        with c3:
            st.selectbox("Mode", ["Viewer Mode", "Replay Mode"], key=k_view_mode, label_visibility="collapsed")
        with c4:
            is_eth = st.toggle("ETH", key=k_eth)
            
        is_replay_mode = (st.session_state[k_view_mode] == "Replay Mode")

        # --- DATA PROCESSING ---
        if not sel_ticker:
            st.info("Select Ticker")
            return None # Return None to indicate no active chart settings
            
        master_data = load_master_data(db_client, sel_ticker, "2024-01-01", is_eth)
        
        if master_data.empty:
            st.warning("No Data")
            return None

        # Resample
        resampled_data = resample_data(master_data, sel_tf_agg)
        
        # --- REPLAY SLICING ---
        # Slice data up to global_replay_time
        # Ensure global_replay_time is timezone aware (UTC) for comparison
        if global_replay_time.tzinfo is None:
            global_replay_time = global_replay_time.replace(tzinfo=pytz.UTC)
            
        visible_data = resampled_data[resampled_data['time'] <= global_replay_time]
        
        # --- CHART RENDER ---
        try:
            chart = StreamlitChart(height=height)
            chart.layout(background_color="#0f111a", text_color="#ffffff")
            chart.price_scale()
            chart.volume_config()

            # Visuals
            if is_replay_mode:
                offset = 45 
                if sel_tf_str == "1 Min": spacing = 8.0 
                elif sel_tf_str == "5 Min": spacing = 10.0
                elif sel_tf_str == "15 Min": spacing = 12.0
                elif sel_tf_str == "30 Min": spacing = 14.0
                elif sel_tf_str == "1 Hr": spacing = 16.0
                elif sel_tf_str == "1 Day": spacing = 20.0
                else: spacing = 10.0
            else:
                offset = 5
                if sel_tf_str == "1 Min": spacing = 0.5
                elif sel_tf_str == "5 Min": spacing = 2.0
                elif sel_tf_str == "15 Min": spacing = 4.0
                elif sel_tf_str == "30 Min": spacing = 7.0
                elif sel_tf_str == "1 Hr": spacing = 8.0
                elif sel_tf_str == "1 Day": spacing = 10.0
                else: spacing = 5.0

            chart.time_scale(min_bar_spacing=spacing, right_offset=offset)
            
            if not visible_data.empty:
                c_data = visible_data.copy()
                c_data['time'] = c_data['time'].apply(lambda x: x.isoformat())
                chart.set(c_data)
            else:
                chart.set(pd.DataFrame(columns=['time', 'open', 'high', 'low', 'close', 'volume', 'color']))
            
            chart.load()
            
        except Exception as e:
            st.error(f"Chart Error: {e}")
            
        return sel_tf_agg # Return timeframe string for step calculation

# ========================================
# MAIN WORKSPACE FRAGMENT
# ========================================
@st.fragment
def main_workspace(db_client, num_charts, height_px):
    """
    Contains ALL charts and the GLOBAL controls in one fragment.
    This prevents full page reloads during playback.
    """
    
    # --- GLOBAL STATE INIT ---
    if "global_date" not in st.session_state:
        st.session_state.global_date = datetime.date.today()
    if "global_dt" not in st.session_state:
        # Defaults to 9:30 AM UTC-5 (NY) -> UTC
        ny = pytz.timezone('America/New_York')
        d = datetime.datetime.combine(st.session_state.global_date, datetime.time(9, 30))
        st.session_state.global_dt = ny.localize(d).astimezone(pytz.UTC)
    if "global_playing" not in st.session_state:
        st.session_state.global_playing = False
    if "global_speed" not in st.session_state:
        st.session_state.global_speed = 1.0

    # --- RENDER CHARTS GRID ---
    active_timeframes = []
    
    if num_charts == 1:
        tf = render_chart_unit_view(0, db_client, st.session_state.global_dt, height_px)
        if tf: active_timeframes.append(tf)
    elif num_charts == 2:
        c1, c2 = st.columns(2)
        with c1: 
            tf = render_chart_unit_view(0, db_client, st.session_state.global_dt, height_px)
            if tf: active_timeframes.append(tf)
        with c2: 
            tf = render_chart_unit_view(1, db_client, st.session_state.global_dt, height_px)
            if tf: active_timeframes.append(tf)
    elif num_charts == 3:
        c1, c2 = st.columns(2)
        with c1: 
            tf = render_chart_unit_view(0, db_client, st.session_state.global_dt, height_px)
            if tf: active_timeframes.append(tf)
        with c2: 
            tf = render_chart_unit_view(1, db_client, st.session_state.global_dt, height_px)
            if tf: active_timeframes.append(tf)
        tf = render_chart_unit_view(2, db_client, st.session_state.global_dt, height_px)
        if tf: active_timeframes.append(tf)
    elif num_charts == 4:
        c1, c2 = st.columns(2)
        with c1: 
            tf = render_chart_unit_view(0, db_client, st.session_state.global_dt, height_px)
            if tf: active_timeframes.append(tf)
        with c2: 
            tf = render_chart_unit_view(1, db_client, st.session_state.global_dt, height_px)
            if tf: active_timeframes.append(tf)
        c3, c4 = st.columns(2)
        with c3: 
            tf = render_chart_unit_view(2, db_client, st.session_state.global_dt, height_px)
            if tf: active_timeframes.append(tf)
        with c4: 
            tf = render_chart_unit_view(3, db_client, st.session_state.global_dt, height_px)
            if tf: active_timeframes.append(tf)

    st.divider()

    # --- GLOBAL CONTROLS BAR ---
    # Layout: Date | Prev | Play/Pause | Next | Reset | Speed
    gc1, gc2, gc3, gc4, gc5, gc6, gc7 = st.columns([2, 1, 2, 1, 2, 2, 3])
    
    # 1. Date Picker
    with gc1:
        new_date = st.date_input("Global Date", value=st.session_state.global_date, label_visibility="collapsed")
        if new_date != st.session_state.global_date:
            st.session_state.global_date = new_date
            # Reset time to 9:30 AM NY on new date
            ny = pytz.timezone('America/New_York')
            d = datetime.datetime.combine(new_date, datetime.time(9, 30))
            st.session_state.global_dt = ny.localize(d).astimezone(pytz.UTC)
            st.rerun()

    # Calculate Step Size (Min of all active charts)
    step_delta = get_step_delta(active_timeframes)

    # 2. Prev
    with gc2:
        if st.button("⏮", key="g_prev", use_container_width=True):
            st.session_state.global_dt -= step_delta
            st.rerun()

    # 3. Play/Pause
    with gc3:
        label = "⏸ Pause" if st.session_state.global_playing else "▶ Play"
        if st.button(label, key="g_play", use_container_width=True):
            st.session_state.global_playing = not st.session_state.global_playing
            st.rerun()

    # 4. Next
    with gc4:
        if st.button("⏭", key="g_next", use_container_width=True):
            st.session_state.global_dt += step_delta
            st.rerun()

    # 5. Reset
    with gc5:
        if st.button("↺ Reset", key="g_reset", use_container_width=True):
            # Reset to 9:30 AM on current selected date
            ny = pytz.timezone('America/New_York')
            d = datetime.datetime.combine(st.session_state.global_date, datetime.time(9, 30))
            st.session_state.global_dt = ny.localize(d).astimezone(pytz.UTC)
            st.session_state.global_playing = False
            st.rerun()

    # 6. Speed
    with gc6:
        speed_options = [0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0]
        # Find index of current speed
        try:
            curr_idx = speed_options.index(st.session_state.global_speed)
        except:
            curr_idx = 3
        
        new_speed = st.selectbox(
            "Speed", speed_options, index=curr_idx, format_func=lambda x: f"{x}s", 
            key="g_speed_sel", label_visibility="collapsed"
        )
        if new_speed != st.session_state.global_speed:
            st.session_state.global_speed = new_speed

    # 7. Status Info
    with gc7:
        # Convert UTC to NY for display
        ny_time = st.session_state.global_dt.astimezone(pytz.timezone('America/New_York'))
        st.caption(f"**Replay Time:** {ny_time.strftime('%Y-%m-%d %H:%M:%S %Z')}")
        st.caption(f"**Step:** {step_delta}")

    # --- PLAYBACK LOOP ---
    if st.session_state.global_playing:
        time.sleep(float(st.session_state.global_speed))
        st.session_state.global_dt += step_delta
        st.rerun()


# ========================================
# MAIN EXECUTION FLOW
# ========================================

db_client = get_db_connection()
if not db_client:
    st.stop()

st.markdown("### Market Rewind")

# STEP 1: LAYOUT CONFIG
if "layout_set" not in st.session_state:
    st.info("Configure your workspace to begin.")
    with st.form("layout_config"):
        num_charts = st.selectbox("How many charts do you want?", [1, 2, 3, 4])
        submitted = st.form_submit_button("Initialize Workspace")
        if submitted:
            st.session_state.num_charts = num_charts
            st.session_state.layout_set = True
            st.rerun()

else:
    n = st.session_state.num_charts

    # ===== GLOBAL CHART CONTROLS (Settings) =====
    with st.expander("Global chart controls", expanded=False):
        screen_height = streamlit_js_eval(
            js_code="window.innerHeight",
            key="screen_height_js",
            default=1080,
        )
        default_height = int(screen_height or 1080)

        label_col_btn, label_col_height = st.columns(2)
        with label_col_btn:
            st.markdown("🔁 Layout & workspace")
        with label_col_height:
            st.markdown("↕ Height override (px)")

        col_btn, col_height = st.columns(2)
        with col_btn:
            if st.button("Click here to reconfigure charts", type="secondary", use_container_width=True):
                for key in list(st.session_state.keys()):
                    del st.session_state[key]
                st.rerun()

        with col_height:
            manual_height = st.number_input("Height override (px)", min_value=600, max_value=2000, value=default_height, step=10, label_visibility="collapsed")

    viewport_height = manual_height or screen_height
    chart_height_px = get_dynamic_chart_height(n, viewport_height)

    # ====== RENDER WORKSPACE (CHARTS + GLOBAL PLAYBACK) ======
    main_workspace(db_client, n, chart_height_px)