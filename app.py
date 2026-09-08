import os
import secrets
import sqlite3
from datetime import date, datetime, timedelta
from functools import wraps
from pathlib import Path

from flask import Flask, abort, jsonify, render_template, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("DB_PATH", BASE_DIR / "consultorio.db"))
SECRET_KEY_FILE = BASE_DIR / "secret_key.txt"

INSUMO_FIELDS = [
    "nombre", "categoria", "unidad_medida", "stock", "stock_minimo",
    "costo", "precio", "proveedor", "lote", "fecha_caducidad", "fecha_ultima_compra",
]
DIAS_ALERTA_CADUCIDAD = 30
DIAS_ALERTA_REVISION = 30

PACIENTE_FIELDS = [
    "nombre", "telefono", "correo", "fecha_nacimiento", "alergias",
    "recall_meses", "proxima_revision",
]

TRATAMIENTO_FIELDS = ["patient_id", "fecha", "tipo_tratamiento", "costo_mano_obra", "precio_total", "notas"]

FDI_TEETH = (
    [str(n) for n in range(18, 10, -1)] + [str(n) for n in range(21, 29)]
    + [str(n) for n in range(48, 40, -1)] + [str(n) for n in range(31, 39)]
)


def get_secret_key():
    env_key = os.environ.get("SECRET_KEY")
    if env_key:
        return env_key
    if SECRET_KEY_FILE.exists():
        return SECRET_KEY_FILE.read_text().strip()
    new_key = secrets.token_hex(32)
    SECRET_KEY_FILE.write_text(new_key)
    return new_key


app = Flask(__name__)
app.secret_key = get_secret_key()
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=90)


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript((BASE_DIR / "schema.sql").read_text(encoding="utf-8"))
    conn.commit()

    doctora = conn.execute("SELECT id FROM users WHERE role = 'doctora' LIMIT 1").fetchone()
    if not doctora:
        username = os.environ.get("DOCTORA_USERNAME", "doctora")
        password = os.environ.get("DOCTORA_PASSWORD", secrets.token_urlsafe(9))
        conn.execute(
            "INSERT INTO users (role, name, username, password_hash) VALUES ('doctora', ?, ?, ?)",
            ("Doctora", username, generate_password_hash(password)),
        )
        conn.commit()
        print(
            f"\n>>> Usuario doctora creado.\n>>>   Usuario:    {username}\n>>>   Contrasena: {password}\n"
            ">>> Cambia esta contrasena desde Configuracion en cuanto entres.\n"
        )

    conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('clinic_name', 'Mi Consultorio')"
    )
    conn.commit()
    conn.close()


init_db()


def login_required(*roles):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if "role" not in session or (roles and session["role"] not in roles):
                abort(401)
            return fn(*args, **kwargs)
        return wrapper
    return decorator


def days_until(fecha_str):
    if not fecha_str:
        return None
    try:
        d = datetime.strptime(fecha_str, "%Y-%m-%d").date()
    except ValueError:
        return None
    return (d - date.today()).days


def serialize_insumo(row, role):
    dias = days_until(row["fecha_caducidad"])
    por_caducar = dias is not None and dias <= DIAS_ALERTA_CADUCIDAD

    data = {
        "id": row["id"],
        "nombre": row["nombre"],
        "categoria": row["categoria"],
        "unidad_medida": row["unidad_medida"],
        "stock": row["stock"],
        "stock_minimo": row["stock_minimo"],
        "proveedor": row["proveedor"],
        "lote": row["lote"],
        "fecha_caducidad": row["fecha_caducidad"],
        "fecha_ultima_compra": row["fecha_ultima_compra"],
        "stock_bajo": row["stock"] <= row["stock_minimo"],
        "por_caducar": por_caducar,
    }
    if role == "doctora":
        data["costo"] = row["costo"]
        data["precio"] = row["precio"]
    return data


def serialize_paciente(row):
    dias = days_until(row["proxima_revision"])
    return {
        "id": row["id"],
        "nombre": row["nombre"],
        "telefono": row["telefono"],
        "correo": row["correo"],
        "fecha_nacimiento": row["fecha_nacimiento"],
        "alergias": row["alergias"],
        "recall_meses": row["recall_meses"],
        "proxima_revision": row["proxima_revision"],
        "revision_pendiente": dias is not None and dias <= DIAS_ALERTA_REVISION,
    }


def serialize_visita(row, items=None, payments=None):
    data = {
        "id": row["id"],
        "patient_id": row["patient_id"],
        "patient_nombre": row["patient_nombre"] if "patient_nombre" in row.keys() else None,
        "appointment_id": row["appointment_id"],
        "fecha": row["fecha"],
        "tipo_tratamiento": row["tipo_tratamiento"],
        "costo_mano_obra": row["costo_mano_obra"],
        "costo_insumos": row["costo_insumos"],
        "precio_total": row["precio_total"],
        "notas": row["notas"],
    }
    if items is not None:
        data["items"] = items
    if payments is not None:
        total_pagado = round(sum(p["monto"] for p in payments), 2)
        data["payments"] = payments
        data["total_pagado"] = total_pagado
        data["saldo"] = round(row["precio_total"] - total_pagado, 2)
    return data


def serialize_cita(row):
    return {
        "id": row["id"],
        "patient_id": row["patient_id"],
        "patient_nombre": row["patient_nombre"] if "patient_nombre" in row.keys() else None,
        "fecha_hora": row["fecha_hora"],
        "duracion_minutos": row["duracion_minutos"],
        "tipo_tratamiento": row["tipo_tratamiento"],
        "estado": row["estado"],
        "notas": row["notas"],
    }


