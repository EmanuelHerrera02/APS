import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

/**
 * Alta de vuelos del panel de administración.
 *
 * Habla con tres endpoints del backend:
 *
 *   GET  /admin/aeropuertos                          para cargar los selects
 *   POST /admin/vuelos                                para dar de alta
 *   GET  /admin/vuelos/:id                            para ver el detalle
 *
 * Decisión de alcance: el componente NO revalida reglas de negocio. La base es
 * la autoridad (ver docs/manual-base-de-datos.md) y el backend traduce cada
 * error a { error, campo }. Acá solo se marca el input que vino en `campo`, que
 * es justamente para eso que el backend lo manda.
 *
 * No usa MainLayout ni useAuth a propósito: los otros componentes del repo los
 * importan, pero `contexts/AuthContext` todavía no existe, y atar el formulario
 * al layout lo vuelve imposible de montar y de probar aislado. El token entra
 * por prop y, si no se pasa, se busca en localStorage.
 */

const API = import.meta.env.VITE_API_URL || 'http://localhost:8080';

const DIAS = [
  { valor: 1, nombre: 'Lunes' },
  { valor: 2, nombre: 'Martes' },
  { valor: 3, nombre: 'Miércoles' },
  { valor: 4, nombre: 'Jueves' },
  { valor: 5, nombre: 'Viernes' },
  { valor: 6, nombre: 'Sábado' },
  { valor: 7, nombre: 'Domingo' },
];

const CLASES = [
  { valor: 'ECONOMY', nombre: 'Economy' },
  { valor: 'PRIMERA', nombre: 'Primera' },
];

const FORMULARIO_VACIO = {
  codigo: '',
  aeropuertoOrigen: '',
  aeropuertoDestino: '',
  horaPartida: '',
  horaLlegada: '',
  diasDesfaseLlegada: 0,
  fechaDesde: '',
  fechaHasta: '',
  diasOperacion: [],
  clases: [{ clase: 'ECONOMY', capacidad: '', precio: '' }],
};

/**
 * El precio viaja como texto a propósito. El backend lo convierte con
 * BigDecimal, y mandarlo como number de JavaScript lo haría pasar por un
 * double: 0.1 + redondeos binarios terminarían en la base.
 */
function aPayload(form) {
  return {
    codigo: form.codigo.trim(),
    aeropuertoOrigen: form.aeropuertoOrigen,
    aeropuertoDestino: form.aeropuertoDestino,
    horaPartida: form.horaPartida,
    horaLlegada: form.horaLlegada,
    diasDesfaseLlegada: Number(form.diasDesfaseLlegada),
    fechaDesde: form.fechaDesde,
    fechaHasta: form.fechaHasta,
    diasOperacion: [...form.diasOperacion].sort((a, b) => a - b),
    clases: form.clases.map((c) => ({
      clase: c.clase,
      capacidad: Number(c.capacidad),
      precio: String(c.precio).trim(),
    })),
  };
}

function leerToken(propToken) {
  if (propToken) return propToken;
  try {
    return window.localStorage.getItem('token') || '';
  } catch {
    return '';
  }
}

/**
 * Pide el catálogo de aeropuertos. Va fuera del componente y solo devuelve datos:
 * quien llama decide qué setea, así el efecto no tiene que setear estado de
 * forma síncrona.
 */
