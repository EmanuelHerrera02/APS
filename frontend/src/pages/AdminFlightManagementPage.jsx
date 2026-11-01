import React, { useCallback, useEffect, useState } from 'react';
import MainLayout from '../components/layouts/MainLayout';
import { useAuth } from '../contexts/AuthContext';
import { localDateString, validateFlightForm } from '../utils/flightValidation';

const weekdays = [
  ['1', 'Lunes'], ['2', 'Martes'], ['3', 'Miércoles'], ['4', 'Jueves'],
  ['5', 'Viernes'], ['6', 'Sábado'], ['7', 'Domingo'],
];

function toForm(flight) {
  const classes = { ECONOMY: { enabled: false, capacity: '', price: '' }, PRIMERA: { enabled: false, capacity: '', price: '' } };
  (flight.classes || []).forEach(({ className, capacity, price }) => {
    classes[className] = { enabled: true, capacity: String(capacity), price: String(price) };
  });
  return {
    code: flight.code,
    originAirportId: String(flight.originAirportId),
    destinationAirportId: String(flight.destinationAirportId),
    departureTime: flight.departureTime,
    arrivalTime: flight.arrivalTime,
    arrivalDayOffset: String(flight.arrivalDayOffset),
    startDate: flight.startDate,
    endDate: flight.endDate,
    operatingDays: (flight.operatingDays || []).map(String),
    classes,
  };
}

