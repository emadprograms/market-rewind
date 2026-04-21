"""
Infisical secret manager for the Stock Data Archiver.
Fetches Massive (Polygon.io) API keys and Turso database credentials.

Pattern mirrors: data-harvester/src/infisical_manager.py
"""
import os
from dotenv import load_dotenv

# Load .env from the market-rewind root (parent of this package)
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))


class InfisicalClient:
    """Connects to Infisical and retrieves secrets for the archiver."""

    def __init__(self):
        self.client = None
        self.is_connected = False
        self.project_id = None
        self._secrets_cache = {}

        client_id = os.getenv("INFISICAL_CLIENT_ID")
        client_secret = os.getenv("INFISICAL_CLIENT_SECRET")
        self.project_id = os.getenv("INFISICAL_PROJECT_ID")

        if not all([client_id, client_secret, self.project_id]):
            missing = []
            if not client_id: missing.append("INFISICAL_CLIENT_ID")
            if not client_secret: missing.append("INFISICAL_CLIENT_SECRET")
            if not self.project_id: missing.append("INFISICAL_PROJECT_ID")
            print(f"❌ Missing Infisical credentials: {', '.join(missing)}")
            print("   Set them in the .env file at the market-rewind root.")
            return

        try:
            from infisical_sdk import InfisicalSDKClient
            self.client = InfisicalSDKClient(host="https://app.infisical.com")
            self.client.auth.universal_auth.login(
                client_id=client_id,
                client_secret=client_secret
            )
            self.is_connected = True
            print("✅ Infisical Connected")
        except Exception as e:
            print(f"❌ Infisical Connection Failed: {e}")

    def get_secret(self, secret_name: str) -> str | None:
        """Fetches a single secret by name, with caching."""
        if not self.is_connected:
            return None

        if secret_name in self._secrets_cache:
            return self._secrets_cache[secret_name]

        try:
            secret = self.client.secrets.get_secret_by_name(
                secret_name=secret_name,
                project_id=self.project_id,
                environment_slug="dev",
                secret_path="/"
            )
            val = secret.secretValue
            self._secrets_cache[secret_name] = val
            return val
        except Exception:
            return None

    def get_massive_keys(self) -> list[str]:
        """Retrieves all Polygon/Massive API keys matching the 'massive-' prefix."""
        if not self.is_connected:
            return []

        try:
            response = self.client.secrets.list_secrets(
                project_id=self.project_id,
                environment_slug="dev",
                secret_path="/"
            )

            keys = []
            for s in response.secrets:
                if s.secretKey.startswith("massive-") or s.secretKey == "massive_api_key":
                    keys.append(s.secretValue)

            return keys
        except Exception as e:
            print(f"⚠️ Error fetching Massive keys: {e}")
            return []

    def get_turso_creds(self) -> dict:
        """Retrieves Turso OL Stock Data Archive credentials."""
        return {
            "url": self.get_secret("turso_emadarshadalam_oldstockdataarchive_db_url"),
            "token": self.get_secret("turso_emadarshadalam_oldstockdataarchive_auth_token")
        }
