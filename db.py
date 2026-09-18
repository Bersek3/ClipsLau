import os
import datetime
import hashlib
import jwt
from typing import Optional, List, Dict, Any
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError
from bson import ObjectId
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

MONGODB_URI = os.getenv(
    "MONGODB_URI",
    "mongodb+srv://franciscojmaguilar11_db_user:faLgd2Bd1I7cGrFT@cluster0.kgz18zp.mongodb.net/?retryWrites=true&w=majority"
)
JWT_SECRET = os.getenv("JWT_SECRET", "fish_audio_voice_changer_jwt_secret_key_2026_x89")
JWT_ALGORITHM = "HS256"
DB_NAME = "voice_clone_db"

_mongo_client: Optional[MongoClient] = None

def get_mongo_client() -> MongoClient:
    """Returns a singleton MongoDB Client with auto-reconnect."""
    global _mongo_client
    if _mongo_client is None:
        _mongo_client = MongoClient(
            MONGODB_URI,
            serverSelectionTimeoutMS=5000,
            connectTimeoutMS=5000
        )
    return _mongo_client

def get_db():
    """Returns the voice clone database instance."""
    client = get_mongo_client()
    return client[DB_NAME]

def test_connection() -> bool:
    """Tests MongoDB connection and returns True if successful."""
    try:
        client = get_mongo_client()
        client.admin.command('ping')
        return True
    except Exception as e:
        print(f"[MongoDB] Error de conexión: {e}")
        return False

# =========================================================================
# 🔒 PASSWORD HASHING & SECURITY
# =========================================================================

def hash_password(password: str) -> str:
    """Hashes a plain text password with bcrypt (with SHA-256 fallback)."""
    try:
        import bcrypt
        salt = bcrypt.gensalt()
        hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
        return hashed.decode('utf-8')
    except Exception:
        # Fallback to SHA-256 with salt
        salt = "fish_audio_salt_2026"
        return "sha256$" + hashlib.sha256((salt + password).encode('utf-8')).hexdigest()

def verify_password(password: str, hashed_password: str) -> bool:
    """Verifies a plain text password against the hashed version."""
    if not hashed_password or not password:
        return False
    try:
        if hashed_password.startswith("sha256$"):
            salt = "fish_audio_salt_2026"
            expected = "sha256$" + hashlib.sha256((salt + password).encode('utf-8')).hexdigest()
            return expected == hashed_password
        
        import bcrypt
        return bcrypt.checkpw(password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception as e:
        print(f"[Auth] Error verificando contraseña: {e}")
        return False

# =========================================================================
# 🎟️ JWT TOKEN MANAGEMENT
# =========================================================================

def create_access_token(data: dict, expires_days: int = 30) -> str:
    """Generates a signed JWT session token."""
    to_encode = data.copy()
    expire = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=expires_days)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)

def verify_token(token: str) -> Optional[dict]:
    """Decodes and validates a JWT token."""
    try:
        if not token:
            return None
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None

# =========================================================================
# 👤 USER AUTHENTICATION & MANAGEMENT
# =========================================================================

def register_user(username: str, password: str, email: Optional[str] = None) -> dict:
    """Registers a new user in MongoDB and returns user profile with JWT token."""
    db = get_db()
    clean_username = username.strip()
    if len(clean_username) < 3:
        raise ValueError("El nombre de usuario debe tener al menos 3 caracteres.")
    if len(password) < 4:
        raise ValueError("La contraseña debe tener al menos 4 caracteres.")

    # Check if user already exists
    existing = db.users.find_one({"username_lower": clean_username.lower()})
    if existing:
        raise ValueError("Este nombre de usuario ya está registrado.")

    password_hash = hash_password(password)
    user_doc = {
        "username": clean_username,
        "username_lower": clean_username.lower(),
        "email": email.strip() if email else "",
        "password_hash": password_hash,
        "created_at": datetime.datetime.now(datetime.timezone.utc),
        "last_login": datetime.datetime.now(datetime.timezone.utc),
        "selected_voice": "97582f301e1c4f93a514ceda15e23e26",
        "custom_voices": [],
        "settings": {
            "model": "s2.1-pro-free",
            "language": "es-CL",
            "hear_myself": False,
            "output_device_primary": None,
            "output_device_secondary": None
        }
    }

    res = db.users.insert_one(user_doc)
    user_id = str(res.inserted_id)

    token = create_access_token({"user_id": user_id, "username": clean_username})
    return {
        "user_id": user_id,
        "username": clean_username,
        "email": user_doc["email"],
        "token": token,
        "selected_voice": user_doc["selected_voice"],
        "settings": user_doc["settings"]
    }

