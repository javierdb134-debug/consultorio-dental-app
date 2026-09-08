-- Esquema completo del sistema. Las tablas de fases futuras se crean vacías desde
-- ahora para no requerir migraciones cuando se implementen esas pantallas.

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL CHECK(role IN ('doctora','asistente')),
    name TEXT NOT NULL,
    username TEXT UNIQUE,
    password_hash TEXT,
    pin_hash TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    categoria TEXT,
    unidad_medida TEXT,
    stock REAL NOT NULL DEFAULT 0,
    stock_minimo REAL NOT NULL DEFAULT 0,
    costo REAL,
    precio REAL,
    proveedor TEXT,
    lote TEXT,
    fecha_caducidad TEXT,
    fecha_ultima_compra TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    telefono TEXT,
    correo TEXT,
    fecha_nacimiento TEXT,
    alergias TEXT,
    recall_meses INTEGER NOT NULL DEFAULT 6,
    proxima_revision TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS patient_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL REFERENCES patients(id),
    fecha TEXT NOT NULL DEFAULT (datetime('now')),
    autor TEXT,
    texto TEXT NOT NULL
);

-- Odontograma: una fila por pieza dental que se aparta del estado "sano" por
-- defecto. Numeracion FDI de dos digitos (11-18, 21-28, 31-38, 41-48).
CREATE TABLE IF NOT EXISTS patient_teeth (
    patient_id INTEGER NOT NULL REFERENCES patients(id),
    tooth TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'sano'
        CHECK(estado IN ('sano','tratado','a_tratar','ausente')),
    nota TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (patient_id, tooth)
);

-- Fotos y radiografias adjuntas al expediente. Los archivos en si viven en
-- disco (carpeta UPLOADS_DIR), nunca en git ni en este archivo.
CREATE TABLE IF NOT EXISTS patient_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL REFERENCES patients(id),
    filename TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type TEXT,
    uploaded_by TEXT,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER REFERENCES patients(id),
    fecha_hora TEXT NOT NULL,
    duracion_minutos INTEGER NOT NULL DEFAULT 30,
    tipo_tratamiento TEXT,
    estado TEXT NOT NULL DEFAULT 'agendada'
        CHECK(estado IN ('agendada','confirmada','completada','cancelada','no_asistio')),
    notas TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER REFERENCES patients(id),
    appointment_id INTEGER REFERENCES appointments(id),
    fecha TEXT NOT NULL DEFAULT (datetime('now')),
    tipo_tratamiento TEXT,
    costo_mano_obra REAL DEFAULT 0,
    costo_insumos REAL DEFAULT 0,
    precio_total REAL DEFAULT 0,
    notas TEXT
);

CREATE TABLE IF NOT EXISTS visit_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visit_id INTEGER NOT NULL REFERENCES visits(id),
    inventory_id INTEGER REFERENCES inventory(id),
    cantidad REAL NOT NULL,
    costo_unitario REAL
);

CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visit_id INTEGER NOT NULL REFERENCES visits(id),
    fecha TEXT NOT NULL DEFAULT (datetime('now')),
    monto REAL NOT NULL,
    metodo TEXT
);

CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL DEFAULT (datetime('now')),
    concepto TEXT NOT NULL,
    monto REAL NOT NULL,
    categoria TEXT
);

CREATE TABLE IF NOT EXISTS other_incomes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL DEFAULT (datetime('now')),
    concepto TEXT NOT NULL,
    monto REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS payroll (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person TEXT NOT NULL,
    fecha TEXT NOT NULL DEFAULT (datetime('now')),
    monto REAL NOT NULL,
    concepto TEXT
);
