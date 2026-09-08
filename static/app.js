const state = {
  role: null,
  name: null,
  insumos: [],
  pacientes: [],
  citas: [],
  citaFecha: null,
  consultas: [],
};

function dateToStr(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function todayStr() {
  return dateToStr(new Date());
}

function addDaysStr(dateStr, delta) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return dateToStr(dt);
}

state.citaFecha = todayStr();

const CATEGORIA_SUGERIDAS = [
  "Anestesia", "Resinas", "Guantes", "Agujas", "Material de impresion",
  "Algodon y gasas", "Desinfeccion", "Endodoncia", "Ortodoncia", "Otro",
];

const FDI_ROWS = [
  ["18", "17", "16", "15", "14", "13", "12", "11", "21", "22", "23", "24", "25", "26", "27", "28"],
  ["48", "47", "46", "45", "44", "43", "42", "41", "31", "32", "33", "34", "35", "36", "37", "38"],
];

const ESTADO_DIENTE_LABEL = {
  sano: "Sano", tratado: "Tratado", a_tratar: "Por tratar", ausente: "Ausente",
};

const ESTADO_CITA_LABEL = {
  agendada: "Agendada", confirmada: "Confirmada", completada: "Completada",
  cancelada: "Cancelada", no_asistio: "No asistio",
};

const TRATAMIENTO_SUGERIDOS = [
  "Consulta general", "Limpieza dental", "Extraccion", "Resina", "Endodoncia",
  "Corona", "Blanqueamiento", "Ajuste de ortodoncia", "Radiografia", "Otro",
];

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: "same-origin",
  });

  let data = null;
  try { data = await res.json(); } catch (_) { /* respuesta sin cuerpo */ }

  if (!res.ok) {
    const message = (data && data.error) || "Ocurrio un error inesperado";
    const err = new Error(message);
    err.data = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child) node.appendChild(child);
  }
  return node;
}

function formatMoney(value) {
  if (value === null || value === undefined || value === "") return "-";
  return Number(value).toLocaleString("es", { style: "currency", currency: "USD" });
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function shiftCitaDay(deltaDays) {
  state.citaFecha = addDaysStr(state.citaFecha, deltaDays);
  document.getElementById("filter-citas-fecha").value = state.citaFecha;
  loadCitas();
}

function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
  document.getElementById("modal-content").innerHTML = "";
}

function openModal(node) {
  const content = document.getElementById("modal-content");
  content.innerHTML = "";
  content.appendChild(node);
  document.getElementById("modal-overlay").classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

async function initLogin() {
  const bootstrap = await api("/api/bootstrap");
  document.getElementById("login-clinic-name").textContent = bootstrap.clinicName;

  const select = document.getElementById("select-asistente-name");
  select.innerHTML = "";
  if (bootstrap.asistentes.length === 0) {
    select.appendChild(el("option", { value: "", text: "No hay asistentes registrados" }));
  } else {
    bootstrap.asistentes.forEach((name) => {
      select.appendChild(el("option", { value: name, text: name }));
    });
  }

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      document.getElementById("form-login-doctora").classList.toggle("hidden", tab !== "doctora");
      document.getElementById("form-login-asistente").classList.toggle("hidden", tab !== "asistente");
      document.getElementById("login-error").classList.add("hidden");
    });
  });

  document.getElementById("form-login-doctora").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      const result = await api("/api/login", {
        method: "POST",
        body: { username: form.get("username"), password: form.get("password") },
      });
      await enterApp(result);
    } catch (err) {
      showLoginError(err.message);
    }
  });

  document.getElementById("form-login-asistente").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      const result = await api("/api/login-asistente", {
        method: "POST",
        body: { name: form.get("name"), pin: form.get("pin") },
      });
      await enterApp(result);
    } catch (err) {
      showLoginError(err.message);
    }
  });
}

function showLoginError(message) {
  const box = document.getElementById("login-error");
  box.textContent = message;
  box.classList.remove("hidden");
}

async function enterApp({ role, name }) {
  state.role = role;
  state.name = name;

  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("app-screen").classList.remove("hidden");
  document.getElementById("user-name").textContent = `${name} (${role})`;
  document.getElementById("nav-settings").classList.toggle("hidden", role !== "doctora");
  document.getElementById("nav-consultas").classList.toggle("hidden", role !== "doctora");
  document.getElementById("btn-new-insumo").classList.toggle("hidden", role !== "doctora");
  document.querySelectorAll(".doctora-only").forEach((n) => n.classList.toggle("hidden", role !== "doctora"));

  const bootstrap = await api("/api/bootstrap");
  document.getElementById("app-clinic-name").textContent = bootstrap.clinicName;

  document.getElementById("filter-citas-fecha").value = state.citaFecha;
  await loadPacientes();
  await loadCitas();
  await loadInsumos();
  if (role === "doctora") {
    await loadConsultas();
    await loadSettingsView();
  }
}

// ---------------------------------------------------------------------------
// Pacientes
// ---------------------------------------------------------------------------

