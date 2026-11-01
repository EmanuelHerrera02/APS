import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import MainLayout from '../components/layouts/MainLayout';

const dateAfter = (date, days) => {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
};
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
const money = (value) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(value || 0));

export default function AdminOccupancyReportsPage() {
  const { request } = useAuth();
  const [filters, setFilters] = useState({ flightCode: '', class: '', dateFrom: today, dateTo: dateAfter(today, 30) });
  const [report, setReport] = useState({ status: 'idle', rows: [], error: '' });
  const [exporting, setExporting] = useState(false);

  const queryString = () => {
    const query = new URLSearchParams({ dateFrom: filters.dateFrom, dateTo: filters.dateTo });
    if (filters.flightCode.trim()) query.set('flightCode', filters.flightCode.trim().toUpperCase());
    if (filters.class) query.set('class', filters.class);
    return query.toString();
  };

  const loadReport = async (event) => {
    event.preventDefault();
    setReport({ status: 'loading', rows: [], error: '' });
    try {
      const result = await request(`/admin/occupancy?${queryString()}`);
      setReport({ status: 'success', rows: result.rows || [], error: '' });
    } catch (error) {
      setReport({ status: 'error', rows: [], error: error.message || 'No se pudo consultar la ocupación.' });
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const blob = await request(`/admin/occupancy.csv?${queryString()}`, { responseType: 'blob' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'ocupacion.csv';
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setReport((current) => ({ ...current, error: error.message || 'No se pudo descargar el CSV.' }));
    } finally { setExporting(false); }
  };

  return (
    <MainLayout>
      <main className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
        <header>
          <p className="text-sm font-semibold uppercase tracking-wide text-sky-700">Administración</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Reportes de ocupación</h1>
          <p className="mt-2 text-slate-600">Revisá ventas confirmadas, reservas pendientes, disponibilidad y recaudación por salida y clase.</p>
        </header>

        <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <form onSubmit={loadReport} className="grid gap-4 md:grid-cols-5">
            <label className="text-sm">Código de vuelo<input className="mt-1 w-full rounded border p-2 uppercase" maxLength="6" pattern="[A-Za-z0-9]{2}[0-9]{1,4}" value={filters.flightCode} onChange={(event) => setFilters({ ...filters, flightCode: event.target.value })} placeholder="Todos" /></label>
            <label className="text-sm">Clase<select className="mt-1 w-full rounded border p-2" value={filters.class} onChange={(event) => setFilters({ ...filters, class: event.target.value })}><option value="">Todas</option><option value="ECONOMY">Economy</option><option value="PRIMERA">Primera</option></select></label>
            <label className="text-sm">Desde<input type="date" required className="mt-1 w-full rounded border p-2" value={filters.dateFrom} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value, dateTo: current.dateTo < event.target.value ? event.target.value : current.dateTo }))} /></label>
            <label className="text-sm">Hasta<input type="date" required min={filters.dateFrom} className="mt-1 w-full rounded border p-2" value={filters.dateTo} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })} /></label>
            <button disabled={report.status === 'loading'} className="self-end rounded bg-sky-700 px-4 py-2 font-semibold text-white disabled:opacity-50">{report.status === 'loading' ? 'Consultando…' : 'Aplicar filtros'}</button>
          </form>
        </section>

        {report.error && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-800">{report.error}</p>}
        {report.status === 'success' && <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-lg font-semibold">Salidas: {report.rows.length}</h2><p className="text-sm text-slate-600">El porcentaje se calcula sobre pasajes emitidos respecto de la capacidad.</p></div>
            <button type="button" disabled={exporting} onClick={exportCsv} className="rounded border border-slate-300 px-4 py-2 font-medium disabled:opacity-50">{exporting ? 'Preparando…' : 'Exportar CSV'}</button>
          </div>
          {report.rows.length === 0 ? <p className="rounded bg-slate-50 p-4 text-slate-600">No hay salidas para estos filtros.</p> : <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-600"><tr>
                <th className="px-3 py-3">Vuelo / salida</th><th className="px-3 py-3">Fecha</th><th className="px-3 py-3">Clase</th><th className="px-3 py-3">Estado</th><th className="px-3 py-3">Capacidad</th><th className="px-3 py-3">Vendidos</th><th className="px-3 py-3">Reservados</th><th className="px-3 py-3">Disponibles</th><th className="px-3 py-3">Ocupación</th><th className="px-3 py-3">Recaudado</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {report.rows.map((row) => <tr key={`${row.departureId}-${row.class}`}>
                  <td className="px-3 py-3"><strong>{row.flightCode}</strong> <span className="text-slate-500">#{row.departureId}</span><div className="text-xs text-slate-500">{row.origin} → {row.destination}</div></td>
                  <td className="px-3 py-3">{row.date}</td><td className="px-3 py-3">{row.class}</td>
                  <td className="px-3 py-3">{row.departureStatus === 'CANCELADA' ? <span className="text-red-700">Cancelada</span> : 'Programada'}</td>
                  <td className="px-3 py-3">{row.capacity}</td><td className="px-3 py-3">{row.sold}</td><td className="px-3 py-3">{row.reserved}</td><td className="px-3 py-3">{row.available}</td>
                  <td className="px-3 py-3">{Number(row.occupancyPercent).toFixed(2)}%</td><td className="px-3 py-3">{money(row.revenue)}</td>
                </tr>)}
              </tbody>
            </table>
          </div>}
        </section>}
      </main>
    </MainLayout>
  );
}
