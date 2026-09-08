const TRATAMIENTOS_SUGERIDOS = [
  "Consulta general", "Limpieza dental", "Extraccion", "Resina", "Endodoncia",
  "Corona", "Blanqueamiento", "Ajuste de ortodoncia", "Revision",
];

const state = { nombre: "", telefono: "", fecha: "", hora: "" };

function showStep(id) {
  ["agendar-paso-datos", "agendar-paso-horarios", "agendar-paso-confirmar", "agendar-paso-exito"]
    .forEach((s) => document.getElementById(s).classList.toggle("hidden", s !== id));
  document.getElementById("agendar-error").classList.add("hidden");
}

function showError(message) {
  const box = document.getElementById("agendar-error");
  box.textContent = message;
  box.classList.remove("hidden");
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* sin cuerpo */ }
  if (!res.ok) throw new Error((data && data.error) || "Ocurrio un error inesperado");
  return data;
}

async function init() {
  try {
    const bootstrap = await api("/api/bootstrap");
    document.getElementById("agendar-clinic-name").textContent = bootstrap.clinicName;
    document.title = `Agendar cita - ${bootstrap.clinicName}`;
  } catch (_) { /* deja el nombre generico */ }

  const datalist = document.getElementById("agendar-tratamientos");
  TRATAMIENTOS_SUGERIDOS.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t;
    datalist.appendChild(opt);
  });

  const fechaInput = document.querySelector('input[name="fecha"]');
  const hoy = new Date();
  fechaInput.min = hoy.toISOString().slice(0, 10);

  document.getElementById("form-agendar-datos").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    state.nombre = fd.get("nombre").trim();
    state.telefono = fd.get("telefono").trim();
    state.fecha = fd.get("fecha");
    await cargarHorarios();
  });

  document.getElementById("btn-agendar-volver").addEventListener("click", () => showStep("agendar-paso-datos"));
  document.getElementById("btn-confirmar-volver").addEventListener("click", () => showStep("agendar-paso-horarios"));

  document.getElementById("btn-agendar-nueva").addEventListener("click", () => {
    document.getElementById("form-agendar-datos").reset();
    fechaInput.min = new Date().toISOString().slice(0, 10);
    showStep("agendar-paso-datos");
  });

  document.getElementById("form-agendar-confirmar").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api("/api/publico/citas", {
        method: "POST",
        body: {
          nombre: state.nombre,
          telefono: state.telefono,
          fecha: state.fecha,
          hora: state.hora,
          tipo_tratamiento: fd.get("tipo_tratamiento"),
          notas: fd.get("notas"),
        },
      });
      showStep("agendar-paso-exito");
    } catch (err) {
      showError(err.message);
    }
  });
}

async function cargarHorarios() {
  try {
    const data = await api(`/api/publico/disponibilidad?fecha=${state.fecha}`);
    const grid = document.getElementById("agendar-horarios-grid");
    grid.innerHTML = "";
    document.getElementById("agendar-fecha-label").textContent = `Horarios disponibles para el ${state.fecha}`;
    document.getElementById("agendar-sin-horarios").classList.toggle("hidden", data.horarios.length > 0);

    data.horarios.forEach((hora) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "horario-btn";
      btn.textContent = hora;
      btn.addEventListener("click", () => seleccionarHorario(hora));
      grid.appendChild(btn);
    });

    showStep("agendar-paso-horarios");
  } catch (err) {
    showError(err.message);
  }
}

function seleccionarHorario(hora) {
  state.hora = hora;
  document.getElementById("agendar-resumen").textContent =
    `${state.nombre} - ${state.fecha} a las ${hora}`;
  showStep("agendar-paso-confirmar");
}

init();
