import streamlit as st
import pandas as pd
import numpy as np
import time
import datetime
import os
import streamlit.runtime
from lightweight_charts.widgets import StreamlitChart
from libsql_client import create_client_sync, ClientSync

# --- Page Config ---
st.set_page_config(
    layout="wide", 
    page_title="Interactive Trading Chart",
    initial_sidebar_state="collapsed" # Hide sidebar by default
)

# --- Database Connection & Data Loading ---
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
            st.error("Missing Turso credentials. Check secrets.toml or Environment Variables.")
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
def load_master_data(_client: ClientSync, ticker: str, earliest_date_str: str):
    try:
        rs = _client.execute(
            """
            SELECT timestamp, open, high, low, close, volume 
            FROM market_data 
            WHERE symbol = ? AND session = 'REG' AND timestamp >= ?
            ORDER BY timestamp;
            """,
            [ticker, earliest_date_str]
        )
    except Exception as e:
        st.error(f"Database query failed for {ticker}: {e}")
        return pd.DataFrame()

    df = pd.DataFrame(rs.rows, columns=["timestamp", "open", "high", "low", "close", "volume"])
    if df.empty:
        return df

    df['time'] = pd.to_datetime(df['timestamp'])
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

# --- Initialize DB Client ---
db_client = get_db_connection()
if db_client is None:
    st.warning("Database connection failed. Please check credentials and configuration.")
    st.stop()

# --- Session state ---
if 'replay_active' not in st.session_state:
    st.session_state.replay_active = False
    st.session_state.replay_paused = True
    st.session_state.replay_index = 0
    st.session_state.replay_data = pd.DataFrame()

# ==========================================
# UI LAYOUT START
# ==========================================

# --- 1. HEADER & DESCRIPTION ---
st.markdown("### Market Replay & Analysis")
st.caption("Select a ticker and timeframe below to visualize historical data, then use the bottom controls to replay the session.")
st.divider()

# --- 2. TOP CONTROLS (Ticker & Timeframe) ---
top_col1, top_col2, top_spacer = st.columns([1.5, 1.5, 7]) 

with top_col1:
    available_tickers = get_available_tickers(db_client)
    selected_ticker = st.selectbox("Ticker", available_tickers, label_visibility="collapsed", placeholder="Select Ticker")

with top_col2:
    timeframe_map = {"1 Minute": "1min", "5 Minutes": "5min", "15 Minutes": "15min",
                     "30 Minutes": "30min", "1 Hour": "1H", "1 Day": "1D"}
    selected_timeframe_str = st.selectbox("Timeframe", list(timeframe_map.keys()), label_visibility="collapsed")
    selected_timeframe_agg = timeframe_map[selected_timeframe_str]


# --- Data Loading Logic (Must happen before chart render) ---
if not selected_ticker:
    st.info("Please select a ticker to begin.")
    st.stop()

EARLIEST_DATA_DATE = '2024-01-01'
master_data_1m = load_master_data(db_client, selected_ticker, EARLIEST_DATA_DATE)

if master_data_1m.empty:
    st.error(f"No regular session data found for {selected_ticker} after {EARLIEST_DATA_DATE}.")
    st.stop()


# --- 3. THE CHART ---
try:
    chart = StreamlitChart(width="100%", height=750)
    chart.layout(background_color="#0f111a", text_color="#ffffff")
    chart.price_scale()
    chart.volume_config()
    
    # --- Dynamic Spacing Logic ---
    # Default spacing for 5min/15min
    current_spacing = 5 
    
    if selected_timeframe_str == "1 Minute":
        current_spacing = 0.5
    elif selected_timeframe_str == "30 Minutes":
        current_spacing = 7
    elif selected_timeframe_str == "1 Hour":
        current_spacing = 8
    elif selected_timeframe_str == "1 Day":
        current_spacing = 10
        
    chart.time_scale(min_bar_spacing=current_spacing, right_offset=15)

except Exception as e:
    st.error(f"Failed to initialize chart: {e}")
    st.stop()


# --- Replay Data Logic Calculation (Pre-Render) ---
if st.session_state.replay_active:
    if not st.session_state.replay_data.empty:
        # Slicing the data for the replay frame
        current_data = st.session_state.replay_data.iloc[:st.session_state.replay_index]
    else:
        current_data = pd.DataFrame()
else:
    # Live/Full view
    current_data = resample_data(master_data_1m, selected_timeframe_agg)

# Set Data to Chart
if not current_data.empty:
    chart_data = current_data.copy()
    chart_data['time'] = chart_data['time'].apply(lambda x: x.isoformat())
    chart.set(chart_data)
else:
    chart.set(pd.DataFrame(columns=['time', 'open', 'high', 'low', 'close', 'volume', 'color']))

# Render Chart
chart.load()


# --- 4. BOTTOM CONTROLS (Replay) ---
st.write("") # small spacer
control_container = st.container()

with control_container:
    # Structure: [Spacer] [Date] [Start] [Play/Pause] [Reset] [Speed] [Spacer]
    c_spacer_l, c_date, c_start, c_play, c_reset, c_speed, c_spacer_r = st.columns([2, 2, 1.5, 1.5, 1.5, 1.5, 2])

    with c_date:
        replay_start_date = st.date_input("Start Date", datetime.date.today(), label_visibility="collapsed")
    
    with c_start:
        if st.button("Start Replay", use_container_width=True):
            st.session_state.replay_active = True
            st.session_state.replay_paused = False
            st.session_state.replay_index = 0
            
            # Prepare replay data
            replay_1m_data = master_data_1m[master_data_1m['time'] >= pd.to_datetime(replay_start_date, utc=True)]
            if replay_1m_data.empty:
                st.toast(f"No data for {selected_ticker} on {replay_start_date}", icon="⚠️")
                st.session_state.replay_active = False
            else:
                st.session_state.replay_data = resample_data(replay_1m_data, selected_timeframe_agg)
            st.rerun()

    with c_play:
        if st.session_state.replay_paused:
            if st.button("▶ Play", use_container_width=True):
                st.session_state.replay_paused = False
                st.rerun()
        else:
            if st.button("⏸ Pause", use_container_width=True):
                st.session_state.replay_paused = True
                st.rerun()

    with c_reset:
        if st.button("↺ Reset", use_container_width=True):
            st.session_state.replay_active = False
            st.session_state.replay_paused = True
            st.session_state.replay_index = 0
            st.session_state.replay_data = pd.DataFrame()
            st.rerun()

    with c_speed:
        replay_speed = st.selectbox("Speed", [1.0, 0.5, 0.25, 0.1], format_func=lambda x: f"{x}s", label_visibility="collapsed")


# --- Replay Loop Trigger ---
if st.session_state.replay_active and not st.session_state.replay_paused:
    if st.session_state.replay_index < len(st.session_state.replay_data):
        st.session_state.replay_index += 1
    else:
        st.session_state.replay_paused = True
        st.toast("Replay finished.", icon="🏁")
        st.rerun()
    time.sleep(replay_speed)
    st.rerun()