# ---------------------------------------------------------------------------
# Archivos estaticos / PWA
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/manifest.json")
def manifest():
    return send_from_directory(BASE_DIR, "manifest.json", max_age=0)


@app.route("/sw.js")
def service_worker():
    return send_from_directory(BASE_DIR, "sw.js", max_age=0)


@app.route("/icon-192.png")
def icon_192():
    return send_from_directory(BASE_DIR, "icon-192.png", max_age=0)


@app.route("/icon-512.png")
def icon_512():
    return send_from_directory(BASE_DIR, "icon-512.png", max_age=0)


@app.route("/apple-touch-icon.png")
def apple_touch_icon():
    return send_from_directory(BASE_DIR, "apple-touch-icon.png", max_age=0)


# ---------------------------------------------------------------------------
# Autenticacion
# ---------------------------------------------------------------------------

@app.route("/api/bootstrap")
def bootstrap():
    conn = get_db()
    clinic_name_row = conn.execute("SELECT value FROM settings WHERE key = 'clinic_name'").fetchone()
    asistentes = conn.execute(
        "SELECT name FROM users WHERE role = 'asistente' AND active = 1 ORDER BY name"
    ).fetchall()
    conn.close()
    return jsonify({
        "clinicName": clinic_name_row["value"] if clinic_name_row else "Mi Consultorio",
        "asistentes": [r["name"] for r in asistentes],
    })


@app.route("/api/login", methods=["POST"])
def login_doctora():
    body = request.get_json(silent=True) or {}
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""

    conn = get_db()
    row = conn.execute(
        "SELECT * FROM users WHERE role = 'doctora' AND username = ? AND active = 1", (username,)
    ).fetchone()
    conn.close()

    if not row or not check_password_hash(row["password_hash"], password):
        abort(401)

    session.clear()
    session.permanent = True
    session["user_id"] = row["id"]
    session["role"] = "doctora"
    session["name"] = row["name"]
    return jsonify({"role": "doctora", "name": row["name"]})


@app.route("/api/login-asistente", methods=["POST"])
def login_asistente():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    pin = body.get("pin") or ""

    conn = get_db()
    row = conn.execute(
        "SELECT * FROM users WHERE role = 'asistente' AND name = ? AND active = 1", (name,)
    ).fetchone()
    conn.close()

    if not row or not row["pin_hash"] or not check_password_hash(row["pin_hash"], pin):
        abort(401)

    session.clear()
    session.permanent = True
    session["user_id"] = row["id"]
    session["role"] = "asistente"
    session["name"] = row["name"]
    return jsonify({"role": "asistente", "name": row["name"]})


@app.route("/api/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/me")
def me():
    if "role" not in session:
        return jsonify({"authenticated": False})
    return jsonify({"authenticated": True, "role": session["role"], "name": session.get("name")})


# ---------------------------------------------------------------------------
# Insumos
# ---------------------------------------------------------------------------

@app.route("/api/insumos", methods=["GET"])
@login_required("doctora", "asistente")
def list_insumos():
    conn = get_db()
    rows = conn.execute("SELECT * FROM inventory ORDER BY nombre").fetchall()
    conn.close()
    role = session["role"]
    return jsonify([serialize_insumo(r, role) for r in rows])