export default function AdminFlightManagementPage() {
  const { request } = useAuth();
  const [flights, setFlights] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadFlights = useCallback(async () => {
    setLoading(true);
    try {
      const result = await request('/admin/flights');
      setFlights(result.flights || []);
      setErrors({});
    } catch (error) {
      setErrors({ load: error.message || 'No se pudieron cargar los vuelos.' });
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { loadFlights(); }, [loadFlights]);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const updateClass = (name, key, value) => setForm((current) => ({
    ...current, classes: { ...current.classes, [name]: { ...current.classes[name], [key]: value } },
  }));

  const submitEdit = async (event) => {
    event.preventDefault();
    if (!selected || !form) return;
    const validation = validateFlightForm(form);
    setErrors(validation);
    if (Object.keys(validation).length) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        originAirportId: Number(form.originAirportId),
        destinationAirportId: Number(form.destinationAirportId),
        arrivalDayOffset: Number(form.arrivalDayOffset),
        operatingDays: form.operatingDays.map(Number),
        classes: Object.entries(form.classes).filter(([, item]) => item.enabled).map(([className, item]) => ({
          className, capacity: Number(item.capacity), price: Number(item.price),
        })),
      };
      await request(`/admin/flights/${selected.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      setMessage(`Se actualizaron los datos del vuelo ${selected.code}.`);
      setSelected(null);
      setForm(null);
      await loadFlights();
    } catch (error) {
      setErrors({ submit: error.message || 'No se pudo actualizar el vuelo.' });
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (flight, departureId = null) => {
    const reason = window.prompt(departureId ? 'Motivo de cancelación de esta salida:' : 'Motivo de cancelación del vuelo:');
    if (reason === null) return;
    if (!reason.trim()) {
      setErrors({ action: 'El motivo de cancelación es obligatorio.' });
      return;
    }
    setErrors({});
    setMessage('');
    const path = departureId
      ? `/admin/flights/${flight.id}/departures/${departureId}/cancel`
      : `/admin/flights/${flight.id}/cancel`;
    try {
      await request(path, { method: 'POST', body: JSON.stringify({ reason }) });
      setMessage(departureId ? `Se canceló la salida de ${flight.code}.` : `Se canceló el vuelo ${flight.code}.`);
      await loadFlights();
    } catch (error) {
      setErrors({ action: error.message || 'No se pudo registrar la cancelación.' });
    }
  };

  const dateMin = localDateString();
  const inputClass = 'mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm';

  return (
    <MainLayout>
      <section className="mx-auto max-w-5xl space-y-6">
        <header>
          <h2 className="text-2xl font-semibold text-gray-900">Administrar vuelos</h2>
          <p className="mt-1 text-sm text-gray-600">Editá horarios, calendario, capacidades y precios, o cancelá un vuelo o una salida.</p>
        </header>
        {message && <p role="status" className="rounded bg-green-50 p-3 text-sm text-green-800">{message}</p>}
        {errors.load && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-800">{errors.load}</p>}
        {errors.action && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-800">{errors.action}</p>}
        {loading && <p role="status">Cargando vuelos…</p>}

        {selected && form && (
          <form onSubmit={submitEdit} className="space-y-5 rounded-lg bg-white p-6 shadow" aria-busy={saving}>
            <div className="flex items-start justify-between gap-4">
              <div><h3 className="text-lg font-semibold">Editar vuelo {selected.code}</h3><p className="text-sm text-gray-600">El código y la ruta no se pueden cambiar.</p></div>
              <button type="button" className="text-sm text-blue-700 underline" onClick={() => { setSelected(null); setForm(null); setErrors({}); }}>Cerrar</button>
            </div>
            {errors.submit && <p role="alert" className="text-sm text-red-700">{errors.submit}</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm">Horario de partida<input className={inputClass} type="time" value={form.departureTime} onChange={(e) => update('departureTime', e.target.value)} /></label>
              <label className="text-sm">Horario de llegada<input className={inputClass} type="time" value={form.arrivalTime} onChange={(e) => update('arrivalTime', e.target.value)} /></label>
              {errors.times && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{errors.times}</p>}
              <label className="text-sm">Llegada<select className={inputClass} value={form.arrivalDayOffset} onChange={(e) => update('arrivalDayOffset', e.target.value)}><option value="0">El mismo día</option><option value="1">Al día siguiente</option></select></label>
              <label className="text-sm">Desde<input className={inputClass} type="date" min={dateMin} value={form.startDate} onChange={(e) => update('startDate', e.target.value)} /></label>
              <label className="text-sm">Hasta<input className={inputClass} type="date" min={form.startDate || dateMin} value={form.endDate} onChange={(e) => update('endDate', e.target.value)} /></label>
              {errors.dates && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{errors.dates}</p>}
            </div>
            <fieldset>
              <legend className="text-sm font-medium">Días de operación</legend>
              <div className="mt-2 flex flex-wrap gap-4">
                {weekdays.map(([day, label]) => <label key={day} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.operatingDays.includes(day)} onChange={(e) => update('operatingDays', e.target.checked ? [...form.operatingDays, day] : form.operatingDays.filter((value) => value !== day))} />{label}</label>)}
              </div>
              {errors.operatingDays && <p role="alert" className="mt-1 text-sm text-red-700">{errors.operatingDays}</p>}
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              {Object.entries(form.classes).filter(([, item]) => item.enabled).map(([name, item]) => (
                <fieldset key={name} className="rounded border p-4">
                  <legend className="px-1 text-sm font-medium">{name === 'ECONOMY' ? 'Económica' : 'Primera'}</legend>
                  <label className="block text-sm">Capacidad<input className={inputClass} type="number" min="1" step="1" value={item.capacity} onChange={(e) => updateClass(name, 'capacity', e.target.value)} /></label>
                  {errors[`capacity-${name}`] && <p role="alert" className="mt-1 text-sm text-red-700">{errors[`capacity-${name}`]}</p>}
                  <label className="mt-3 block text-sm">Precio (ARS)<input className={inputClass} type="number" min="0.01" step="0.01" value={item.price} onChange={(e) => updateClass(name, 'price', e.target.value)} /></label>
                  {errors[`price-${name}`] && <p role="alert" className="mt-1 text-sm text-red-700">{errors[`price-${name}`]}</p>}
                </fieldset>
              ))}
            </div>
            <p className="text-xs text-gray-500">Los importes de pasajes ya comprados no cambian. No se permite quitar clases existentes.</p>
            <button type="submit" disabled={saving} className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Guardando…' : 'Guardar cambios'}</button>
          </form>
        )}

        <div className="space-y-4">
          {flights.map((flight) => (
            <article key={flight.id} className="space-y-3 rounded-lg bg-white p-5 shadow">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h3 className="font-semibold">{flight.code} · {flight.status === 'ACTIVO' ? 'Activo' : 'Cancelado'}</h3><p className="text-sm text-gray-600">Ruta #{flight.originAirportId} → #{flight.destinationAirportId} · {flight.departureTime}–{flight.arrivalTime} · {flight.startDate} a {flight.endDate}</p></div>
                {flight.status === 'ACTIVO' && <div className="flex gap-3"><button type="button" className="text-sm text-blue-700 underline" onClick={() => { setSelected(flight); setForm(toForm(flight)); setErrors({}); }}>Editar</button><button type="button" className="text-sm text-red-700 underline" onClick={() => cancel(flight)}>Cancelar vuelo</button></div>}
              </div>
              {flight.departures?.length > 0 && <div className="border-t pt-3"><h4 className="text-sm font-medium">Próximas salidas</h4><ul className="mt-2 space-y-2">{flight.departures.map((departure) => <li key={departure.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{departure.date} · {departure.departureTime}–{departure.arrivalTime} · {departure.status}</span>{flight.status === 'ACTIVO' && departure.status === 'PROGRAMADA' && <button type="button" className="text-red-700 underline" onClick={() => cancel(flight, departure.id)}>Cancelar salida</button>}</li>)}</ul></div>}
            </article>
          ))}
          {!loading && flights.length === 0 && <p>No hay vuelos para administrar.</p>}
        </div>
      </section>
    </MainLayout>
  );
}