def authenticate_user(username: str, password: str) -> dict:
    """Validates user credentials and returns user profile with new JWT token."""
    db = get_db()
    clean_username = username.strip()
    user = db.users.find_one({"username_lower": clean_username.lower()})
    if not user:
        raise ValueError("Usuario o contraseña incorrectos.")

    if not verify_password(password, user.get("password_hash", "")):
        raise ValueError("Usuario o contraseña incorrectos.")

    user_id = str(user["_id"])
    db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"last_login": datetime.datetime.now(datetime.timezone.utc)}}
    )

    token = create_access_token({"user_id": user_id, "username": user["username"]})
    return {
        "user_id": user_id,
        "username": user["username"],
        "email": user.get("email", ""),
        "token": token,
        "selected_voice": user.get("selected_voice", "97582f301e1c4f93a514ceda15e23e26"),
        "settings": user.get("settings", {})
    }

def get_user_by_id(user_id: str) -> Optional[dict]:
    """Retrieves user profile by ObjectId string."""
    try:
        db = get_db()
        user = db.users.find_one({"_id": ObjectId(user_id)})
        if user:
            user["user_id"] = str(user["_id"])
            user.pop("password_hash", None)
            user.pop("_id", None)
            return user
        return None
    except Exception:
        return None

def update_user_preferences(user_id: str, prefs: dict) -> bool:
    """Updates user-specific settings and selected voice in MongoDB."""
    try:
        db = get_db()
        update_fields = {}
        if "selected_voice" in prefs:
            update_fields["selected_voice"] = prefs["selected_voice"]
        if "settings" in prefs:
            for k, v in prefs["settings"].items():
                update_fields[f"settings.{k}"] = v
        
        if update_fields:
            db.users.update_one(
                {"_id": ObjectId(user_id)},
                {"$set": update_fields}
            )
        return True
    except Exception as e:
        print(f"[DB] Error actualizando preferencias de usuario: {e}")
        return False

# =========================================================================
# 🎙️ VOICES MANAGEMENT (GLOBAL & CUSTOM PER USER)
# =========================================================================

def seed_default_voices(voices_list: List[dict]):
    """Populates global_voices collection in MongoDB with default voices if not present."""
    try:
        db = get_db()
        count = db.global_voices.count_documents({})
        if count == 0 and voices_list:
            print(f"[MongoDB] Inicializando {len(voices_list)} voces predeterminadas en MongoDB...")
            for v in voices_list:
                db.global_voices.update_one(
                    {"id": v["id"]},
                    {"$set": {
                        "id": v["id"],
                        "name": v["name"],
                        "description": v.get("description", ""),
                        "sample_text": v.get("sample_text", ""),
                        "is_global": True
                    }},
                    upsert=True
                )
            print("[MongoDB] [OK] Voces globales guardadas en base de datos.")
    except Exception as e:
        print(f"[MongoDB] Advertencia al sincronizar voces globales: {e}")

def get_all_voices(user_id: Optional[str] = None) -> List[dict]:
    """Returns combined list of global voices and user-custom voices."""
    try:
        db = get_db()
        global_cursor = db.global_voices.find({}, {"_id": 0})
        voices_list = list(global_cursor)

        if not voices_list:
            # Fallback if DB is empty before seed
            from audio_engine import load_config
            cfg = load_config()
            voices_list = cfg.get("voices", [])

        # If user is authenticated, append their custom voices
        if user_id:
            user = db.users.find_one({"_id": ObjectId(user_id)}, {"custom_voices": 1})
            if user and "custom_voices" in user and user["custom_voices"]:
                for cv in user["custom_voices"]:
                    cv_copy = cv.copy()
                    cv_copy["is_custom"] = True
                    # Avoid duplicates
                    if not any(v["id"] == cv_copy["id"] for v in voices_list):
                        voices_list.append(cv_copy)

        return voices_list
    except Exception as e:
        print(f"[DB] Error obteniendo voces: {e}")
        from audio_engine import load_config
        return load_config().get("voices", [])

def add_custom_voice_to_user(user_id: str, voice_data: dict) -> dict:
    """Adds a new custom voice to the user's MongoDB profile and returns the voice object."""
    db = get_db()
    clean_id = voice_data["id"].strip()
    clean_name = voice_data["name"].strip()
    clean_desc = voice_data.get("description", "").strip()
    clean_sample = voice_data.get("sample_text", "").strip()

    voice_obj = {
        "id": clean_id,
        "name": clean_name,
        "description": clean_desc,
        "sample_text": clean_sample,
        "created_at": datetime.datetime.now(datetime.timezone.utc)
    }

    # Add to user's custom voices
    db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$addToSet": {"custom_voices": voice_obj}}
    )

    # Also make available in global_voices so everyone can use it if desired
    db.global_voices.update_one(
        {"id": clean_id},
        {"$set": {
            "id": clean_id,
            "name": clean_name,
            "description": clean_desc,
            "sample_text": clean_sample,
            "added_by_user": user_id
        }},
        upsert=True
    )

    return voice_obj