@app.route("/api/insumos", methods=["POST"])
@login_required("doctora")
def create_insumo():
    body = request.get_json(silent=True) or {}
    nombre = (body.get("nombre") or "").strip()
    if not nombre:
        return jsonify({"error": "El nombre es obligatorio"}), 400

    conn = get_db()
    conn.execute(
        """INSERT INTO inventory
           (nombre, categoria, unidad_medida, stock, stock_minimo, costo, precio,
            proveedor, lote, fecha_caducidad, fecha_ultima_compra)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            nombre,
            body.get("categoria"),
            body.get("unidad_medida"),
            float(body.get("stock") or 0),
            float(body.get("stock_minimo") or 0),
            body.get("costo"),
            body.get("precio"),
            body.get("proveedor"),
            body.get("lote"),
            body.get("fecha_caducidad") or None,
            body.get("fecha_ultima_compra") or None,
        ),
    )
    conn.commit()
    new_id = conn.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
    row = conn.execute("SELECT * FROM inventory WHERE id = ?", (new_id,)).fetchone()
    conn.close()
    return jsonify(serialize_insumo(row, "doctora")), 201


@app.route("/api/insumos/<int:insumo_id>", methods=["PUT"])
@login_required("doctora")
def update_insumo(insumo_id):
    body = request.get_json(silent=True) or {}
    conn = get_db()
    row = conn.execute("SELECT * FROM inventory WHERE id = ?", (insumo_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Insumo no encontrado"}), 404

    updates = {f: body[f] for f in INSUMO_FIELDS if f in body}
    if updates:
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        conn.execute(
            f"UPDATE inventory SET {set_clause}, updated_at = datetime('now') WHERE id = ?",
            (*updates.values(), insumo_id),
        )
        conn.commit()

    row = conn.execute("SELECT * FROM inventory WHERE id = ?", (insumo_id,)).fetchone()
    conn.close()
    return jsonify(serialize_insumo(row, "doctora"))


@app.route("/api/insumos/<int:insumo_id>/stock", methods=["PUT"])
@login_required("doctora", "asistente")
def adjust_stock(insumo_id):
    body = request.get_json(silent=True) or {}
    conn = get_db()
    row = conn.execute("SELECT * FROM inventory WHERE id = ?", (insumo_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Insumo no encontrado"}), 404

    if "delta" in body:
        new_stock = row["stock"] + float(body["delta"])
    elif "stock" in body:
        new_stock = float(body["stock"])
    else:
        conn.close()
        return jsonify({"error": "Se requiere 'delta' o 'stock'"}), 400

    if new_stock < 0:
        conn.close()
        return jsonify({"error": "El stock no puede quedar negativo"}), 400

    conn.execute(
        "UPDATE inventory SET stock = ?, updated_at = datetime('now') WHERE id = ?",
        (new_stock, insumo_id),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM inventory WHERE id = ?", (insumo_id,)).fetchone()
    conn.close()
    return jsonify(serialize_insumo(row, session["role"]))


@app.route("/api/insumos/<int:insumo_id>", methods=["DELETE"])
@login_required("doctora")
def delete_insumo(insumo_id):
    conn = get_db()
    conn.execute("DELETE FROM inventory WHERE id = ?", (insumo_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Configuracion y asistentes
# ---------------------------------------------------------------------------

@app.route("/api/settings", methods=["GET"])
@login_required("doctora")
def get_settings():
    conn = get_db()
    rows = conn.execute("SELECT key, value FROM settings").fetchall()
    conn.close()
    return jsonify({r["key"]: r["value"] for r in rows})


@app.route("/api/settings", methods=["PUT"])
@login_required("doctora")
def update_settings():
    body = request.get_json(silent=True) or {}
    conn = get_db()
    for key, value in body.items():
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, str(value)),
        )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/mi-password", methods=["PUT"])
@login_required("doctora")
def update_my_password():
    body = request.get_json(silent=True) or {}
    actual = body.get("actual") or ""
    nueva = body.get("nueva") or ""

    if len(nueva) < 8:
        return jsonify({"error": "La nueva contrasena debe tener al menos 8 caracteres"}), 400

    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE id = ?", (session["user_id"],)).fetchone()
    if not row or not check_password_hash(row["password_hash"], actual):
        conn.close()
        return jsonify({"error": "La contrasena actual no es correcta"}), 400

    conn.execute(
        "UPDATE users SET password_hash = ? WHERE id = ?",
        (generate_password_hash(nueva), session["user_id"]),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/asistentes", methods=["GET"])
@login_required("doctora")
def list_asistentes():
    conn = get_db()
    rows = conn.execute(
        "SELECT id, name, active FROM users WHERE role = 'asistente' ORDER BY name"
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/asistentes", methods=["POST"])
@login_required("doctora")
def create_asistente():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    pin = str(body.get("pin") or "").strip()

    if not name or not pin:
        return jsonify({"error": "Nombre y PIN son obligatorios"}), 400
    if not pin.isdigit() or len(pin) < 4:
        return jsonify({"error": "El PIN debe tener al menos 4 digitos"}), 400

    conn = get_db()
    existing = conn.execute(
        "SELECT id FROM users WHERE role = 'asistente' AND name = ?", (name,)
    ).fetchone()
    if existing:
        conn.close()
        return jsonify({"error": "Ya existe un asistente con ese nombre"}), 400

    conn.execute(
        "INSERT INTO users (role, name, pin_hash) VALUES ('asistente', ?, ?)",
        (name, generate_password_hash(pin)),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True}), 201


@app.route("/api/asistentes/<int:user_id>", methods=["PUT"])
@login_required("doctora")
def update_asistente(user_id):
    body = request.get_json(silent=True) or {}
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM users WHERE id = ? AND role = 'asistente'", (user_id,)
    ).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Asistente no encontrado"}), 404

    if "name" in body and str(body["name"]).strip():
        conn.execute("UPDATE users SET name = ? WHERE id = ?", (str(body["name"]).strip(), user_id))

    if "pin" in body and str(body["pin"]).strip():
        pin = str(body["pin"]).strip()
        if not pin.isdigit() or len(pin) < 4:
            conn.close()
            return jsonify({"error": "El PIN debe tener al menos 4 digitos"}), 400
        conn.execute("UPDATE users SET pin_hash = ? WHERE id = ?", (generate_password_hash(pin), user_id))

    if "active" in body:
        conn.execute("UPDATE users SET active = ? WHERE id = ?", (1 if body["active"] else 0, user_id))

    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/asistentes/<int:user_id>", methods=["DELETE"])
@login_required("doctora")
def delete_asistente(user_id):
    conn = get_db()
    conn.execute("DELETE FROM users WHERE id = ? AND role = 'asistente'", (user_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Pacientes
# ---------------------------------------------------------------------------

@app.route("/api/pacientes", methods=["GET"])
@login_required("doctora", "asistente")
def list_pacientes():
    q = (request.args.get("q") or "").strip()
    conn = get_db()
    if q:
        like = f"%{q}%"
        rows = conn.execute(
            "SELECT * FROM patients WHERE nombre LIKE ? OR telefono LIKE ? ORDER BY nombre",
            (like, like),
        ).fetchall()
    else:
        rows = conn.execute("SELECT * FROM patients ORDER BY nombre").fetchall()
    conn.close()
    return jsonify([serialize_paciente(r) for r in rows])


@app.route("/api/pacientes", methods=["POST"])
@login_required("doctora", "asistente")
def create_paciente():
    body = request.get_json(silent=True) or {}
    nombre = (body.get("nombre") or "").strip()
    if not nombre:
        return jsonify({"error": "El nombre es obligatorio"}), 400

    conn = get_db()
    conn.execute(
        """INSERT INTO patients (nombre, telefono, correo, fecha_nacimiento, alergias, recall_meses, proxima_revision)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            nombre,
            body.get("telefono"),
            body.get("correo"),
            body.get("fecha_nacimiento") or None,
            body.get("alergias"),
            int(body.get("recall_meses") or 6),
            body.get("proxima_revision") or None,
        ),
    )
    conn.commit()
    new_id = conn.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
    row = conn.execute("SELECT * FROM patients WHERE id = ?", (new_id,)).fetchone()
    conn.close()
    return jsonify(serialize_paciente(row)), 201


