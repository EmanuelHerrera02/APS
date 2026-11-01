import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import MainLayout from '../components/layouts/MainLayout';

const money = (value) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(value || 0));

export default function EmployeePurchasesPage() {
  const { request } = useAuth();
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState({ status: 'idle', purchases: [], error: '' });
  const [alternateEmail, setAlternateEmail] = useState({});
  const [resend, setResend] = useState({});

  const findPurchases = async (event) => {
    event.preventDefault();
    setSearch({ status: 'loading', purchases: [], error: '' });
    try {
      const result = await request(`/employee/purchases?query=${encodeURIComponent(term.trim())}`);
      setSearch({ status: 'success', purchases: result.purchases || [], error: '' });
    } catch (error) {
      setSearch({ status: 'error', purchases: [], error: error.message || 'No se pudieron consultar las compras.' });
    }
  };

  const resendDocuments = async (purchase) => {
    setResend((current) => ({ ...current, [purchase.id]: { status: 'loading', message: '' } }));
    try {
      const email = (alternateEmail[purchase.id] || '').trim();
      const result = await request(`/employee/purchases/${purchase.id}/resend`, {
        method: 'POST', body: JSON.stringify(email ? { email } : {}),
      });
      setResend((current) => ({ ...current, [purchase.id]: {
        status: 'success', message: `Reenvío encolado para ${result.resend.recipient}.`,
      } }));
    } catch (error) {
      setResend((current) => ({ ...current, [purchase.id]: {
        status: 'error', message: error.message || 'No se pudo encolar el reenvío.',
      } }));
    }
  };

  return (
    <MainLayout>
      <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
        <header>
          <p className="text-sm font-semibold uppercase tracking-wide text-sky-700">Operaciones de mostrador</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Consulta de compras</h1>
          <p className="mt-2 text-slate-600">Buscá por código de compra, documento, apellido o email del pasajero.</p>
        </header>

        <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <form onSubmit={findPurchases} className="flex flex-col gap-3 sm:flex-row">
            <label className="flex-1 text-sm font-medium">Criterio de búsqueda
              <input required minLength="1" maxLength="120" className="mt-1 w-full rounded border p-3" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Código, documento, apellido o email" />
            </label>
            <button disabled={search.status === 'loading'} className="self-end rounded bg-sky-700 px-5 py-3 font-semibold text-white disabled:opacity-50">
              {search.status === 'loading' ? 'Buscando…' : 'Buscar compras'}
            </button>
          </form>
          {search.error && <p role="alert" className="mt-4 rounded bg-red-50 p-3 text-sm text-red-800">{search.error}</p>}
          {search.status === 'success' && search.purchases.length === 0 && <p className="mt-5 rounded bg-slate-50 p-4 text-slate-600">No se encontraron compras para “{term}”.</p>}
        </section>

        {search.purchases.map((purchase) => <article key={purchase.id} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
            <div>
              <h2 className="text-lg font-semibold">Compra {purchase.code}</h2>
              <p className="text-sm text-slate-600">{purchase.flight} · {purchase.origin} → {purchase.destination} · {purchase.date} · {purchase.departureTime}–{purchase.arrivalTime}</p>
            </div>
            <div className="text-right"><span className="rounded-full bg-slate-100 px-3 py-1 text-sm">{purchase.status}</span><p className="mt-2 font-semibold">{money(purchase.total)}</p></div>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="font-medium">Pasajeros y pasajes</h3>
              <ul className="mt-2 space-y-2 text-sm">
                {purchase.passengers.map((passenger) => <li key={passenger.ticketId} className="rounded bg-slate-50 p-3">
                  <strong>{passenger.firstName} {passenger.lastName}</strong> · {passenger.documentType} {passenger.documentNumber}<br />
                  Clase {passenger.class} · {money(passenger.fare)} · Pasaje {passenger.ticketStatus.toLowerCase()}
                </li>)}
              </ul>
            </div>
            <div className="space-y-2 text-sm">
              <h3 className="font-medium">Documentación</h3>
              <p>Email registrado: {purchase.email}</p>
              {purchase.invoiceNumber && <p>Factura: {purchase.invoiceNumber}</p>}
              {purchase.status === 'CONFIRMADA' ? <>
                <label className="block">Email alternativo <span className="font-normal text-slate-500">(dejalo vacío para usar el registrado)</span>
                  <input type="email" maxLength="255" className="mt-1 w-full rounded border p-2" value={alternateEmail[purchase.id] || ''} onChange={(event) => setAlternateEmail((current) => ({ ...current, [purchase.id]: event.target.value }))} placeholder={purchase.email} />
                </label>
                <button type="button" disabled={resend[purchase.id]?.status === 'loading'} onClick={() => resendDocuments(purchase)} className="rounded bg-sky-700 px-4 py-2 font-semibold text-white disabled:opacity-50">
                  {resend[purchase.id]?.status === 'loading' ? 'Encolando…' : 'Reenviar pasajes y factura'}
                </button>
                {resend[purchase.id]?.message && <p role={resend[purchase.id].status === 'error' ? 'alert' : 'status'} className={resend[purchase.id].status === 'error' ? 'text-red-700' : 'text-emerald-800'}>{resend[purchase.id].message}</p>}
              </> : <p className="text-slate-500">Solo se puede reenviar documentación de compras confirmadas.</p>}
            </div>
          </div>
        </article>)}
      </main>
    </MainLayout>
  );
}
