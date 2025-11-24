Market Rewind ⏪

Market Rewind is a high-performance, Streamlit-based market replay tool designed for traders to practice and backtest strategies on historical data. It utilizes lightweight charts for a smooth, TradingView-like experience and connects to a LibSQL (Turso) database for high-speed data retrieval.

🚀 Features

Multi-Chart Layouts: Configurable grid workspace supporting 1, 2, 3, or 4 simultaneous charts.

Market Replay:

Play back historical price action candle-by-candle.

Controls: Play, Pause, Step Forward (Next), Step Back (Previous), Reset.

Variable Speed: Adjust playback speed from 0.1s (fast) to 30s (slow).

Smart Synchronization: Switching tickers or timeframes preserves your current replay timestamp, allowing for seamless multi-timeframe analysis during a replay session.

Dual Viewing Modes:

Viewer Mode: High-density, thin candles for viewing large amounts of historical context.

Replay Mode: Thicker candles and increased right-side offset for a realistic "live trading" focus.

Extended Hours (ETH): Toggle between Regular Trading Hours (RTH) and Extended Trading Hours (Pre/Post Market).

Dynamic Resizing: Charts automatically adjust to your screen height for an immersive experience.

🛠️ Prerequisites

Python 3.9+

A Turso (LibSQL) database containing your stock market data.

📦 Installation

Clone the repository:

git clone [https://github.com/yourusername/market-rewind.git](https://github.com/yourusername/market-rewind.git)
cd market-rewind


Create a virtual environment (recommended):

python -m venv venv
source venv/bin/activate  # On Windows use `venv\Scripts\activate`


Install dependencies:

pip install streamlit pandas numpy streamlit-js-eval lightweight-charts libsql-client pytz


🔑 Configuration

The application requires connection details for your Turso database. You can set these up using Streamlit secrets or environment variables.

Option 1: Streamlit Secrets (Recommended for local dev)

Create a file named .streamlit/secrets.toml in the root directory:

[turso]
db_url = "libsql://your-database-name.turso.io"
auth_token = "your-auth-token"


Option 2: Environment Variables

Set the following variables in your environment:

TURSO_DB_URL

TURSO_AUTH_TOKEN

🗄️ Database Schema

The app expects a table named market_data with the following schema:

Column

Type

Description

symbol

TEXT

Ticker symbol (e.g., 'AAPL')

timestamp

DATETIME

ISO8601 formatted string or timestamp

open

REAL



high

REAL



low

REAL



close

REAL



volume

INTEGER



session

TEXT

'REG' for Regular, 'EXT' for Extended

And a helper table symbol_map for the ticker list:
| Column        | Type | Description |
|---------------|------|-------------|
| user_ticker | TEXT | The display name of the ticker |

▶️ Usage

Run the application:

streamlit run app.py


Initialize Workspace: Select how many charts you want (1-4) and click "Initialize Workspace".

Control Bar:

Ticker & TF: Select your stock and timeframe.

Mode: Switch to "Replay Mode" for better visibility during simulation.

ETH: Toggle Extended Hours (Warning: Resets progress).

Date Picker: Select the specific trading day you want to replay.

Playback: Use the Play/Pause/Step buttons to control the flow of data.

🤝 Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the issues page.

📄 License

MIT