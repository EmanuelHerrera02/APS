import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import MainLayout from '../components/layouts/MainLayout';
import { useAuth } from '../contexts/AuthContext';
import { localDateString, validateFlightForm } from '../utils/flightValidation';

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
  const formRef = useRef(null);
  const [airports, setAirports] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [loadingAirports, setLoadingAirports] = useState(true);
  const [saving, setSaving] = useState(false);
  const today = localDateString();
  const airportOptions = useMemo(() => airports.map((airport) => (
    <option key={airport.id} value={airport.id}>{airport.code} — {airport.city} ({airport.name})</option>
  )), [airports]);
  const notEnoughAirports = !loadingAirports && !loadError && airports.length < 2;

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

  const focusFirstInvalidField = () => requestAnimationFrame(() => {
    formRef.current?.querySelector('[aria-invalid="true"]')?.focus();
  });

  const submit = async (event) => {
    event.preventDefault();
    setNotice('');
    const nextErrors = validateFlightForm(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      focusFirstInvalidField();
      return;
    }
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

  const errorId = (name) => `flight-error-${name}`;
  const fieldProps = (name) => ({
    'aria-invalid': Boolean(errors[name]),
    'aria-describedby': errors[name] ? errorId(name) : undefined,
  });
  const fieldError = (name, className = 'mt-1 text-sm text-red-700') => errors[name]
    && <p id={errorId(name)} className={className}>{errors[name]}</p>;
  const validationCount = Object.keys(errors).filter((key) => key !== 'submit').length;
  const inputClass = 'mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 aria-[invalid=true]:border-red-600';

  return (
    <MainLayout>
      <section className="mx-auto max-w-4xl space-y-6" aria-busy={loadingAirports || saving}>
        <header>
          <Link to="/admin/dashboard" className="text-sm text-blue-700 hover:underline">← Administración</Link>
          <h2 className="mt-2 text-2xl font-semibold text-gray-900">Alta de vuelo</h2>
          <p className="mt-1 text-sm text-gray-600">Configurá la ruta, el período de operación y la disponibilidad por clase.</p>
        </header>

        {loadingAirports && <p role="status" className="rounded-md bg-blue-50 p-3 text-sm text-blue-800">Cargando aeropuertos…</p>}
        {loadError && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">No se pudieron cargar los aeropuertos: {loadError}</p>}
        {notEnoughAirports && <p role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">Se necesitan al menos dos aeropuertos activos para crear un vuelo.</p>}
        {notice && <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
        {errors.submit && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{errors.submit}</p>}
        {validationCount > 0 && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          Revisá {validationCount === 1 ? 'el campo marcado' : `los ${validationCount} campos marcados`} antes de guardar.
        </p>}

        <form ref={formRef} onSubmit={submit} noValidate className="space-y-6">
          <fieldset disabled={loadingAirports || saving} className="space-y-6 disabled:opacity-70">
            <section className="rounded-lg bg-white p-6 shadow" aria-labelledby="flight-route-title">
              <h3 id="flight-route-title" className="text-lg font-semibold text-gray-900">Ruta y horario</h3>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-gray-700">Código del vuelo
                  <input className={inputClass} maxLength="10" value={form.code} onChange={(e) => update('code', e.target.value)} placeholder="AN1234" autoComplete="off" {...fieldProps('code')} />
                  {fieldError('code')}
                </label>
                <label className="text-sm font-medium text-gray-700">Aeropuerto de origen
                  <select className={inputClass} value={form.originAirportId} onChange={(e) => update('originAirportId', e.target.value)} {...fieldProps('originAirportId')}>
                    <option value="">Seleccionar…</option>{airportOptions}
                  </select>{fieldError('originAirportId')}
                </label>
                <label className="text-sm font-medium text-gray-700">Aeropuerto de destino
                  <select className={inputClass} value={form.destinationAirportId} onChange={(e) => update('destinationAirportId', e.target.value)} {...fieldProps('destinationAirportId')}>
                    <option value="">Seleccionar…</option>{airportOptions}
                  </select>{fieldError('destinationAirportId')}
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm font-medium text-gray-700">Hora de partida
                    <input className={inputClass} type="time" value={form.departureTime} onChange={(e) => update('departureTime', e.target.value)} {...fieldProps('times')} />
                  </label>
                  <label className="text-sm font-medium text-gray-700">Hora de llegada
                    <input className={inputClass} type="time" value={form.arrivalTime} onChange={(e) => update('arrivalTime', e.target.value)} {...fieldProps('times')} />
                  </label>
                </div>
                {fieldError('times', 'text-sm text-red-700 sm:col-span-2')}
                <label className="text-sm font-medium text-gray-700">Día de llegada
                  <select className={inputClass} value={form.arrivalDayOffset} onChange={(e) => update('arrivalDayOffset', e.target.value)}>
                    <option value="0">El mismo día</option><option value="1">Al día siguiente</option>
                  </select>
                </label>
              </div>
            </section>

            <section className="rounded-lg bg-white p-6 shadow" aria-labelledby="flight-period-title">
              <h3 id="flight-period-title" className="text-lg font-semibold text-gray-900">Período y días de operación</h3>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-gray-700">Desde
                  <input className={inputClass} type="date" min={today} value={form.startDate} onChange={(e) => update('startDate', e.target.value)} {...fieldProps('dates')} />
                </label>
                <label className="text-sm font-medium text-gray-700">Hasta
                  <input className={inputClass} type="date" min={form.startDate || today} value={form.endDate} onChange={(e) => update('endDate', e.target.value)} {...fieldProps('dates')} />
                </label>
                {fieldError('dates', 'text-sm text-red-700 sm:col-span-2')}
              </div>
              <fieldset className="mt-5" aria-describedby={errors.operatingDays ? errorId('operatingDays') : undefined}>
                <legend className="text-sm font-medium text-gray-700">Días de operación</legend>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-3">
                  {weekdays.map(([day, label], index) => <label key={day} className="inline-flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={form.operatingDays.includes(day)} aria-invalid={index === 0 && Boolean(errors.operatingDays)} onChange={(event) => update('operatingDays', event.target.checked
                      ? [...form.operatingDays, day] : form.operatingDays.filter((item) => item !== day))} />{label}
                  </label>)}
                </div>
                {fieldError('operatingDays')}
              </fieldset>
            </section>

            <section className="rounded-lg bg-white p-6 shadow" aria-labelledby="flight-classes-title">
              <h3 id="flight-classes-title" className="text-lg font-semibold text-gray-900">Capacidad y precio</h3>
              <p className="mt-1 text-sm text-gray-600">Elegí al menos una clase; ambas pueden ofrecerse en el mismo vuelo.</p>
              {Object.entries(form.classes).map(([name, value], index) => (
                <div key={name} className="mt-4 rounded-md border border-gray-200 p-4">
                  <label className="inline-flex items-center gap-2 font-medium text-gray-800">
                    <input type="checkbox" checked={value.enabled} onChange={(e) => updateClass(name, 'enabled', e.target.checked)}
                      aria-invalid={index === 0 && Boolean(errors.classes)} aria-describedby={errors.classes ? errorId('classes') : undefined} />
                    {name === 'ECONOMY' ? 'Económica' : 'Primera'}
                  </label>
                  {value.enabled && <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <label className="text-sm font-medium text-gray-700">Capacidad
                      <input className={inputClass} type="number" inputMode="numeric" min="1" step="1" value={value.capacity} onChange={(e) => updateClass(name, 'capacity', e.target.value)} {...fieldProps(`capacity-${name}`)} />
                      {fieldError(`capacity-${name}`)}
                    </label>
                    <label className="text-sm font-medium text-gray-700">Precio (ARS)
                      <input className={inputClass} type="number" inputMode="decimal" min="0.01" max="9999999999.99" step="0.01" value={value.price} onChange={(e) => updateClass(name, 'price', e.target.value)} {...fieldProps(`price-${name}`)} />
                      {fieldError(`price-${name}`)}
                    </label>
                  </div>}
                </div>
              ))}
              {fieldError('classes')}
            </section>
          </fieldset>
          <div className="flex justify-end">
            <button type="submit" disabled={saving || loadingAirports || !!loadError || notEnoughAirports} className="rounded-md bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60">
              {saving ? 'Guardando…' : 'Crear vuelo'}
            </button>
          </div>
        </form>
      </section>
    </MainLayout>
  );
}
