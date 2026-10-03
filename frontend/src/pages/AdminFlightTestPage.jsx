import { useState } from 'react';
import { Link } from 'react-router-dom';
import MainLayout from '../components/layouts/MainLayout';
import { useAuth } from '../contexts/AuthContext';
import { validateFlightForm } from '../utils/flightValidation';

const validExample = () => ({
  code: 'AB1234', originAirportId: '1', destinationAirportId: '2',
  departureTime: '09:00', arrivalTime: '10:00', arrivalDayOffset: '0',
  startDate: '2030-01-01', endDate: '2030-01-10', operatingDays: ['1'],
  classes: { ECONOMY: { enabled: true, capacity: '10', price: '12000.00' }, PRIMERA: { enabled: false, capacity: '', price: '' } },
});

const localCases = [
  { name: 'Datos válidos', check: (form) => Object.keys(validateFlightForm(form)).length === 0 },
  { name: 'Rechaza origen y destino iguales', check: (form) => !!validateFlightForm({ ...form, destinationAirportId: form.originAirportId }).destinationAirportId },
  { name: 'Rechaza llegada anterior el mismo día', check: (form) => !!validateFlightForm({ ...form, arrivalTime: '08:30' }).times },
  { name: 'Acepta llegada al día siguiente', check: (form) => !validateFlightForm({ ...form, arrivalTime: '02:00', arrivalDayOffset: '1' }).times },
  { name: 'Requiere días de operación', check: (form) => !!validateFlightForm({ ...form, operatingDays: [] }).operatingDays },
  { name: 'Rechaza capacidad cero', check: (form) => !!validateFlightForm({ ...form, classes: { ...form.classes, ECONOMY: { ...form.classes.ECONOMY, capacity: '0' } } })['capacity-ECONOMY'] },
  { name: 'Rechaza precio cero', check: (form) => !!validateFlightForm({ ...form, classes: { ...form.classes, ECONOMY: { ...form.classes.ECONOMY, price: '0' } } })['price-ECONOMY'] },
];

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function nextOperatingDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return { date: localDateString(date), weekday: ((date.getDay() + 6) % 7) + 1 };
}