async function loadPacientes() {
  const q = document.getElementById("filter-pacientes").value.trim();
  state.pacientes = await api(`/api/pacientes${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  renderPacientes();
}

function renderPacientes() {
  const tbody = document.getElementById("pacientes-tbody");
  tbody.innerHTML = "";
  document.getElementById("pacientes-empty").classList.toggle("hidden", state.pacientes.length > 0);

  state.pacientes.forEach((p) => {
    const tr = el("tr", {});
    tr.appendChild(el("td", { text: p.nombre }));
    tr.appendChild(el("td", { text: p.telefono || "-" }));
    tr.appendChild(el("td", { text: p.alergias || "-" }));

    const revTd = el("td", { text: p.proxima_revision || "-" });
    if (p.revision_pendiente) revTd.appendChild(el("span", { class: "tag tag-warning", text: "Pronto" }));
    tr.appendChild(revTd);

    tr.appendChild(el("td", {}, [
      el("button", { class: "btn-secondary", text: "Ver / Editar", onclick: () => openPacienteDetail(p.id) }),
    ]));
    tbody.appendChild(tr);
  });
}

function openPacienteModal(paciente) {
  const isEdit = Boolean(paciente);
  const data = paciente || {};

  const field = (label, name, opts = {}) => el("label", {}, [
    document.createTextNode(label),
    el("input", {
      name, type: opts.type || "text",
      value: data[name] !== undefined && data[name] !== null ? data[name] : "",
    }),
  ]);

  const form = el("form", {}, [
    el("h3", { text: isEdit ? `Editar: ${paciente.nombre}` : "Nuevo paciente" }),
    field("Nombre *", "nombre"),
    el("div", { class: "form-grid" }, [
      field("Telefono", "telefono"),
      field("Correo", "correo"),
      field("Fecha de nacimiento", "fecha_nacimiento", { type: "date" }),
      field("Recordatorio de revision cada (meses)", "recall_meses", { type: "number" }),
      field("Proxima revision", "proxima_revision", { type: "date" }),
    ]),
    el("label", {}, [
      document.createTextNode("Alergias"),
      el("input", { name: "alergias", type: "text", value: data.alergias || "" }),
    ]),
    el("div", { class: "modal-actions" }, [
      el("button", { type: "button", class: "btn-secondary", text: "Cancelar", onclick: closeModal }),
      el("button", { type: "submit", class: "btn-primary", text: isEdit ? "Guardar cambios" : "Crear paciente" }),
    ]),
  ]);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
      if (isEdit) {
        await api(`/api/pacientes/${paciente.id}`, { method: "PUT", body: payload });
      } else {
        await api("/api/pacientes", { method: "POST", body: payload });
      }
      closeModal();
      await loadPacientes();
    } catch (err) {
      alert(err.message);
    }
  });

  openModal(form);
}

async function openPacienteDetail(patientId) {
  const data = await api(`/api/pacientes/${patientId}`);

  const container = el("div", {}, [
    el("h3", { text: data.nombre }),
  ]);

  if (data.alergias) {
    container.appendChild(el("div", { class: "allergy-banner", text: `Alergias: ${data.alergias}` }));
  }

  container.appendChild(el("p", {
    text: `Telefono: ${data.telefono || "-"}  |  Correo: ${data.correo || "-"}  |  `
      + `Proxima revision: ${data.proxima_revision || "-"}`,
  }));
  container.appendChild(el("button", {
    class: "btn-secondary", text: "Editar datos",
    onclick: () => { closeModal(); openPacienteModal(data); },
  }));

  container.appendChild(el("h3", { text: "Odontograma" }));
  const odontograma = el("div", { class: "odontograma" });
  const panelHolder = el("div", {});
  FDI_ROWS.forEach((row) => {
    const rowEl = el("div", { class: "odontograma-row" });
    row.forEach((tooth) => {
      const info = data.dientes[tooth] || { estado: "sano", nota: null };
      const btn = el("button", {
        type: "button",
        class: `tooth-btn estado-${info.estado}`,
        text: tooth,
        onclick: () => renderToothPanel(panelHolder, patientId, tooth, info, odontograma),
      });
      btn.dataset.tooth = tooth;
      rowEl.appendChild(btn);
    });
    odontograma.appendChild(rowEl);
  });
  container.appendChild(odontograma);
  container.appendChild(panelHolder);

  container.appendChild(el("h3", { text: "Historial / notas clinicas" }));
  const notesList = el("div", { class: "notes-list" });
  if (data.notas.length === 0) {
    notesList.appendChild(el("p", { class: "empty-text", text: "Sin notas todavia." }));
  }
  data.notas.forEach((n) => {
    notesList.appendChild(el("div", { class: "note-item" }, [
      el("div", { class: "note-meta", text: `${n.fecha}${n.autor ? " - " + n.autor : ""}` }),
      el("div", { text: n.texto }),
    ]));
  });
  container.appendChild(notesList);

  const noteForm = el("form", { class: "inline-form" }, [
    el("label", { style: "flex:1" }, [
      document.createTextNode("Nueva nota"),
      el("input", { name: "texto", type: "text", required: "required" }),
    ]),
    el("button", { type: "submit", class: "btn-primary", text: "Agregar" }),
  ]);
  noteForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const texto = new FormData(noteForm).get("texto");
    try {
      await api(`/api/pacientes/${patientId}/notas`, { method: "POST", body: { texto } });
      closeModal();
      await openPacienteDetail(patientId);
    } catch (err) {
      alert(err.message);
    }
  });
  container.appendChild(noteForm);

  openModal(container);
}

function renderToothPanel(panelHolder, patientId, tooth, info, odontograma) {
  odontograma.querySelectorAll(".tooth-btn").forEach((b) => b.classList.remove("selected"));
  odontograma.querySelector(`[data-tooth="${tooth}"]`).classList.add("selected");

  let estadoActual = info.estado;

  const panel = el("div", { class: "tooth-panel" }, [
    el("strong", { text: `Pieza ${tooth}` }),
  ]);

  const estadoOptions = el("div", { class: "estado-options" });
  Object.entries(ESTADO_DIENTE_LABEL).forEach(([value, label]) => {
    const btn = el("button", {
      type: "button",
      class: value === estadoActual ? "btn-secondary active" : "btn-secondary",
      text: label,
      onclick: () => {
        estadoActual = value;
        estadoOptions.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      },
    });
    estadoOptions.appendChild(btn);
  });
  panel.appendChild(estadoOptions);

  const notaInput = el("input", { type: "text", value: info.nota || "", placeholder: "Nota de la pieza (opcional)" });
  panel.appendChild(notaInput);

  const saveBtn = el("button", {
    class: "btn-primary", text: "Guardar pieza",
    onclick: async () => {
      try {
        await api(`/api/pacientes/${patientId}/dientes/${tooth}`, {
          method: "PUT", body: { estado: estadoActual, nota: notaInput.value },
        });
        info.estado = estadoActual;
        info.nota = notaInput.value;
        const btnEl = odontograma.querySelector(`[data-tooth="${tooth}"]`);
        btnEl.className = `tooth-btn selected estado-${estadoActual}`;
      } catch (err) {
        alert(err.message);
      }
    },
  });
  panel.appendChild(el("div", { class: "modal-actions" }, [saveBtn]));

  panelHolder.innerHTML = "";
  panelHolder.appendChild(panel);
}

// ---------------------------------------------------------------------------
// Citas
// ---------------------------------------------------------------------------

async function loadCitas() {
  const desde = `${state.citaFecha}T00:00`;
  const hasta = `${addDaysStr(state.citaFecha, 1)}T00:00`;
  state.citas = await api(`/api/citas?desde=${desde}&hasta=${hasta}`);
  renderCitas();
}

function renderCitas() {
  const tbody = document.getElementById("citas-tbody");
  tbody.innerHTML = "";
  document.getElementById("citas-empty").classList.toggle("hidden", state.citas.length > 0);

  state.citas.forEach((c) => {
    const hora = c.fecha_hora.slice(11, 16);
    const tr = el("tr", {});
    tr.appendChild(el("td", { text: hora }));
    tr.appendChild(el("td", { text: c.patient_nombre || "-" }));
    tr.appendChild(el("td", { text: c.tipo_tratamiento || "-" }));
    tr.appendChild(el("td", { text: `${c.duracion_minutos} min` }));

    const estadoTd = el("td", {});
    const estadoSelect = el("select", {
      onchange: async (e) => {
        try {
          await api(`/api/citas/${c.id}`, { method: "PUT", body: { estado: e.target.value } });
          await loadCitas();
        } catch (err) {
          alert(err.message);
        }
      },
    }, Object.entries(ESTADO_CITA_LABEL).map(([value, label]) =>
      el("option", { value, text: label, selected: value === c.estado ? "selected" : undefined })));
    estadoTd.appendChild(estadoSelect);
    tr.appendChild(estadoTd);

    tr.appendChild(el("td", {}, [
      el("div", { class: "row-actions" }, [
        el("button", { class: "btn-secondary", text: "Editar", onclick: () => openCitaModal(c) }),
        state.role === "doctora" && el("button", {
          class: "btn-secondary", text: "Registrar consulta",
          onclick: () => openConsultaModal(null, {
            patient_id: c.patient_id, appointment_id: c.id,
            tipo_tratamiento: c.tipo_tratamiento, fecha: c.fecha_hora.slice(0, 10),
          }),
        }),
        el("button", { class: "btn-danger", text: "Eliminar", onclick: () => deleteCita(c) }),
      ]),
    ]));

    tbody.appendChild(tr);
  });
}

function openCitaModal(cita) {
  const isEdit = Boolean(cita);
  const data = cita || {};

  const pacienteOptions = state.pacientes.map((p) =>
    el("option", { value: p.id, text: p.nombre, selected: data.patient_id === p.id ? "selected" : undefined }));

  const form = el("form", {}, [
    el("h3", { text: isEdit ? "Editar cita" : "Nueva cita" }),
    el("label", {}, [
      document.createTextNode("Paciente *"),
      el("select", { name: "patient_id", required: "required" }, pacienteOptions),
    ]),
    el("div", { class: "form-grid" }, [
      el("label", {}, [
        document.createTextNode("Fecha y hora *"),
        el("input", {
          name: "fecha_hora", type: "datetime-local", required: "required",
          value: data.fecha_hora || `${state.citaFecha}T09:00`,
        }),
      ]),
      el("label", {}, [
        document.createTextNode("Duracion (minutos)"),
        el("input", { name: "duracion_minutos", type: "number", value: data.duracion_minutos || 30 }),
      ]),
      el("label", {}, [
        document.createTextNode("Tipo de tratamiento"),
        el("input", { name: "tipo_tratamiento", type: "text", value: data.tipo_tratamiento || "" }),
      ]),
    ]),
    el("label", {}, [
      document.createTextNode("Notas"),
      el("input", { name: "notas", type: "text", value: data.notas || "" }),
    ]),
    el("div", { class: "modal-actions" }, [
      el("button", { type: "button", class: "btn-secondary", text: "Cancelar", onclick: closeModal }),
      el("button", { type: "submit", class: "btn-primary", text: isEdit ? "Guardar cambios" : "Crear cita" }),
    ]),
  ]);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.patient_id = Number(payload.patient_id);
    await submitCita(isEdit ? cita.id : null, payload);
  });

  openModal(form);
}

async function submitCita(citaId, payload, forzar = false) {
  try {
    if (forzar) payload.forzar = true;
    if (citaId) {
      await api(`/api/citas/${citaId}`, { method: "PUT", body: payload });
    } else {
      await api("/api/citas", { method: "POST", body: payload });
    }
    closeModal();
    await loadCitas();
  } catch (err) {
    if (err.data && err.data.conflict && !forzar) {
      if (confirm("Ya hay una cita en ese horario. Deseas agendarla de todas formas?")) {
        await submitCita(citaId, payload, true);
      }
    } else {
      alert(err.message);
    }
  }
}

async function deleteCita(cita) {
  if (!confirm("Eliminar esta cita?")) return;
  try {
    await api(`/api/citas/${cita.id}`, { method: "DELETE" });
    await loadCitas();
  } catch (err) {
    alert(err.message);
  }
}

// ---------------------------------------------------------------------------
// Consultas / tratamientos
// ---------------------------------------------------------------------------

async function loadConsultas() {
  state.consultas = await api("/api/visitas");
  renderConsultas();
}

function renderConsultas() {
  const tbody = document.getElementById("consultas-tbody");
  tbody.innerHTML = "";
  document.getElementById("consultas-empty").classList.toggle("hidden", state.consultas.length > 0);

  state.consultas.forEach((c) => {
    const tr = el("tr", {});
    tr.appendChild(el("td", { text: c.fecha || "-" }));
    tr.appendChild(el("td", { text: c.patient_nombre || "-" }));
    tr.appendChild(el("td", { text: c.tipo_tratamiento || "-" }));
    tr.appendChild(el("td", { text: formatMoney(c.precio_total) }));
    tr.appendChild(el("td", { text: formatMoney(c.total_pagado) }));

    const saldoTd = el("td", { text: formatMoney(c.saldo) });
    if (c.saldo > 0) saldoTd.appendChild(el("span", { class: "tag tag-warning", text: "Pendiente" }));
    tr.appendChild(saldoTd);

    tr.appendChild(el("td", {}, [
      el("div", { class: "row-actions" }, [
        el("button", { class: "btn-secondary", text: "Ver / Editar", onclick: () => openConsultaDetail(c.id) }),
        el("button", { class: "btn-danger", text: "Eliminar", onclick: () => deleteConsulta(c) }),
      ]),
    ]));
    tbody.appendChild(tr);
  });
}

function buildItemRow(item) {
  const insumoOptions = [el("option", { value: "", text: "Selecciona un insumo..." })].concat(
    state.insumos.map((i) => el("option", {
      value: i.id,
      text: `${i.nombre} (stock: ${i.stock})`,
      selected: item && item.inventory_id === i.id ? "selected" : undefined,
    }))
  );

  const select = el("select", { class: "item-insumo" }, insumoOptions);
  const cantidadInput = el("input", {
    type: "number", step: "any", min: "0", class: "item-cantidad", placeholder: "Cantidad",
    value: item ? item.cantidad : "",
  });
  const costoInput = el("input", {
    type: "number", step: "any", min: "0", class: "item-costo", placeholder: "Costo unitario",
    value: item ? item.costo_unitario : "",
  });

  select.addEventListener("change", () => {
    const insumo = state.insumos.find((i) => String(i.id) === select.value);
    if (insumo && costoInput.value === "" && insumo.costo !== undefined) {
      costoInput.value = insumo.costo || 0;
    }
  });

  const row = el("div", { class: "item-row" }, [
    select, cantidadInput, costoInput,
    el("button", { type: "button", class: "btn-secondary", text: "Quitar", onclick: () => row.remove() }),
  ]);
  return row;
}

function openConsultaModal(consulta, prefill) {
  const isEdit = Boolean(consulta);
  const data = consulta || prefill || {};

  const pacienteOptions = state.pacientes.map((p) =>
    el("option", { value: p.id, text: p.nombre, selected: data.patient_id === p.id ? "selected" : undefined }));

  const itemsContainer = el("div", { class: "items-container" });
  (data.items || []).forEach((item) => itemsContainer.appendChild(buildItemRow(item)));

  const form = el("form", {}, [
    el("h3", { text: isEdit ? "Editar consulta" : "Nueva consulta" }),
    el("label", {}, [
      document.createTextNode("Paciente *"),
      el("select", { name: "patient_id", required: "required" }, pacienteOptions),
    ]),
    el("div", { class: "form-grid" }, [
      el("label", {}, [
        document.createTextNode("Fecha"),
        el("input", { name: "fecha", type: "date", value: data.fecha || todayStr() }),
      ]),
      el("label", {}, [
        document.createTextNode("Tratamiento"),
        el("input", { name: "tipo_tratamiento", type: "text", list: "tratamiento-options", value: data.tipo_tratamiento || "" }),
      ]),
      el("label", {}, [
        document.createTextNode("Costo de mano de obra"),
        el("input", { name: "costo_mano_obra", type: "number", step: "any", value: data.costo_mano_obra || 0 }),
      ]),
      el("label", {}, [
        document.createTextNode("Precio total (lo que se le cobra al paciente)"),
        el("input", { name: "precio_total", type: "number", step: "any", value: data.precio_total !== undefined ? data.precio_total : "" }),
      ]),
    ]),
    el("datalist", { id: "tratamiento-options" }, TRATAMIENTO_SUGERIDOS.map((t) => el("option", { value: t }))),
    el("label", {}, [
      document.createTextNode("Notas"),
      el("input", { name: "notas", type: "text", value: data.notas || "" }),
    ]),
    el("h3", { text: "Insumos usados" }),
    itemsContainer,
    el("button", {
      type: "button", class: "btn-secondary", text: "+ Agregar insumo",
      onclick: () => itemsContainer.appendChild(buildItemRow(null)),
    }),
    el("div", { class: "modal-actions" }, [
      el("button", { type: "button", class: "btn-secondary", text: "Cancelar", onclick: closeModal }),
      el("button", { type: "submit", class: "btn-primary", text: isEdit ? "Guardar cambios" : "Crear consulta" }),
    ]),
  ]);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const payload = {
      patient_id: Number(formData.get("patient_id")),
      fecha: formData.get("fecha"),
      tipo_tratamiento: formData.get("tipo_tratamiento"),
      costo_mano_obra: formData.get("costo_mano_obra"),
      notas: formData.get("notas"),
    };
    const precioTotal = formData.get("precio_total");
    if (precioTotal !== "") payload.precio_total = precioTotal;
    if (isEdit && data.appointment_id) payload.appointment_id = data.appointment_id;
    else if (prefill && prefill.appointment_id) payload.appointment_id = prefill.appointment_id;

    payload.items = Array.from(itemsContainer.querySelectorAll(".item-row"))
      .map((row) => ({
        inventory_id: Number(row.querySelector(".item-insumo").value),
        cantidad: row.querySelector(".item-cantidad").value,
        costo_unitario: row.querySelector(".item-costo").value,
      }))
      .filter((item) => item.inventory_id);

    try {
      if (isEdit) {
        await api(`/api/visitas/${consulta.id}`, { method: "PUT", body: payload });
      } else {
        await api("/api/visitas", { method: "POST", body: payload });
      }
      closeModal();
      await loadConsultas();
      await loadInsumos();
      await loadCitas();
    } catch (err) {
      alert(err.message);
    }
  });

  openModal(form);
}

async function openConsultaDetail(consultaId) {
  const data = await api(`/api/visitas/${consultaId}`);

  const container = el("div", {}, [
    el("h3", { text: `${data.patient_nombre || "Paciente"} - ${data.fecha}` }),
    el("p", { text: `Tratamiento: ${data.tipo_tratamiento || "-"}` }),
    el("p", { text: `Precio total: ${formatMoney(data.precio_total)}  |  Pagado: ${formatMoney(data.total_pagado)}  |  Saldo: ${formatMoney(data.saldo)}` }),
  ]);

  if (data.items.length) {
    const itemsList = el("ul", {});
    data.items.forEach((i) => {
      itemsList.appendChild(el("li", { text: `${i.insumo_nombre || "Insumo"}: ${i.cantidad} x ${formatMoney(i.costo_unitario)}` }));
    });
    container.appendChild(el("h3", { text: "Insumos usados" }));
    container.appendChild(itemsList);
  }

  container.appendChild(el("h3", { text: "Pagos" }));
  const paymentsList = el("div", { class: "notes-list" });
  if (data.payments.length === 0) {
    paymentsList.appendChild(el("p", { class: "empty-text", text: "Sin pagos registrados." }));
  }
  data.payments.forEach((p) => {
    paymentsList.appendChild(el("div", { class: "note-item" }, [
      el("div", { text: `${formatMoney(p.monto)} - ${p.metodo || "sin metodo"}` }),
      el("div", { class: "note-meta" }, [
        document.createTextNode(`${p.fecha} `),
        el("button", {
          class: "btn-danger", text: "Eliminar",
          onclick: async () => {
            await api(`/api/pagos/${p.id}`, { method: "DELETE" });
            closeModal();
            await openConsultaDetail(consultaId);
            await loadConsultas();
          },
        }),
      ]),
    ]));
  });
  container.appendChild(paymentsList);

  const pagoForm = el("form", { class: "inline-form" }, [
    el("label", {}, [
      document.createTextNode("Monto"),
      el("input", { name: "monto", type: "number", step: "any", required: "required" }),
    ]),
    el("label", {}, [
      document.createTextNode("Metodo"),
      el("input", { name: "metodo", type: "text", placeholder: "efectivo, tarjeta..." }),
    ]),
    el("button", { type: "submit", class: "btn-primary", text: "Registrar pago" }),
  ]);
  pagoForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(pagoForm);
    try {
      await api(`/api/visitas/${consultaId}/pagos`, {
        method: "POST", body: { monto: fd.get("monto"), metodo: fd.get("metodo") },
      });
      closeModal();
      await openConsultaDetail(consultaId);
      await loadConsultas();
    } catch (err) {
      alert(err.message);
    }
  });
  container.appendChild(pagoForm);

  container.appendChild(el("div", { class: "modal-actions" }, [
    el("button", { class: "btn-secondary", text: "Editar", onclick: () => { closeModal(); openConsultaModal(data); } }),
    el("button", { class: "btn-primary", text: "Generar recibo PDF", onclick: () => generarReciboPdf(data) }),
  ]));

  openModal(container);
}

async function deleteConsulta(consulta) {
  if (!confirm("Eliminar esta consulta? El stock de insumos usados se devolvera al inventario.")) return;
  try {
    await api(`/api/visitas/${consulta.id}`, { method: "DELETE" });
    await loadConsultas();
    await loadInsumos();
  } catch (err) {
    alert(err.message);
  }
}

async function generarReciboPdf(data) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ compress: true });
  const clinicName = document.getElementById("app-clinic-name").textContent;

  try {
    const logoDataUrl = await imageToDataUrl("/static/logo.png");
    if (logoDataUrl) doc.addImage(logoDataUrl, "PNG", 15, 12, 40, 24);
  } catch (_) { /* si no hay logo, se omite */ }

  doc.setFontSize(16);
  doc.text(clinicName, 60, 20);
  doc.setFontSize(11);
  doc.text("Recibo de tratamiento", 60, 28);

  doc.setFontSize(10);
  let y = 46;
  doc.text(`Paciente: ${data.patient_nombre || "-"}`, 15, y); y += 7;
  doc.text(`Fecha: ${data.fecha}`, 15, y); y += 7;
  doc.text(`Tratamiento: ${data.tipo_tratamiento || "-"}`, 15, y); y += 12;

  doc.setFontSize(11);
  doc.text(`Total: ${formatMoney(data.precio_total)}`, 15, y); y += 7;
  doc.text(`Pagado: ${formatMoney(data.total_pagado)}`, 15, y); y += 7;
  doc.text(`Saldo pendiente: ${formatMoney(data.saldo)}`, 15, y); y += 12;

  if (data.payments.length) {
    doc.setFontSize(10);
    doc.text("Pagos:", 15, y); y += 6;
    data.payments.forEach((p) => {
      doc.text(`- ${p.fecha}: ${formatMoney(p.monto)} (${p.metodo || "sin metodo"})`, 18, y);
      y += 6;
    });
  }

  doc.save(`recibo-${(data.patient_nombre || "paciente").replace(/\s+/g, "_")}-${data.fecha}.pdf`);
}

async function imageToDataUrl(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ---------------------------------------------------------------------------
// Insumos
// ---------------------------------------------------------------------------

async function loadInsumos() {
  state.insumos = await api("/api/insumos");
  renderInsumos();
}

function renderInsumos() {
  const tbody = document.getElementById("insumos-tbody");
  const search = document.getElementById("filter-insumos").value.trim().toLowerCase();
  const onlyAlerts = document.getElementById("filter-alertas").checked;

  let rows = state.insumos;
  if (search) {
    rows = rows.filter((i) =>
      i.nombre.toLowerCase().includes(search) || (i.categoria || "").toLowerCase().includes(search)
    );
  }
  if (onlyAlerts) {
    rows = rows.filter((i) => i.stock_bajo || i.por_caducar);
  }

  tbody.innerHTML = "";
  document.getElementById("insumos-empty").classList.toggle("hidden", rows.length > 0);

  rows.forEach((insumo) => {
    const tr = el("tr", {});
    if (insumo.stock_bajo) tr.classList.add("row-low-stock");
    if (insumo.por_caducar) tr.classList.add("row-expiring");

    tr.appendChild(el("td", { text: insumo.nombre }));
    tr.appendChild(el("td", { text: insumo.categoria || "-" }));

    const stockTd = el("td", { text: `${insumo.stock} ${insumo.unidad_medida || ""}`.trim() });
    if (insumo.stock_bajo) stockTd.appendChild(el("span", { class: "tag tag-danger", text: "Bajo" }));
    tr.appendChild(stockTd);

    tr.appendChild(el("td", { text: insumo.stock_minimo }));

    const cadTd = el("td", { text: insumo.fecha_caducidad || "-" });
    if (insumo.por_caducar) cadTd.appendChild(el("span", { class: "tag tag-warning", text: "Por vencer" }));
    tr.appendChild(cadTd);

    const costoTd = el("td", { class: "doctora-only", text: formatMoney(insumo.costo) });
    const precioTd = el("td", { class: "doctora-only", text: formatMoney(insumo.precio) });
    if (state.role !== "doctora") {
      costoTd.classList.add("hidden");
      precioTd.classList.add("hidden");
    }
    tr.appendChild(costoTd);
    tr.appendChild(precioTd);

    tr.appendChild(el("td", { text: insumo.proveedor || "-" }));

    const actions = el("td", {}, [
      el("div", { class: "row-actions" }, [
        el("button", {
          class: "btn-secondary", text: "Ajustar stock",
          onclick: () => openAdjustStockModal(insumo),
        }),
        state.role === "doctora" && el("button", {
          class: "btn-secondary", text: "Editar",
          onclick: () => openInsumoModal(insumo),
        }),
        state.role === "doctora" && el("button", {
          class: "btn-danger", text: "Eliminar",
          onclick: () => deleteInsumo(insumo),
        }),
      ]),
    ]);
    tr.appendChild(actions);

    tbody.appendChild(tr);
  });
}

function openAdjustStockModal(insumo) {
  const form = el("form", {}, [
    el("h3", { text: `Ajustar stock: ${insumo.nombre}` }),
    el("label", {}, [
      document.createTextNode(`Stock actual: ${insumo.stock} ${insumo.unidad_medida || ""}`),
    ]),
    el("label", {}, [
      document.createTextNode("Cantidad a sumar (usa negativo para restar)"),
      el("input", { type: "number", step: "any", name: "delta", required: "required", value: "0" }),
    ]),
    el("div", { class: "modal-actions" }, [
      el("button", { type: "button", class: "btn-secondary", text: "Cancelar", onclick: closeModal }),
      el("button", { type: "submit", class: "btn-primary", text: "Guardar" }),
    ]),
  ]);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const delta = Number(new FormData(form).get("delta"));
    try {
      await api(`/api/insumos/${insumo.id}/stock`, { method: "PUT", body: { delta } });
      closeModal();
      await loadInsumos();
    } catch (err) {
      alert(err.message);
    }
  });

  openModal(form);
}

function openInsumoModal(insumo) {
  const isEdit = Boolean(insumo);
  const data = insumo || {};

  const field = (label, name, opts = {}) => el("label", {}, [
    document.createTextNode(label),
    el("input", {
      name, type: opts.type || "text", step: opts.step || undefined,
      value: data[name] !== undefined && data[name] !== null ? data[name] : "",
      list: opts.list || undefined,
    }),
  ]);

  const categoriaList = el("datalist", { id: "categoria-options" },
    CATEGORIA_SUGERIDAS.map((c) => el("option", { value: c })));

  const form = el("form", {}, [
    el("h3", { text: isEdit ? `Editar: ${insumo.nombre}` : "Nuevo insumo" }),
    field("Nombre *", "nombre"),
    categoriaList,
    field("Categoria", "categoria", { list: "categoria-options" }),
    el("div", { class: "form-grid" }, [
      field("Unidad de medida (caja, pieza, ml...)", "unidad_medida"),
      field("Proveedor", "proveedor"),
      field("Stock actual", "stock", { type: "number", step: "any" }),
      field("Stock minimo", "stock_minimo", { type: "number", step: "any" }),
      field("Costo", "costo", { type: "number", step: "any" }),
      field("Precio", "precio", { type: "number", step: "any" }),
      field("Lote", "lote"),
      field("Fecha de caducidad", "fecha_caducidad", { type: "date" }),
      field("Fecha ultima compra", "fecha_ultima_compra", { type: "date" }),
    ]),
    el("div", { class: "modal-actions" }, [
      el("button", { type: "button", class: "btn-secondary", text: "Cancelar", onclick: closeModal }),
      el("button", { type: "submit", class: "btn-primary", text: isEdit ? "Guardar cambios" : "Crear insumo" }),
    ]),
  ]);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form_data = new FormData(form);
    const payload = Object.fromEntries(form_data.entries());
    try {
      if (isEdit) {
        await api(`/api/insumos/${insumo.id}`, { method: "PUT", body: payload });
      } else {
        await api("/api/insumos", { method: "POST", body: payload });
      }
      closeModal();
      await loadInsumos();
    } catch (err) {
      alert(err.message);
    }
  });

  openModal(form);
}

async function deleteInsumo(insumo) {
  if (!confirm(`Eliminar "${insumo.nombre}"? Esta accion no se puede deshacer.`)) return;
  try {
    await api(`/api/insumos/${insumo.id}`, { method: "DELETE" });
    await loadInsumos();
  } catch (err) {
    alert(err.message);
  }
}

// ---------------------------------------------------------------------------
// Configuracion
// ---------------------------------------------------------------------------

async function loadSettingsView() {
  const settings = await api("/api/settings");
  document.getElementById("input-clinic-name").value = settings.clinic_name || "";
  await renderAsistentes();
}

async function renderAsistentes() {
  const asistentes = await api("/api/asistentes");
  const tbody = document.getElementById("asistentes-tbody");
  tbody.innerHTML = "";

  if (asistentes.length === 0) {
    tbody.appendChild(el("tr", {}, [el("td", { colspan: "3", text: "Aun no hay asistentes." })]));
    return;
  }

  asistentes.forEach((a) => {
    const tr = el("tr", {}, [
      el("td", { text: a.name }),
      el("td", { text: a.active ? "Si" : "No" }),
      el("td", {}, [
        el("div", { class: "row-actions" }, [
          el("button", {
            class: "btn-secondary", text: "Restablecer PIN",
            onclick: () => resetAsistentePin(a),
          }),
          el("button", {
            class: "btn-secondary", text: a.active ? "Desactivar" : "Activar",
            onclick: () => toggleAsistente(a),
          }),
          el("button", {
            class: "btn-danger", text: "Eliminar",
            onclick: () => deleteAsistente(a),
          }),
        ]),
      ]),
    ]);
    tbody.appendChild(tr);
  });
}

async function resetAsistentePin(asistente) {
  const pin = prompt(`Nuevo PIN para ${asistente.name} (minimo 4 digitos):`);
  if (!pin) return;
  try {
    await api(`/api/asistentes/${asistente.id}`, { method: "PUT", body: { pin } });
    alert("PIN actualizado.");
  } catch (err) {
    alert(err.message);
  }
}

async function toggleAsistente(asistente) {
  try {
    await api(`/api/asistentes/${asistente.id}`, { method: "PUT", body: { active: !asistente.active } });
    await renderAsistentes();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteAsistente(asistente) {
  if (!confirm(`Eliminar al asistente "${asistente.name}"?`)) return;
  try {
    await api(`/api/asistentes/${asistente.id}`, { method: "DELETE" });
    await renderAsistentes();
  } catch (err) {
    alert(err.message);
  }
}

// ---------------------------------------------------------------------------
// Navegacion y arranque
// ---------------------------------------------------------------------------

function setupNav() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const view = btn.dataset.view;
      document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
      document.getElementById(`view-${view}`).classList.remove("hidden");
    });
  });

  document.getElementById("btn-logout").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    window.location.reload();
  });

  document.getElementById("btn-new-insumo").addEventListener("click", () => openInsumoModal(null));
  document.getElementById("filter-insumos").addEventListener("input", renderInsumos);
  document.getElementById("filter-alertas").addEventListener("change", renderInsumos);

  document.getElementById("btn-new-paciente").addEventListener("click", () => openPacienteModal(null));
  document.getElementById("filter-pacientes").addEventListener("input", debounce(loadPacientes, 300));

  document.getElementById("btn-new-cita").addEventListener("click", () => openCitaModal(null));
  document.getElementById("filter-citas-fecha").addEventListener("change", (e) => {
    state.citaFecha = e.target.value;
    loadCitas();
  });
  document.getElementById("btn-cita-hoy").addEventListener("click", () => {
    state.citaFecha = todayStr();
    document.getElementById("filter-citas-fecha").value = state.citaFecha;
    loadCitas();
  });
  document.getElementById("btn-cita-prev-day").addEventListener("click", () => shiftCitaDay(-1));
  document.getElementById("btn-cita-next-day").addEventListener("click", () => shiftCitaDay(1));

  document.getElementById("btn-new-consulta").addEventListener("click", () => openConsultaModal(null));

  document.getElementById("form-clinic-name").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("input-clinic-name").value.trim();
    try {
      await api("/api/settings", { method: "PUT", body: { clinic_name: name } });
      document.getElementById("app-clinic-name").textContent = name;
      document.getElementById("login-clinic-name").textContent = name;
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById("form-change-password").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      await api("/api/mi-password", {
        method: "PUT",
        body: { actual: form.get("actual"), nueva: form.get("nueva") },
      });
      e.target.reset();
      alert("Contrasena actualizada.");
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById("form-new-asistente").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      await api("/api/asistentes", { method: "POST", body: { name: form.get("name"), pin: form.get("pin") } });
      e.target.reset();
      await renderAsistentes();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById("modal-overlay").addEventListener("click", (e) => {
    if (e.target.id === "modal-overlay") closeModal();
  });
}

async function main() {
  setupNav();
  const me = await api("/api/me");
  if (me.authenticated) {
    await enterApp(me);
  } else {
    await initLogin();
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

main();
