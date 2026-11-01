import React, { useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import MainLayout from '../components/layouts/MainLayout';

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
const blankPassenger = () => ({ firstName: '', lastName: '', documentType: 'DNI', documentNumber: '' });
const money = (value) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(value || 0));

export default function EmployeeSalesPage() {
  const { request } = useAuth();
  const [criteria, setCriteria] = useState({ origin: '', destination: '', dateFrom: today, dateTo: today });
  const [search, setSearch] = useState({ status: 'idle', results: [], error: '' });
  const [selected, setSelected] = useState(null);
  const [count, setCount] = useState(1);
  const [passengers, setPassengers] = useState([blankPassenger()]);
  const [emailContact, setEmailContact] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('EFECTIVO');
  const [card, setCard] = useState({ terminalReference: '', cardBrand: '', lastFour: '' });
  const [sale, setSale] = useState({ status: 'idle', result: null, error: '' });

  const departures = useMemo(() => Object.values(search.results.reduce((groups, row) => {
    const key = row.departureId;
    if (!groups[key]) groups[key] = { ...row, fares: [] };
    groups[key].fares.push(row);
    return groups;
  }, {})), [search.results]);
  const fare = search.results.find((item) => Number(item.departureId) === Number(selected?.departureId)
    && item.class === selected?.class);

  const submitSearch = async (event) => {
    event.preventDefault();
    setSearch({ status: 'loading', results: [], error: '' });
    setSelected(null);
    setSale({ status: 'idle', result: null, error: '' });
    try {
      const query = new URLSearchParams({ ...criteria, origin: criteria.origin.trim(), destination: criteria.destination.trim() });
      const response = await request(`/passenger/search?${query.toString()}`);
      setSearch({ status: 'success', results: response.results || [], error: '' });
    } catch (error) {
      setSearch({ status: 'error', results: [], error: error.message || 'No se pudo buscar vuelos.' });
    }
  };

  const chooseFare = (departureId, className) => {
    const selectedFare = search.results.find((item) => Number(item.departureId) === Number(departureId) && item.class === className);
    setSelected({ departureId: Number(departureId), class: className });
    setCount(1);
    setPassengers([blankPassenger()]);
    setSale({ status: 'idle', result: null, error: '' });
    if (!selectedFare?.seatsAvailable) setSelected(null);
  };

  const setPassengerCount = (value) => {
    const next = Math.max(1, Math.min(9, Number(value) || 1, Number(fare?.seatsAvailable || 1)));
    setCount(next);
    setPassengers((current) => Array.from({ length: next }, (_, index) => current[index] || blankPassenger()));
  };

  const submitSale = async (event) => {
    event.preventDefault();
    if (!fare || count > fare.seatsAvailable) return;
    setSale({ status: 'loading', result: null, error: '' });
    try {
      const body = {
        departureId: Number(fare.departureId), emailContact: emailContact.trim(), paymentMethod,
        passengers: passengers.map((person) => ({ ...person, class: fare.class })),
        ...(paymentMethod !== 'EFECTIVO' ? card : {}),
      };
      const response = await request('/employee/sales', { method: 'POST', body: JSON.stringify(body) });
      setSale({ status: 'success', result: response, error: '' });
    } catch (error) {
      setSale({ status: 'error', result: null, error: error.message || 'No se pudo confirmar la venta.' });
    }
  };

  return (
    <MainLayout>
      <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
        <header>
          <p className="text-sm font-semibold uppercase tracking-wide text-sky-700">Operaciones de mostrador</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Venta de pasajes</h1>
          <p className="mt-2 text-slate-600">Buscá disponibilidad vigente, cargá los pasajeros y registrá el cobro presencial.</p>
        </header>

        <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-lg font-semibold">1. Buscar vuelos</h2>
          <form onSubmit={submitSearch} className="mt-4 grid gap-4 md:grid-cols-5">
            <label className="text-sm">Origen<input required className="mt-1 w-full rounded border p-2" value={criteria.origin} onChange={(event) => setCriteria({ ...criteria, origin: event.target.value })} placeholder="Ciudad o aeropuerto" /></label>
            <label className="text-sm">Destino<input required className="mt-1 w-full rounded border p-2" value={criteria.destination} onChange={(event) => setCriteria({ ...criteria, destination: event.target.value })} placeholder="Ciudad o aeropuerto" /></label>
            <label className="text-sm">Desde<input required type="date" min={today} className="mt-1 w-full rounded border p-2" value={criteria.dateFrom} onChange={(event) => setCriteria({ ...criteria, dateFrom: event.target.value, dateTo: criteria.dateTo < event.target.value ? event.target.value : criteria.dateTo })} /></label>
            <label className="text-sm">Hasta<input required type="date" min={criteria.dateFrom || today} className="mt-1 w-full rounded border p-2" value={criteria.dateTo} onChange={(event) => setCriteria({ ...criteria, dateTo: event.target.value })} /></label>
            <button disabled={search.status === 'loading'} className="self-end rounded bg-sky-700 px-4 py-2 font-semibold text-white disabled:opacity-50">{search.status === 'loading' ? 'Buscando…' : 'Buscar'}</button>
          </form>
          {search.error && <p role="alert" className="mt-3 text-sm text-red-700">{search.error}</p>}
          {search.status === 'success' && (departures.length ? <div className="mt-5 space-y-3">
            {departures.map((departure) => <article key={departure.departureId} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><strong>{departure.flightCode}</strong> · {departure.originCity} ({departure.originCode}) → {departure.destinationCity} ({departure.destinationCode})</div>
                <div>{departure.date} · {departure.departureTime}–{departure.arrivalTime}{Number(departure.arrivalDayOffset) ? ' (+1 día)' : ''}</div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {departure.fares.map((option) => <button type="button" key={option.class}
                  onClick={() => chooseFare(departure.departureId, option.class)}
                  className={`rounded border px-3 py-2 text-left ${selected?.departureId === Number(departure.departureId) && selected.class === option.class ? 'border-sky-700 bg-sky-50' : 'border-slate-300'}`}>
                  <span className="font-semibold">{option.class}</span> · {money(option.price)} · {option.seatsAvailable} disponibles
                </button>)}
              </div>
            </article>)}
          </div> : <p className="mt-4 text-sm text-slate-600">No hay vuelos disponibles para esos criterios.</p>)}
        </section>

        {fare && <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-lg font-semibold">2. Pasajeros y cobro</h2>
          <p className="mt-1 text-sm text-slate-600">{fare.flightCode} · {fare.date} · {fare.class} · {money(fare.price)} por pasaje. La disponibilidad se vuelve a validar al confirmar.</p>
          <form onSubmit={submitSale} className="mt-4 space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm">Email para enviar pasajes y factura<input type="email" required maxLength="255" className="mt-1 w-full rounded border p-2" value={emailContact} onChange={(event) => setEmailContact(event.target.value)} /></label>
              <label className="text-sm">Cantidad de pasajeros<input type="number" min="1" max={Math.min(9, fare.seatsAvailable)} required className="mt-1 w-full rounded border p-2" value={count} onChange={(event) => setPassengerCount(event.target.value)} /></label>
            </div>
            <p className="text-xs text-slate-500">Si el email pertenece a una cuenta de pasajero activa, la compra queda vinculada a esa cuenta; si no, se registra sin cuenta.</p>
            <div className="grid gap-3 md:grid-cols-2">
              {passengers.map((person, index) => <fieldset key={index} className="grid gap-3 rounded-lg border p-4 md:grid-cols-2">
                <legend className="px-1 font-medium">Pasajero {index + 1}</legend>
                <label className="text-sm">Nombre<input required maxLength="100" className="mt-1 w-full rounded border p-2" value={person.firstName} onChange={(event) => setPassengers((current) => current.map((item, i) => i === index ? { ...item, firstName: event.target.value } : item))} /></label>
                <label className="text-sm">Apellido<input required maxLength="100" className="mt-1 w-full rounded border p-2" value={person.lastName} onChange={(event) => setPassengers((current) => current.map((item, i) => i === index ? { ...item, lastName: event.target.value } : item))} /></label>
                <label className="text-sm">Tipo de documento<select className="mt-1 w-full rounded border p-2" value={person.documentType} onChange={(event) => setPassengers((current) => current.map((item, i) => i === index ? { ...item, documentType: event.target.value } : item))}><option>DNI</option><option>PASAPORTE</option><option>OTRO</option></select></label>
                <label className="text-sm">Número de documento<input required maxLength="20" className="mt-1 w-full rounded border p-2" value={person.documentNumber} onChange={(event) => setPassengers((current) => current.map((item, i) => i === index ? { ...item, documentNumber: event.target.value } : item))} /></label>
              </fieldset>)}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm">Medio de pago<select className="mt-1 w-full rounded border p-2" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="EFECTIVO">Efectivo</option><option value="TARJETA_CREDITO">Tarjeta de crédito (terminal)</option><option value="TARJETA_DEBITO">Tarjeta de débito (terminal)</option></select></label>
              <p className="self-end text-lg font-semibold">Total: {money(Number(fare.price) * count)}</p>
            </div>
            {paymentMethod !== 'EFECTIVO' && <div className="grid gap-4 rounded-lg bg-slate-50 p-4 md:grid-cols-3">
              <label className="text-sm">Autorización de terminal<input required minLength="3" maxLength="100" pattern="[A-Za-z0-9_-]+" className="mt-1 w-full rounded border p-2" value={card.terminalReference} onChange={(event) => setCard({ ...card, terminalReference: event.target.value })} /></label>
              <label className="text-sm">Marca<input required maxLength="20" className="mt-1 w-full rounded border p-2" value={card.cardBrand} onChange={(event) => setCard({ ...card, cardBrand: event.target.value })} placeholder="Visa, Mastercard…" /></label>
              <label className="text-sm">Últimos 4 dígitos<input required inputMode="numeric" pattern="[0-9]{4}" maxLength="4" className="mt-1 w-full rounded border p-2" value={card.lastFour} onChange={(event) => setCard({ ...card, lastFour: event.target.value })} /></label>
              <p className="text-xs text-slate-500 md:col-span-3">El cobro debe estar aprobado en la terminal. No ingreses el número completo, CVV ni vencimiento.</p>
            </div>}
            {sale.error && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-800">{sale.error}</p>}
            <button disabled={sale.status === 'loading' || count > fare.seatsAvailable} className="rounded bg-emerald-700 px-5 py-3 font-semibold text-white disabled:opacity-50">{sale.status === 'loading' ? 'Registrando venta…' : 'Cobrar y confirmar venta'}</button>
          </form>
        </section>}

        {sale.status === 'success' && <section role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-5 text-emerald-950">
          <h2 className="font-semibold">Venta confirmada</h2>
          <p>Compra {sale.result.sale.code} · {money(sale.result.sale.total)} · {sale.result.sale.paymentMethod}. Los pasajes y la factura se encolaron para envío a {emailContact}.</p>
          <p className="mt-1 text-sm">Vendedor registrado: empleado de mostrador · Compra #{sale.result.sale.purchaseId}</p>
        </section>}
      </main>
    </MainLayout>
  );
}
