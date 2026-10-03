import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import MainLayout from '../components/layouts/MainLayout';
import { useAuth } from '../contexts/AuthContext';
import { validateFlightForm } from '../utils/flightValidation';

const weekdays = [
  ['1', 'Lunes'], ['2', 'Martes'], ['3', 'Miércoles'], ['4', 'Jueves'],
  ['5', 'Viernes'], ['6', 'Sábado'], ['7', 'Domingo'],
];
const emptyForm = {
  code: '', originAirportId: '', destinationAirportId: '', departureTime: '', arrivalTime: '',
  arrivalDayOffset: '0', startDate: '', endDate: '', operatingDays: [],
  classes: { ECONOMY: { enabled: true, capacity: '', price: '' }, PRIMERA: { enabled: false, capacity: '', price: '' } },
};

export default function AdminFlightsPage() {
  const { request } = useAuth();
  const [airports, setAirports] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [loadingAirports, setLoadingAirports] = useState(true);
  const [saving, setSaving] = useState(false);
  const airportOptions = useMemo(() => airports.map((airport) => (
    <option key={airport.id} value={airport.id}>{airport.code} — {airport.city} ({airport.name})</option>
  )), [airports]);

  useEffect(() => {
    let cancelled = false;
    request('/admin/airports')
      .then((data) => { if (!cancelled) setAirports(data.airports || []); })
      .catch((error) => { if (!cancelled) setLoadError(error.message); })
      .finally(() => { if (!cancelled) setLoadingAirports(false); });
    return () => { cancelled = true; };
  }, [request]);

  const update = (field, value) => setForm((previous) => ({ ...previous, [field]: value }));
  const updateClass = (name, field, value) => setForm((previous) => ({
    ...previous,
    classes: { ...previous.classes, [name]: { ...previous.classes[name], [field]: value } },
  }));

  const submit = async (event) => {
    event.preventDefault();
    setNotice('');
    const nextErrors = validateFlightForm(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSaving(true);
    try {
      const payload = {
        code: form.code.trim().toUpperCase(),
        originAirportId: Number(form.originAirportId), destinationAirportId: Number(form.destinationAirportId),
        departureTime: form.departureTime, arrivalTime: form.arrivalTime,
        arrivalDayOffset: Number(form.arrivalDayOffset), startDate: form.startDate, endDate: form.endDate,
        operatingDays: form.operatingDays.map(Number),
        classes: Object.entries(form.classes).filter(([, value]) => value.enabled).map(([className, value]) => ({
          className, capacity: Number(value.capacity), price: Number(value.price),
        })),
      };
      const result = await request('/admin/flights', { method: 'POST', body: JSON.stringify(payload) });
      setNotice(`Vuelo ${payload.code} creado correctamente (ID ${result.flightId}); sus salidas ya están generadas.`);
      setForm(emptyForm);
      setErrors({});
    } catch (error) {
      setErrors({ submit: error.message });
    } finally {
      setSaving(false);
    }
  };

  const fieldError = (name) => errors[name] && <p className="mt-1 text-sm text-red-700">{errors[name]}</p>;
  const inputClass = 'mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600';

  return (
    <MainLayout>
      <section className="mx-auto max-w-4xl space-y-6">
        <header>
          <Link to="/admin/dashboard" className="text-sm text-blue-700 hover:underline">← Administración</Link>
          <h2 className="mt-2 text-2xl font-semibold text-gray-900">Alta de vuelo</h2>
          <p className="mt-1 text-sm text-gray-600">Configurá la ruta, el período de operación y la disponibilidad por clase.</p>
        </header>

        {loadError && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">No se pudieron cargar los aeropuertos: {loadError}</p>}
        {notice && <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
        {errors.submit && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{errors.submit}</p>}

        <form onSubmit={submit} noValidate className="space-y-6">
          <fieldset disabled={loadingAirports || saving} className="space-y-6 disabled:opacity-70">
            <section className="rounded-lg bg-white p-6 shadow">
              <h3 className="text-lg font-semibold text-gray-900">Ruta y horario</h3>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-gray-700">Código del vuelo
                  <input className={inputClass} maxLength="10" value={form.code} onChange={(e) => update('code', e.target.value)} placeholder="AN1234" aria-invalid={!!errors.code} />
                  {fieldError('code')}
                </label>
                <label className="text-sm font-medium text-gray-700">Aeropuerto de origen
                  <select className={inputClass} value={form.originAirportId} onChange={(e) => update('originAirportId', e.target.value)}>
                    <option value="">Seleccionar…</option>{airportOptions}
                  </select>{fieldError('originAirportId')}
                </label>
                <label className="text-sm font-medium text-gray-700">Aeropuerto de destino
                  <select className={inputClass} value={form.destinationAirportId} onChange={(e) => update('destinationAirportId', e.target.value)}>
                    <option value="">Seleccionar…</option>{airportOptions}
                  </select>{fieldError('destinationAirportId')}
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm font-medium text-gray-700">Partida
                    <input className={inputClass} type="time" value={form.departureTime} onChange={(e) => update('departureTime', e.target.value)} />
                  </label>
                  <label className="text-sm font-medium text-gray-700">Llegada
                    <input className={inputClass} type="time" value={form.arrivalTime} onChange={(e) => update('arrivalTime', e.target.value)} />
                  </label>
                </div>
                {errors.times && <p className="text-sm text-red-700 sm:col-span-2">{errors.times}</p>}
                <label className="text-sm font-medium text-gray-700">Llegada
                  <select className={inputClass} value={form.arrivalDayOffset} onChange={(e) => update('arrivalDayOffset', e.target.value)}>
                    <option value="0">El mismo día</option><option value="1">Al día siguiente</option>
                  </select>
                </label>
              </div>
            </section>

            <section className="rounded-lg bg-white p-6 shadow">
              <h3 className="text-lg font-semibold text-gray-900">Período y días de operación</h3>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-gray-700">Desde
                  <input className={inputClass} type="date" value={form.startDate} onChange={(e) => update('startDate', e.target.value)} />
                </label>
                <label className="text-sm font-medium text-gray-700">Hasta
                  <input className={inputClass} type="date" value={form.endDate} onChange={(e) => update('endDate', e.target.value)} />
                </label>
                {errors.dates && <p className="text-sm text-red-700 sm:col-span-2">{errors.dates}</p>}
              </div>
              <fieldset className="mt-5">
                <legend className="text-sm font-medium text-gray-700">Días de operación</legend>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-3">
                  {weekdays.map(([day, label]) => <label key={day} className="inline-flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={form.operatingDays.includes(day)} onChange={(event) => update('operatingDays', event.target.checked
                      ? [...form.operatingDays, day] : form.operatingDays.filter((item) => item !== day))} />{label}
                  </label>)}
                </div>
                {fieldError('operatingDays')}
              </fieldset>
            </section>

            <section className="rounded-lg bg-white p-6 shadow">
              <h3 className="text-lg font-semibold text-gray-900">Capacidad y precio</h3>
              <p className="mt-1 text-sm text-gray-600">Elegí al menos una clase; ambas pueden ofrecerse en el mismo vuelo.</p>
              {Object.entries(form.classes).map(([name, value]) => (
                <div key={name} className="mt-4 rounded-md border border-gray-200 p-4">
                  <label className="inline-flex items-center gap-2 font-medium text-gray-800">
                    <input type="checkbox" checked={value.enabled} onChange={(e) => updateClass(name, 'enabled', e.target.checked)} />
                    {name === 'ECONOMY' ? 'Económica' : 'Primera'}
                  </label>
                  {value.enabled && <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <label className="text-sm font-medium text-gray-700">Capacidad
                      <input className={inputClass} type="number" min="1" step="1" value={value.capacity} onChange={(e) => updateClass(name, 'capacity', e.target.value)} />
                      {fieldError(`capacity-${name}`)}
                    </label>
                    <label className="text-sm font-medium text-gray-700">Precio (ARS)
                      <input className={inputClass} type="number" min="0.01" max="9999999999.99" step="0.01" value={value.price} onChange={(e) => updateClass(name, 'price', e.target.value)} />
                      {fieldError(`price-${name}`)}
                    </label>
                  </div>}
                </div>
              ))}
              {fieldError('classes')}
            </section>
          </fieldset>
          <div className="flex justify-end">
            <button type="submit" disabled={saving || loadingAirports || !!loadError} className="rounded-md bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60">
              {saving ? 'Guardando…' : 'Crear vuelo'}
            </button>
          </div>
        </form>
      </section>
    </MainLayout>
  );
}