async function pedirAeropuertos(token) {
  const { data } = await axios.get(`${API}/admin/aeropuertos`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data.aeropuertos || [];
}

export default function AltaVuelo({ token: propToken }) {
  const [form, setForm] = useState(FORMULARIO_VACIO);
  const [aeropuertos, setAeropuertos] = useState([]);
  const [cargandoAeropuertos, setCargandoAeropuertos] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const [exito, setExito] = useState(null);

  const token = useMemo(() => leerToken(propToken), [propToken]);

  // El efecto de carga se escribe como un IIFE y no llamando a un useCallback
  // que setea estado: la regla react-hooks/set-state-in-effect no atraviesa la
  // función y marca cualquier llamada. Con el IIFE las actualizaciones quedan
  // después del await, que es lo que la regla acepta, y de paso sale gratis el
  // `vigente` para no setear estado si el componente se desmontó mientras
  // volaba la request.
  useEffect(() => {
    let vigente = true;
    (async () => {
      try {
        const lista = await pedirAeropuertos(token);
        if (!vigente) return;
        setAeropuertos(lista);
        setError(null);
      } catch (e) {
        if (!vigente) return;
        setAeropuertos([]);
        setError(describir(e));
      } finally {
        if (vigente) setCargandoAeropuertos(false);
      }
    })();
    return () => {
      vigente = false;
    };
  }, [token]);

  // El flag de "cargando" no se pone antes del await: el estado arranca en true,
  // así que la primera carga ya muestra el spinner y el efecto no fuerza un
  // render en cascada. Acá sí hace falta, porque reintenta el usuario.
  async function reintentarAeropuertos() {
    setCargandoAeropuertos(true);
    try {
      setAeropuertos(await pedirAeropuertos(token));
      setError(null);
    } catch (e) {
      setAeropuertos([]);
      setError(describir(e));
    } finally {
      setCargandoAeropuertos(false);
    }
  }

  function describir(e) {
    const cuerpo = e.response?.data;
    if (cuerpo?.error) {
      return { mensaje: cuerpo.error, campo: cuerpo.campo || null };
    }
    if (e.response) {
      return { mensaje: `El servidor respondió ${e.response.status}`, campo: null };
    }
    return { mensaje: 'No se pudo conectar con el servidor', campo: null };
  }

  function cambiar(campo, valor) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  function alternarDia(dia) {
    setForm((f) => ({
      ...f,
      diasOperacion: f.diasOperacion.includes(dia)
        ? f.diasOperacion.filter((d) => d !== dia)
        : [...f.diasOperacion, dia],
    }));
  }

  function cambiarClase(indice, campo, valor) {
    setForm((f) => ({
      ...f,
      clases: f.clases.map((c, i) => (i === indice ? { ...c, [campo]: valor } : c)),
    }));
  }

  function agregarClase() {
    setForm((f) => ({
      ...f,
      clases: [...f.clases, { clase: 'ECONOMY', capacidad: '', precio: '' }],
    }));
  }

  function quitarClase(indice) {
    setForm((f) => ({ ...f, clases: f.clases.filter((_, i) => i !== indice) }));
  }

  async function enviar(e) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    setExito(null);
    try {
      const { data } = await axios.post(`${API}/admin/vuelos`, aPayload(form), {
        headers: { Authorization: `Bearer ${token}` },
      });
      setExito(data);
      setForm(FORMULARIO_VACIO);
    } catch (err) {
      setError(describir(err));
    } finally {
      setEnviando(false);
    }
  }

  /** Marca el input que el backend señaló. `clases` marca todos los campos de clase. */
  const marcado = (campo) => (error?.campo === campo ? 'border-red-500' : 'border-gray-300');
  const ayudaClase = error?.campo === 'clases' ? 'text-red-600' : 'text-gray-500';

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900">Alta de vuelo</h3>
        <p className="text-sm text-gray-600 mt-1">
          Las fechas y las horas son locales. Los días de operación se usan para generar las
          salidas del vuelo.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4" role="alert">
          <div className="flex items-start gap-3">
            <span aria-hidden="true">⚠️</span>
            <div>
              <p className="text-sm font-medium text-red-800">{error.mensaje}</p>
              {error.campo && (
                <p className="text-xs text-red-700 mt-1">
                  Revisá el campo marcado: <code>{error.campo}</code>
                </p>
              )}
              {/* Sin los aeropuertos no se puede enviar nada, así que en ese
                  caso el reintento es la única salida. */}
              {aeropuertos.length === 0 && (
                <button
                  type="button"
                  onClick={reintentarAeropuertos}
                  disabled={cargandoAeropuertos}
                  className="mt-2 text-xs font-medium text-red-700 underline disabled:opacity-50"
                >
                  {cargandoAeropuertos ? 'Reintentando...' : 'Reintentar carga de aeropuertos'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {exito && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4" role="status">
          <div className="flex items-start gap-3">
            <span aria-hidden="true">✅</span>
            <div>
              <p className="text-sm font-medium text-green-800">
                Vuelo {exito.codigo} creado (id {exito.id})
              </p>
              <p className="text-xs text-green-700 mt-1">
                {exito.salidasGeneradas} salidas generadas y {exito.salidaClasesGeneradas} lugares
                disponibles.
              </p>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={enviar} className="space-y-6">
        <fieldset className="bg-white rounded-lg shadow p-6">
          <legend className="text-sm font-semibold text-gray-900">Datos del vuelo</legend>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Código</span>
              <input
                type="text"
                value={form.codigo}
                onChange={(e) => cambiar('codigo', e.target.value)}
                placeholder="AN1001"
                required
                className={`mt-1 w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${marcado('codigo')}`}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-gray-700">Días de desfase de llegada</span>
              <input
                type="number"
                value={form.diasDesfaseLlegada}
                onChange={(e) => cambiar('diasDesfaseLlegada', e.target.value)}
                className={`mt-1 w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${marcado('diasDesfaseLlegada')}`}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-gray-700">Aeropuerto de origen</span>
              <select
                value={form.aeropuertoOrigen}
                onChange={(e) => cambiar('aeropuertoOrigen', e.target.value)}
                required
                disabled={cargandoAeropuertos}
                className={`mt-1 w-full px-3 py-2 border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${marcado('aeropuertoOrigen')}`}
              >
                <option value="">{cargandoAeropuertos ? 'Cargando...' : 'Elegí un aeropuerto'}</option>
                {aeropuertos.map((a) => (
                  <option key={a.id} value={a.codigoIata}>
                    {a.codigoIata} — {a.nombre} ({a.ciudad})
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-gray-700">Aeropuerto de destino</span>
              <select
                value={form.aeropuertoDestino}
                onChange={(e) => cambiar('aeropuertoDestino', e.target.value)}
                required
                disabled={cargandoAeropuertos}
                className={`mt-1 w-full px-3 py-2 border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${marcado('aeropuertoDestino')}`}
              >
                <option value="">{cargandoAeropuertos ? 'Cargando...' : 'Elegí un aeropuerto'}</option>
                {aeropuertos.map((a) => (
                  <option key={a.id} value={a.codigoIata}>
                    {a.codigoIata} — {a.nombre} ({a.ciudad})
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-gray-700">Hora de partida</span>
              <input
                type="time"
                value={form.horaPartida}
                onChange={(e) => cambiar('horaPartida', e.target.value)}
                required
                className={`mt-1 w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${marcado('horaPartida')}`}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-gray-700">Hora de llegada</span>
              <input
                type="time"
                value={form.horaLlegada}
                onChange={(e) => cambiar('horaLlegada', e.target.value)}
                required
                className={`mt-1 w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${marcado('horaLlegada')}`}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-gray-700">Vigencia desde</span>
              <input
                type="date"
                value={form.fechaDesde}
                onChange={(e) => cambiar('fechaDesde', e.target.value)}
                required
                className={`mt-1 w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${marcado('fechaDesde')}`}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-gray-700">Vigencia hasta</span>
              <input
                type="date"
                value={form.fechaHasta}
                onChange={(e) => cambiar('fechaHasta', e.target.value)}
                required
                className={`mt-1 w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${marcado('fechaHasta')}`}
              />
            </label>
          </div>

          <div className="mt-4">
            <span className="text-sm font-medium text-gray-700">Días de operación</span>
            <div className="flex flex-wrap gap-4 mt-2">
              {DIAS.map((d) => (
                <label key={d.valor} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={form.diasOperacion.includes(d.valor)}
                    onChange={() => alternarDia(d.valor)}
                    className="h-4 w-4 text-blue-600"
                  />
                  {d.nombre}
                </label>
              ))}
            </div>
          </div>
        </fieldset>

        <fieldset className="bg-white rounded-lg shadow p-6">
          <legend className="text-sm font-semibold text-gray-900">Clases y precios</legend>

          <div className="space-y-4 mt-4">
            {form.clases.map((clase, i) => (
              <div key={i} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Clase</span>
                  <select
                    value={clase.clase}
                    onChange={(e) => cambiarClase(i, 'clase', e.target.value)}
                    className="mt-1 w-full px-3 py-2 border rounded-lg bg-white border-gray-300"
                  >
                    {CLASES.map((c) => (
                      <option key={c.valor} value={c.valor}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Capacidad</span>
                  <input
                    type="number"
                    min="1"
                    value={clase.capacidad}
                    onChange={(e) => cambiarClase(i, 'capacidad', e.target.value)}
                    required
                    className={`mt-1 w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      error?.campo === 'capacidad' ? 'border-red-500' : 'border-gray-300'
                    }`}
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Precio</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={clase.precio}
                    onChange={(e) => cambiarClase(i, 'precio', e.target.value)}
                    required
                    className={`mt-1 w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      error?.campo === 'precio' ? 'border-red-500' : 'border-gray-300'
                    }`}
                  />
                </label>

                <div className="md:col-span-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => quitarClase(i)}
                    disabled={form.clases.length === 1}
                    className="text-sm text-red-600 hover:text-red-800 disabled:text-gray-400 disabled:cursor-not-allowed"
                  >
                    Quitar esta clase
                  </button>
                </div>
              </div>
            ))}
          </div>

          <p className={`text-xs mt-3 ${ayudaClase}`}>
            {ayudaClase === 'text-gray-500'
              ? 'Se puede repetir la misma clase si la base acepta el duplicado.'
              : 'Revisá las clases.'}
          </p>

          <button
            type="button"
            onClick={agregarClase}
            className="mt-3 px-4 py-2 text-sm font-medium text-blue-700 border border-blue-300 rounded-lg hover:bg-blue-50"
          >
            Agregar clase
          </button>
        </fieldset>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={enviando || cargandoAeropuertos}
            className="px-5 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {enviando ? 'Creando vuelo...' : 'Crear vuelo'}
          </button>
          <button
            type="button"
            onClick={() => {
              setForm(FORMULARIO_VACIO);
              setError(null);
              setExito(null);
            }}
            disabled={enviando}
            className="px-5 py-2.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Limpiar
          </button>
        </div>
      </form>
    </div>
  );
}