@app.route("/api/pacientes/<int:patient_id>", methods=["GET"])
@login_required("doctora", "asistente")
def get_paciente(patient_id):
    conn = get_db()
    row = conn.execute("SELECT * FROM patients WHERE id = ?", (patient_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Paciente no encontrado"}), 404

    notas = conn.execute(
        "SELECT * FROM patient_notes WHERE patient_id = ? ORDER BY fecha DESC", (patient_id,)
    ).fetchall()
    dientes_rows = conn.execute(
        "SELECT * FROM patient_teeth WHERE patient_id = ?", (patient_id,)
    ).fetchall()
    conn.close()

    dientes = {t: {"estado": "sano", "nota": None} for t in FDI_TEETH}
    for d in dientes_rows:
        dientes[d["tooth"]] = {"estado": d["estado"], "nota": d["nota"]}

    data = serialize_paciente(row)
    data["notas"] = [
        {"id": n["id"], "fecha": n["fecha"], "autor": n["autor"], "texto": n["texto"]} for n in notas
    ]
    data["dientes"] = dientes
    return jsonify(data)


@app.route("/api/pacientes/<int:patient_id>", methods=["PUT"])
@login_required("doctora", "asistente")
def update_paciente(patient_id):
    body = request.get_json(silent=True) or {}
    conn = get_db()
    row = conn.execute("SELECT * FROM patients WHERE id = ?", (patient_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Paciente no encontrado"}), 404

    updates = {f: body[f] for f in PACIENTE_FIELDS if f in body}
    if updates:
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        conn.execute(f"UPDATE patients SET {set_clause} WHERE id = ?", (*updates.values(), patient_id))
        conn.commit()

    row = conn.execute("SELECT * FROM patients WHERE id = ?", (patient_id,)).fetchone()
    conn.close()
    return jsonify(serialize_paciente(row))


@app.route("/api/pacientes/<int:patient_id>", methods=["DELETE"])
@login_required("doctora")
def delete_paciente(patient_id):
    conn = get_db()
    conn.execute("DELETE FROM patient_notes WHERE patient_id = ?", (patient_id,))
    conn.execute("DELETE FROM patient_teeth WHERE patient_id = ?", (patient_id,))
    conn.execute("DELETE FROM patients WHERE id = ?", (patient_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/pacientes/<int:patient_id>/notas", methods=["POST"])
@login_required("doctora", "asistente")
def add_nota(patient_id):
    body = request.get_json(silent=True) or {}
    texto = (body.get("texto") or "").strip()
    if not texto:
        return jsonify({"error": "El texto de la nota es obligatorio"}), 400

    conn = get_db()
    paciente = conn.execute("SELECT id FROM patients WHERE id = ?", (patient_id,)).fetchone()
    if not paciente:
        conn.close()
        return jsonify({"error": "Paciente no encontrado"}), 404

    conn.execute(
        "INSERT INTO patient_notes (patient_id, autor, texto) VALUES (?, ?, ?)",
        (patient_id, session.get("name"), texto),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True}), 201


@app.route("/api/pacientes/<int:patient_id>/dientes/<tooth>", methods=["PUT"])
@login_required("doctora", "asistente")
def update_diente(patient_id, tooth):
    if tooth not in FDI_TEETH:
        return jsonify({"error": "Pieza dental invalida"}), 400

    body = request.get_json(silent=True) or {}
    estado = body.get("estado", "sano")
    if estado not in ("sano", "tratado", "a_tratar", "ausente"):
        return jsonify({"error": "Estado invalido"}), 400

    conn = get_db()
    paciente = conn.execute("SELECT id FROM patients WHERE id = ?", (patient_id,)).fetchone()
    if not paciente:
        conn.close()
        return jsonify({"error": "Paciente no encontrado"}), 404

    conn.execute(
        """INSERT INTO patient_teeth (patient_id, tooth, estado, nota, updated_at)
           VALUES (?, ?, ?, ?, datetime('now'))
           ON CONFLICT(patient_id, tooth) DO UPDATE SET
             estado = excluded.estado, nota = excluded.nota, updated_at = excluded.updated_at""",
        (patient_id, tooth, estado, body.get("nota")),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "tooth": tooth, "estado": estado, "nota": body.get("nota")})


# ---------------------------------------------------------------------------
# Citas
# ---------------------------------------------------------------------------

def appointments_overlap(conn, fecha_hora, duracion_minutos, exclude_id=None):
    inicio = datetime.strptime(fecha_hora, "%Y-%m-%dT%H:%M")
    fin = inicio + timedelta(minutes=duracion_minutos)
    day_prefix = fecha_hora[:10]

    rows = conn.execute(
        "SELECT * FROM appointments WHERE fecha_hora LIKE ? AND estado NOT IN ('cancelada')",
        (f"{day_prefix}%",),
    ).fetchall()

    for row in rows:
        if exclude_id and row["id"] == exclude_id:
            continue
        otro_inicio = datetime.strptime(row["fecha_hora"], "%Y-%m-%dT%H:%M")
        otro_fin = otro_inicio + timedelta(minutes=row["duracion_minutos"])
        if inicio < otro_fin and otro_inicio < fin:
            return row
    return None


@app.route("/api/citas", methods=["GET"])
@login_required("doctora", "asistente")
def list_citas():
    desde = request.args.get("desde")
    hasta = request.args.get("hasta")
    conn = get_db()
    query = """SELECT appointments.*, patients.nombre AS patient_nombre
               FROM appointments LEFT JOIN patients ON patients.id = appointments.patient_id"""
    params = []
    if desde and hasta:
        query += " WHERE appointments.fecha_hora >= ? AND appointments.fecha_hora < ?"
        params = [desde, hasta]
    query += " ORDER BY appointments.fecha_hora"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return jsonify([serialize_cita(r) for r in rows])


@app.route("/api/citas", methods=["POST"])
@login_required("doctora", "asistente")
def create_cita():
    body = request.get_json(silent=True) or {}
    fecha_hora = body.get("fecha_hora")
    if not fecha_hora or not body.get("patient_id"):
        return jsonify({"error": "Paciente y fecha/hora son obligatorios"}), 400

    duracion = int(body.get("duracion_minutos") or 30)
    conn = get_db()

    conflicto = appointments_overlap(conn, fecha_hora, duracion)
    if conflicto and not body.get("forzar"):
        conn.close()
        return jsonify({
            "error": "Ya hay una cita en ese horario",
            "conflict": True,
            "conflicto_id": conflicto["id"],
        }), 409

    conn.execute(
        """INSERT INTO appointments (patient_id, fecha_hora, duracion_minutos, tipo_tratamiento, estado, notas)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (
            body["patient_id"], fecha_hora, duracion,
            body.get("tipo_tratamiento"), body.get("estado", "agendada"), body.get("notas"),
        ),
    )
    conn.commit()
    new_id = conn.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
    row = conn.execute(
        """SELECT appointments.*, patients.nombre AS patient_nombre
           FROM appointments LEFT JOIN patients ON patients.id = appointments.patient_id
           WHERE appointments.id = ?""",
        (new_id,),
    ).fetchone()
    conn.close()
    return jsonify(serialize_cita(row)), 201


@app.route("/api/citas/<int:cita_id>", methods=["PUT"])
@login_required("doctora", "asistente")
def update_cita(cita_id):
    body = request.get_json(silent=True) or {}
    conn = get_db()
    row = conn.execute("SELECT * FROM appointments WHERE id = ?", (cita_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Cita no encontrada"}), 404

    fields = ["patient_id", "fecha_hora", "duracion_minutos", "tipo_tratamiento", "estado", "notas"]
    updates = {f: body[f] for f in fields if f in body}

    if ("fecha_hora" in updates or "duracion_minutos" in updates) and not body.get("forzar"):
        fecha_hora = updates.get("fecha_hora", row["fecha_hora"])
        duracion = updates.get("duracion_minutos", row["duracion_minutos"])
        conflicto = appointments_overlap(conn, fecha_hora, duracion, exclude_id=cita_id)
        if conflicto:
            conn.close()
            return jsonify({
                "error": "Ya hay una cita en ese horario",
                "conflict": True,
                "conflicto_id": conflicto["id"],
            }), 409

    if updates:
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        conn.execute(f"UPDATE appointments SET {set_clause} WHERE id = ?", (*updates.values(), cita_id))
        conn.commit()

    row = conn.execute(
        """SELECT appointments.*, patients.nombre AS patient_nombre
           FROM appointments LEFT JOIN patients ON patients.id = appointments.patient_id
           WHERE appointments.id = ?""",
        (cita_id,),
    ).fetchone()
    conn.close()
    return jsonify(serialize_cita(row))


@app.route("/api/citas/<int:cita_id>", methods=["DELETE"])
@login_required("doctora", "asistente")
def delete_cita(cita_id):
    conn = get_db()
    conn.execute("DELETE FROM appointments WHERE id = ?", (cita_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Consultas / tratamientos
# ---------------------------------------------------------------------------

def apply_visit_items(conn, items):
    """Valida stock suficiente para cada insumo y lo descuenta.
    Devuelve (items_resueltos, costo_insumos_total). Lanza ValueError con un
    mensaje legible si falta stock o el insumo no existe."""
    resolved = []
    costo_insumos = 0.0
    for item in items:
        insumo = conn.execute("SELECT * FROM inventory WHERE id = ?", (item.get("inventory_id"),)).fetchone()
        if not insumo:
            raise ValueError("Uno de los insumos seleccionados ya no existe")
        try:
            cantidad = float(item.get("cantidad"))
        except (TypeError, ValueError):
            raise ValueError(f"Cantidad invalida para \"{insumo['nombre']}\"")
        if cantidad <= 0:
            raise ValueError(f"Cantidad invalida para \"{insumo['nombre']}\"")
        if insumo["stock"] < cantidad:
            raise ValueError(f"Stock insuficiente de \"{insumo['nombre']}\" (disponible: {insumo['stock']})")
        raw_costo = item.get("costo_unitario")
        costo_unitario = float(raw_costo) if raw_costo not in (None, "") else float(insumo["costo"] or 0)
        conn.execute(
            "UPDATE inventory SET stock = stock - ?, updated_at = datetime('now') WHERE id = ?",
            (cantidad, insumo["id"]),
        )
        costo_insumos += cantidad * costo_unitario
        resolved.append({"inventory_id": insumo["id"], "cantidad": cantidad, "costo_unitario": costo_unitario})
    return resolved, round(costo_insumos, 2)


def restore_visit_items(conn, visita_id):
    """Devuelve al inventario el stock consumido por una consulta y borra sus renglones."""
    rows = conn.execute(
        "SELECT inventory_id, cantidad FROM visit_items WHERE visit_id = ?", (visita_id,)
    ).fetchall()
    for r in rows:
        conn.execute("UPDATE inventory SET stock = stock + ? WHERE id = ?", (r["cantidad"], r["inventory_id"]))
    conn.execute("DELETE FROM visit_items WHERE visit_id = ?", (visita_id,))


def get_visita_row(conn, visita_id):
    return conn.execute(
        """SELECT visits.*, patients.nombre AS patient_nombre FROM visits
           LEFT JOIN patients ON patients.id = visits.patient_id
           WHERE visits.id = ?""",
        (visita_id,),
    ).fetchone()


@app.route("/api/visitas", methods=["GET"])
@login_required("doctora")
def list_visitas():
    patient_id = request.args.get("patient_id")
    conn = get_db()
    query = """SELECT visits.*, patients.nombre AS patient_nombre FROM visits
               LEFT JOIN patients ON patients.id = visits.patient_id"""
    params = []
    if patient_id:
        query += " WHERE visits.patient_id = ?"
        params.append(patient_id)
    query += " ORDER BY visits.fecha DESC, visits.id DESC"
    rows = conn.execute(query, params).fetchall()

    result = []
    for row in rows:
        payments = [dict(p) for p in conn.execute(
            "SELECT monto FROM payments WHERE visit_id = ?", (row["id"],)
        ).fetchall()]
        result.append(serialize_visita(row, payments=payments))
    conn.close()
    return jsonify(result)


@app.route("/api/visitas/<int:visita_id>", methods=["GET"])
@login_required("doctora")
def get_visita(visita_id):
    conn = get_db()
    row = get_visita_row(conn, visita_id)
    if not row:
        conn.close()
        return jsonify({"error": "Consulta no encontrada"}), 404

    items_rows = conn.execute(
        """SELECT visit_items.*, inventory.nombre AS insumo_nombre FROM visit_items
           LEFT JOIN inventory ON inventory.id = visit_items.inventory_id
           WHERE visit_id = ?""",
        (visita_id,),
    ).fetchall()
    payments_rows = conn.execute(
        "SELECT * FROM payments WHERE visit_id = ? ORDER BY fecha, id", (visita_id,)
    ).fetchall()
    conn.close()

    items = [
        {
            "id": i["id"], "inventory_id": i["inventory_id"], "insumo_nombre": i["insumo_nombre"],
            "cantidad": i["cantidad"], "costo_unitario": i["costo_unitario"],
        }
        for i in items_rows
    ]
    payments = [
        {"id": p["id"], "fecha": p["fecha"], "monto": p["monto"], "metodo": p["metodo"]}
        for p in payments_rows
    ]
    return jsonify(serialize_visita(row, items=items, payments=payments))


@app.route("/api/visitas", methods=["POST"])
@login_required("doctora")
def create_visita():
    body = request.get_json(silent=True) or {}
    if not body.get("patient_id"):
        return jsonify({"error": "El paciente es obligatorio"}), 400

    conn = get_db()
    try:
        resolved_items, costo_insumos = apply_visit_items(conn, body.get("items") or [])
    except ValueError as e:
        conn.close()
        return jsonify({"error": str(e)}), 400

    costo_mano_obra = float(body.get("costo_mano_obra") or 0)
    precio_total = body.get("precio_total")
    precio_total = float(precio_total) if precio_total not in (None, "") else round(costo_mano_obra + costo_insumos, 2)
    fecha = body.get("fecha") or date.today().isoformat()

    conn.execute(
        """INSERT INTO visits (patient_id, appointment_id, fecha, tipo_tratamiento,
           costo_mano_obra, costo_insumos, precio_total, notas)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            body["patient_id"], body.get("appointment_id"), fecha, body.get("tipo_tratamiento"),
            costo_mano_obra, costo_insumos, precio_total, body.get("notas"),
        ),
    )
    visita_id = conn.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]

    for item in resolved_items:
        conn.execute(
            "INSERT INTO visit_items (visit_id, inventory_id, cantidad, costo_unitario) VALUES (?, ?, ?, ?)",
            (visita_id, item["inventory_id"], item["cantidad"], item["costo_unitario"]),
        )

    if body.get("appointment_id"):
        conn.execute("UPDATE appointments SET estado = 'completada' WHERE id = ?", (body["appointment_id"],))

    conn.commit()
    row = get_visita_row(conn, visita_id)
    conn.close()
    return jsonify(serialize_visita(row, items=[], payments=[])), 201


@app.route("/api/visitas/<int:visita_id>", methods=["PUT"])
@login_required("doctora")
def update_visita(visita_id):
    body = request.get_json(silent=True) or {}
    conn = get_db()
    row = conn.execute("SELECT * FROM visits WHERE id = ?", (visita_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Consulta no encontrada"}), 404

    if "items" in body:
        restore_visit_items(conn, visita_id)
        try:
            resolved_items, costo_insumos = apply_visit_items(conn, body["items"] or [])
        except ValueError as e:
            conn.rollback()
            conn.close()
            return jsonify({"error": str(e)}), 400
        for item in resolved_items:
            conn.execute(
                "INSERT INTO visit_items (visit_id, inventory_id, cantidad, costo_unitario) VALUES (?, ?, ?, ?)",
                (visita_id, item["inventory_id"], item["cantidad"], item["costo_unitario"]),
            )
    else:
        costo_insumos = row["costo_insumos"]

    updates = {f: body[f] for f in TRATAMIENTO_FIELDS if f in body}
    updates["costo_insumos"] = costo_insumos
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    conn.execute(f"UPDATE visits SET {set_clause} WHERE id = ?", (*updates.values(), visita_id))
    conn.commit()

    row = get_visita_row(conn, visita_id)
    conn.close()
    return jsonify(serialize_visita(row))


@app.route("/api/visitas/<int:visita_id>", methods=["DELETE"])
@login_required("doctora")
def delete_visita(visita_id):
    conn = get_db()
    row = conn.execute("SELECT id FROM visits WHERE id = ?", (visita_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Consulta no encontrada"}), 404

    restore_visit_items(conn, visita_id)
    conn.execute("DELETE FROM payments WHERE visit_id = ?", (visita_id,))
    conn.execute("DELETE FROM visits WHERE id = ?", (visita_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/visitas/<int:visita_id>/pagos", methods=["POST"])
@login_required("doctora")
def add_pago(visita_id):
    body = request.get_json(silent=True) or {}
    try:
        monto = float(body.get("monto"))
    except (TypeError, ValueError):
        monto = 0
    if monto <= 0:
        return jsonify({"error": "El monto debe ser mayor a 0"}), 400

    conn = get_db()
    visita = conn.execute("SELECT id FROM visits WHERE id = ?", (visita_id,)).fetchone()
    if not visita:
        conn.close()
        return jsonify({"error": "Consulta no encontrada"}), 404

    conn.execute(
        "INSERT INTO payments (visit_id, fecha, monto, metodo) VALUES (?, ?, ?, ?)",
        (visita_id, body.get("fecha") or date.today().isoformat(), monto, body.get("metodo")),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True}), 201


@app.route("/api/pagos/<int:pago_id>", methods=["DELETE"])
@login_required("doctora")
def delete_pago(pago_id):
    conn = get_db()
    conn.execute("DELETE FROM payments WHERE id = ?", (pago_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Finanzas: gastos, otros ingresos, nomina
# ---------------------------------------------------------------------------

def crud_financiero(table, fields, required_field="concepto"):
    """Registra las 4 rutas GET/POST/PUT/DELETE para una tabla financiera simple
    (expenses, other_incomes, payroll), que comparten la misma forma basica."""

    def list_rows():
        conn = get_db()
        rows = conn.execute(f"SELECT * FROM {table} ORDER BY fecha DESC, id DESC").fetchall()
        conn.close()
        return jsonify([dict(r) for r in rows])

    def create_row():
        body = request.get_json(silent=True) or {}
        if not body.get(required_field):
            return jsonify({"error": f"El campo '{required_field}' es obligatorio"}), 400
        try:
            monto = float(body.get("monto"))
        except (TypeError, ValueError):
            monto = 0
        if monto <= 0:
            return jsonify({"error": "El monto debe ser mayor a 0"}), 400

        columns = [f for f in fields if f != "id"]
        values = []
        for col in columns:
            if col == "monto":
                values.append(monto)
            elif col == "fecha":
                values.append(body.get("fecha") or date.today().isoformat())
            else:
                values.append(body.get(col))
        placeholders = ", ".join("?" for _ in columns)
        conn = get_db()
        conn.execute(f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({placeholders})", values)
        conn.commit()
        new_id = conn.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
        row = conn.execute(f"SELECT * FROM {table} WHERE id = ?", (new_id,)).fetchone()
        conn.close()
        return jsonify(dict(row)), 201

    def update_row(row_id):
        body = request.get_json(silent=True) or {}
        conn = get_db()
        row = conn.execute(f"SELECT * FROM {table} WHERE id = ?", (row_id,)).fetchone()
        if not row:
            conn.close()
            return jsonify({"error": "Registro no encontrado"}), 404
        updates = {f: body[f] for f in fields if f in body and f != "id"}
        if "monto" in updates:
            try:
                if float(updates["monto"]) <= 0:
                    conn.close()
                    return jsonify({"error": "El monto debe ser mayor a 0"}), 400
            except (TypeError, ValueError):
                conn.close()
                return jsonify({"error": "Monto invalido"}), 400
        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            conn.execute(f"UPDATE {table} SET {set_clause} WHERE id = ?", (*updates.values(), row_id))
            conn.commit()
        row = conn.execute(f"SELECT * FROM {table} WHERE id = ?", (row_id,)).fetchone()
        conn.close()
        return jsonify(dict(row))

    def delete_row(row_id):
        conn = get_db()
        conn.execute(f"DELETE FROM {table} WHERE id = ?", (row_id,))
        conn.commit()
        conn.close()
        return jsonify({"ok": True})

    return list_rows, create_row, update_row, delete_row


_gastos_list, _gastos_create, _gastos_update, _gastos_delete = crud_financiero(
    "expenses", ["fecha", "concepto", "monto", "categoria"]
)
app.add_url_rule("/api/gastos", "list_gastos", login_required("doctora")(_gastos_list), methods=["GET"])
app.add_url_rule("/api/gastos", "create_gasto", login_required("doctora")(_gastos_create), methods=["POST"])
app.add_url_rule("/api/gastos/<int:row_id>", "update_gasto", login_required("doctora")(_gastos_update), methods=["PUT"])
app.add_url_rule("/api/gastos/<int:row_id>", "delete_gasto", login_required("doctora")(_gastos_delete), methods=["DELETE"])

_ingresos_list, _ingresos_create, _ingresos_update, _ingresos_delete = crud_financiero(
    "other_incomes", ["fecha", "concepto", "monto"]
)
app.add_url_rule("/api/otros-ingresos", "list_ingresos", login_required("doctora")(_ingresos_list), methods=["GET"])
app.add_url_rule("/api/otros-ingresos", "create_ingreso", login_required("doctora")(_ingresos_create), methods=["POST"])
app.add_url_rule("/api/otros-ingresos/<int:row_id>", "update_ingreso", login_required("doctora")(_ingresos_update), methods=["PUT"])
app.add_url_rule("/api/otros-ingresos/<int:row_id>", "delete_ingreso", login_required("doctora")(_ingresos_delete), methods=["DELETE"])

_nomina_list, _nomina_create, _nomina_update, _nomina_delete = crud_financiero(
    "payroll", ["person", "fecha", "monto", "concepto"], required_field="person"
)
app.add_url_rule("/api/nomina", "list_nomina", login_required("doctora")(_nomina_list), methods=["GET"])
app.add_url_rule("/api/nomina", "create_nomina", login_required("doctora")(_nomina_create), methods=["POST"])
app.add_url_rule("/api/nomina/<int:row_id>", "update_nomina", login_required("doctora")(_nomina_update), methods=["PUT"])
app.add_url_rule("/api/nomina/<int:row_id>", "delete_nomina", login_required("doctora")(_nomina_delete), methods=["DELETE"])


# ---------------------------------------------------------------------------
# Reportes
# ---------------------------------------------------------------------------

@app.route("/api/reportes")
@login_required("doctora")
def reportes():
    hoy = date.today().isoformat()
    desde = request.args.get("desde") or hoy[:8] + "01"
    hasta_param = request.args.get("hasta")
    hasta_exclusive = (
        datetime.strptime(hasta_param, "%Y-%m-%d").date() + timedelta(days=1)
    ).isoformat() if hasta_param else None

    conn = get_db()

    def sum_range(table, date_col="fecha"):
        if hasta_exclusive:
            row = conn.execute(
                f"SELECT COALESCE(SUM(monto), 0) AS total FROM {table} WHERE {date_col} >= ? AND {date_col} < ?",
                (desde, hasta_exclusive),
            ).fetchone()
        else:
            row = conn.execute(
                f"SELECT COALESCE(SUM(monto), 0) AS total FROM {table} WHERE {date_col} >= ?", (desde,)
            ).fetchone()
        return round(row["total"], 2)

    ingresos_consultas = sum_range("payments")
    otros_ingresos = sum_range("other_incomes")
    gastos = sum_range("expenses")
    nomina = sum_range("payroll")

    top_insumos = conn.execute(
        """SELECT inventory.nombre, SUM(visit_items.cantidad) AS cantidad_total
           FROM visit_items
           JOIN visits ON visits.id = visit_items.visit_id
           JOIN inventory ON inventory.id = visit_items.inventory_id
           WHERE visits.fecha >= ? AND (? IS NULL OR visits.fecha < ?)
           GROUP BY inventory.id ORDER BY cantidad_total DESC LIMIT 5""",
        (desde, hasta_exclusive, hasta_exclusive),
    ).fetchall()

    por_vencer = conn.execute(
        """SELECT nombre, fecha_caducidad, stock FROM inventory
           WHERE fecha_caducidad IS NOT NULL AND fecha_caducidad != ''
             AND date(fecha_caducidad) <= date(?, '+30 days')
           ORDER BY fecha_caducidad LIMIT 10""",
        (hoy,),
    ).fetchall()

    proximas_citas = conn.execute(
        """SELECT appointments.fecha_hora, appointments.tipo_tratamiento, patients.nombre AS patient_nombre
           FROM appointments LEFT JOIN patients ON patients.id = appointments.patient_id
           WHERE appointments.fecha_hora >= ? AND appointments.estado NOT IN ('cancelada', 'completada')
           ORDER BY appointments.fecha_hora LIMIT 10""",
        (hoy,),
    ).fetchall()

    conn.close()

    return jsonify({
        "desde": desde,
        "hasta": hasta_param,
        "ingresos_consultas": ingresos_consultas,
        "otros_ingresos": otros_ingresos,
        "total_ingresos": round(ingresos_consultas + otros_ingresos, 2),
        "gastos": gastos,
        "nomina": nomina,
        "total_egresos": round(gastos + nomina, 2),
        "balance": round(ingresos_consultas + otros_ingresos - gastos - nomina, 2),
        "insumos_mas_consumidos": [dict(r) for r in top_insumos],
        "insumos_por_vencer": [dict(r) for r in por_vencer],
        "proximas_citas": [dict(r) for r in proximas_citas],
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8600))
    app.run(host="0.0.0.0", port=port)