export default function AdminFlightTestPage() {
  const { request } = useAuth();
  const [localResults, setLocalResults] = useState([]);
  const [backendResults, setBackendResults] = useState([]);
  const [runningLocal, setRunningLocal] = useState(false);
  const [runningBackend, setRunningBackend] = useState(false);
  const [confirmSeedFlight, setConfirmSeedFlight] = useState(false);

  const runLocalTests = () => {
    setRunningLocal(true);
    const form = validExample();
    setLocalResults(localCases.map(({ name, check }) => {
      try {
        const passed = check(form);
        return { name, passed, detail: passed ? 'Resultado esperado.' : 'El resultado no coincide con lo esperado.' };
      } catch (error) {
        return { name, passed: false, detail: error.message };
      }
    }));
    setRunningLocal(false);
  };

  const runBackendTests = async () => {
    setRunningBackend(true);
    setBackendResults([{ name: 'Conexión y aeropuertos', state: 'running', detail: 'Consultando /admin/airports…' }]);
    const results = [];
    try {
      const data = await request('/admin/airports');
      const airports = data.airports || [];
      results.push({ name: 'Conexión y aeropuertos', passed: airports.length >= 2, detail: `${airports.length} aeropuertos activos.` });
      if (airports.length < 2) {
        results.push({ name: 'El backend rechaza ruta inválida', passed: false, detail: 'Se necesitan dos aeropuertos activos para esta prueba.' });
        setBackendResults(results);
        return;
      }

      const { date, weekday } = nextOperatingDate();
      const firstAirport = airports[0];
      const secondAirport = airports.find((airport) => airport.id !== firstAirport.id);
      const basePayload = {
        code: 'ZV9998', originAirportId: firstAirport.id, destinationAirportId: secondAirport.id,
        departureTime: '09:00', arrivalTime: '10:00', arrivalDayOffset: 0,
        startDate: date, endDate: date, operatingDays: [weekday],
        classes: [{ className: 'ECONOMY', capacity: 1, price: 1.00 }],
      };

      try {
        await request('/admin/flights', {
          method: 'POST', body: JSON.stringify({ ...basePayload, destinationAirportId: firstAirport.id }),
        });
        results.push({ name: 'El backend rechaza ruta inválida', passed: false, detail: 'La solicitud inválida fue aceptada.' });
      } catch (error) {
        const passed = error.message === 'Revisa los datos del vuelo';
        results.push({ name: 'El backend rechaza ruta inválida', passed, detail: passed ? 'Respondió con el error de validación esperado.' : error.message });
      }

      if (confirmSeedFlight) {
        try {
          const result = await request('/admin/flights', {
            method: 'POST', body: JSON.stringify({ ...basePayload, code: 'AN1402' }),
          });
          results.push({ name: 'Código de vuelo duplicado', passed: false, detail: `El código no estaba duplicado; se creó el vuelo ${result.flightId}.` });
        } catch (error) {
          const passed = error.message === 'Ya existe un vuelo con ese código';
          results.push({ name: 'Código de vuelo duplicado', passed, detail: passed ? 'El backend rechazó AN1402 como duplicado.' : error.message });
        }
      } else {
        results.push({ name: 'Código de vuelo duplicado', skipped: true, detail: 'Omitida: confirmá primero que AN1402 ya existe en esta base.' });
      }
    } catch (error) {
      results.push({ name: 'Conexión y aeropuertos', passed: false, detail: error.message });
      results.push({ name: 'Pruebas del endpoint', skipped: true, detail: 'No se ejecutaron porque el backend no respondió.' });
    } finally {
      setBackendResults(results);
      setRunningBackend(false);
    }
  };

  const resultList = (results) => results.map((result, index) => (
    <li key={`${result.name}-${index}`} className="flex flex-col gap-1 border-b border-gray-100 py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between">
      <span className="font-medium text-gray-800">{result.name}</span>
      <span className="text-sm text-gray-600">
        {result.state === 'running' ? 'Ejecutando…' : result.skipped ? 'Omitida' : result.passed ? 'Correcta' : 'Falló'} — {result.detail}
      </span>
    </li>
  ));

  return (
    <MainLayout>
      <section className="mx-auto max-w-4xl space-y-6">
        <header>
          <Link to="/admin/dashboard" className="text-sm text-blue-700 hover:underline">← Administración</Link>
          <h2 className="mt-2 text-2xl font-semibold text-gray-900">Pruebas de alta de vuelos</h2>
          <p className="mt-1 text-sm text-gray-600">Ejecutá validaciones locales y comprobaciones seguras contra el backend.</p>
        </header>

        <section className="rounded-lg bg-white p-6 shadow">
          <h3 className="text-lg font-semibold text-gray-900">Validaciones del formulario</h3>
          <p className="mt-1 text-sm text-gray-600">No requiere conexión y no modifica la base de datos.</p>
          <button type="button" onClick={runLocalTests} disabled={runningLocal} className="mt-4 rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60">
            {runningLocal ? 'Ejecutando…' : 'Ejecutar pruebas locales'}
          </button>
          {localResults.length > 0 && <ul className="mt-4 divide-y divide-gray-100" aria-live="polite">{resultList(localResults)}</ul>}
        </section>

        <section className="rounded-lg bg-white p-6 shadow">
          <h3 className="text-lg font-semibold text-gray-900">Comprobaciones del backend</h3>
          <p className="mt-1 text-sm text-gray-600">Comprueba la conexión, la validación servidor y el rechazo de duplicados. Las solicitudes negativas no deberían crear datos.</p>
          <label className="mt-4 flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={confirmSeedFlight} onChange={(event) => setConfirmSeedFlight(event.target.checked)} className="mt-0.5" />
            Confirmo que el vuelo de seed AN1402 existe en esta base. Si no existe, la comprobación podría crear ese vuelo.
          </label>
          <button type="button" onClick={runBackendTests} disabled={runningBackend} className="mt-4 rounded-md bg-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-60">
            {runningBackend ? 'Consultando backend…' : 'Ejecutar comprobaciones del backend'}
          </button>
          {backendResults.length > 0 && <ul className="mt-4 divide-y divide-gray-100" aria-live="polite">{resultList(backendResults)}</ul>}
        </section>

        <aside className="rounded-lg border border-amber-200 bg-amber-50 p-5">
          <h3 className="font-semibold text-amber-950">Prueba de alta válida</h3>
          <p className="mt-1 text-sm text-amber-900">Crear un vuelo real deja datos permanentes en la base y la aplicación no ofrece borrado físico. Cuando el backend esté disponible, usá el formulario de alta para esta prueba.</p>
          <Link to="/admin/flights/new" className="mt-3 inline-flex rounded-md border border-amber-700 px-4 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100">Abrir formulario de alta</Link>
        </aside>
      </section>
    </MainLayout>
  );
}
