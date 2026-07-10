import os
import sqlite3

db_path = os.path.expandvars(r"%LOCALAPPDATA%\ArchLifeOS-dev\archlife.db")
print("DB path:", db_path)
print("Exists:", os.path.exists(db_path))
if not os.path.exists(db_path):
    raise SystemExit("DB file not found at the path above.")

con = sqlite3.connect(db_path)
cur = con.cursor()

tables = cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
print("Tables:", tables)

for (table_name,) in tables:
    try:
        count = cur.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
        print(f"  {table_name}: {count} rows")
    except sqlite3.Error as e:
        print(f"  {table_name}: error reading ({e})")

# If there's a blobs table with an anon_id column, show distinct anon_ids
try:
    cols = [row[1] for row in cur.execute("PRAGMA table_info(blobs)").fetchall()]
    print("blobs columns:", cols)
    if "anon_id" in cols:
        ids = cur.execute("SELECT DISTINCT anon_id FROM blobs").fetchall()
        print("Distinct anon_ids in blobs table:", ids)
except sqlite3.Error as e:
    print("Could not inspect 'blobs' table:", e)

con.close()
