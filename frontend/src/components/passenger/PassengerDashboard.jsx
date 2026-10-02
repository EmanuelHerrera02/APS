import { useState } from 'react';
import MainLayout from '../layouts/MainLayout';
import './PassengerDashboard.css';

const localToday = new Date();
const today = `${localToday.getFullYear()}-${String(localToday.getMonth() + 1).padStart(2, '0')}-${String(localToday.getDate()).padStart(2, '0')}`;
const formatTripDate = (value) => new Intl.DateTimeFormat('es-AR', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
}).format(new Date(`${value}T12:00:00`));
const formatPrice = (value) => new Intl.NumberFormat('es-AR', {
  style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
}).format(Number(value));

export default function PassengerDashboard() {
  const [form, setForm] = useState({ origin: '', destination: '', departureDate: '', endDate: '' });
  const [errors, setErrors] = useState({});
  const [searchState, setSearchState] = useState({ status: 'idle', results: [], message: '' });

  const updateField = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: '' }));
    setSearchState({ status: 'idle', results: [], message: '' });
  };

  const swapRoute = () => {
    setForm((current) => ({ ...current, origin: current.destination, destination: current.origin }));
    setSearchState({ status: 'idle', results: [], message: '' });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!form.origin.trim()) nextErrors.origin = 'Ingresá una ciudad o aeropuerto.';
    if (!form.destination.trim()) nextErrors.destination = 'Ingresá el destino.';
    if (form.origin.trim() && form.destination.trim() && form.origin.trim().toLowerCase() === form.destination.trim().toLowerCase()) {
      nextErrors.destination = 'El origen y el destino deben ser distintos.';
    }
    if (!form.departureDate) nextErrors.departureDate = 'Seleccioná la fecha de salida.';
    if (form.departureDate && form.departureDate < today) nextErrors.departureDate = 'La fecha de salida no puede ser anterior a hoy.';
    if (form.endDate && form.departureDate && form.endDate < form.departureDate) {
      nextErrors.endDate = 'La fecha final debe ser igual o posterior a la salida.';
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setSearchState({ status: 'idle', results: [], message: '' });
      return;
    }

    setSearchState({ status: 'loading', results: [], message: '' });
    const query = new URLSearchParams({
      origin: form.origin.trim(),
      destination: form.destination.trim(),
      dateFrom: form.departureDate,
      dateTo: form.endDate || form.departureDate,
    });

    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8080';
      const response = await fetch(`${apiUrl}/passenger/search?${query.toString()}`, {
        headers: { Accept: 'application/json' },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'No se pudo completar la búsqueda.');
      setSearchState({ status: 'success', results: body.results || [], message: '' });
    } catch (error) {
      setSearchState({ status: 'error', results: [], message: error.message || 'No se pudo conectar con el servicio de búsqueda.' });
    }
  };

  const hasSearched = searchState.status === 'success';
  const departures = Object.values(searchState.results.reduce((groups, option) => {
    const key = option.departureId;
    if (!groups[key]) groups[key] = { ...option, fares: [] };
    groups[key].fares.push(option);
    return groups;
  }, {}));

  return (
    <MainLayout>
      <div className="trip-search-page">
        <section className="trip-search-hero" aria-labelledby="trip-search-title">
          <div className="trip-search-hero-copy">
            <span className="trip-search-eyebrow">AERONET · VIAJÁ A TU MANERA</span>
            <h1 id="trip-search-title">Encontrá tu próximo destino</h1>
            <p>Elegí tu ruta y tus fechas para explorar las opciones disponibles.</p>
          </div>
          <div className="trip-search-hero-mark" aria-hidden="true">✈</div>
        </section>

        <section className="trip-search-card" aria-labelledby="trip-search-form-title">
          <div className="trip-search-card-heading">
            <div>
              <span className="trip-search-step">PLANIFICÁ TU VIAJE</span>
              <h2 id="trip-search-form-title">¿A dónde querés ir?</h2>
            </div>
            <span className="trip-search-one-way">✦ &nbsp; Salidas disponibles</span>
          </div>

          <form onSubmit={handleSubmit} noValidate>
            <div className="trip-search-fields">
              <div className={`trip-search-field ${errors.origin ? 'has-error' : ''}`}>
                <label htmlFor="trip-origin">Origen</label>
                <div className="trip-search-input-wrap">
                  <span aria-hidden="true">⌖</span>
                  <input id="trip-origin" name="origin" value={form.origin} onChange={updateField} placeholder="Ciudad o aeropuerto" autoComplete="off" aria-invalid={Boolean(errors.origin)} aria-describedby={errors.origin ? 'trip-origin-error' : undefined} />
                </div>
                {errors.origin && <span className="trip-search-error" id="trip-origin-error">{errors.origin}</span>}
              </div>

              <button className="trip-search-swap" type="button" onClick={swapRoute} aria-label="Intercambiar origen y destino" title="Intercambiar origen y destino">⇄</button>

              <div className={`trip-search-field ${errors.destination ? 'has-error' : ''}`}>
                <label htmlFor="trip-destination">Destino</label>
                <div className="trip-search-input-wrap">
                  <span aria-hidden="true">⌖</span>
                  <input id="trip-destination" name="destination" value={form.destination} onChange={updateField} placeholder="¿A dónde viajás?" autoComplete="off" aria-invalid={Boolean(errors.destination)} aria-describedby={errors.destination ? 'trip-destination-error' : undefined} />
                </div>
                {errors.destination && <span className="trip-search-error" id="trip-destination-error">{errors.destination}</span>}
              </div>

              <div className={`trip-search-field ${errors.departureDate ? 'has-error' : ''}`}>
                <label htmlFor="trip-departure">Fecha de salida</label>
                <div className="trip-search-input-wrap">
                  <span aria-hidden="true">▦</span>
                  <input id="trip-departure" name="departureDate" type="date" min={today} value={form.departureDate} onChange={updateField} aria-invalid={Boolean(errors.departureDate)} aria-describedby={errors.departureDate ? 'trip-departure-error' : undefined} />
                </div>
                {errors.departureDate && <span className="trip-search-error" id="trip-departure-error">{errors.departureDate}</span>}
              </div>

              <div className={`trip-search-field ${errors.endDate ? 'has-error' : ''}`}>
                <label htmlFor="trip-end-date">Buscar hasta <span>(opcional)</span></label>
                <div className="trip-search-input-wrap">
                  <span aria-hidden="true">▦</span>
                  <input id="trip-end-date" name="endDate" type="date" min={form.departureDate || today} value={form.endDate} onChange={updateField} aria-invalid={Boolean(errors.endDate)} aria-describedby={errors.endDate ? 'trip-end-date-error' : undefined} />
                </div>
                {errors.endDate && <span className="trip-search-error" id="trip-end-date-error">{errors.endDate}</span>}
              </div>
            </div>

            <div className="trip-search-actions">
              <span className="trip-search-hint">Si indicás una fecha final, buscamos salidas dentro de ese rango.</span>
              <button className="trip-search-submit" type="submit" disabled={searchState.status === 'loading'}>
                <span aria-hidden="true">⌕</span> {searchState.status === 'loading' ? 'Buscando…' : 'Buscar viajes'}
              </button>
            </div>
          </form>
        </section>

        <section className="trip-results" aria-live="polite" aria-labelledby="trip-results-title">
          <div className="trip-results-heading">
            <div>
              <span className="trip-search-step">TU PRÓXIMO VIAJE</span>
              <h2 id="trip-results-title">{hasSearched ? 'Opciones de viaje' : 'Resultados de búsqueda'}</h2>
            </div>
            {hasSearched && <span className="trip-results-route">{form.origin} <span aria-hidden="true">→</span> {form.destination}</span>}
          </div>
          {hasSearched && departures.length > 0 ? (
            <div className="trip-result-list">
              <p className="trip-result-summary">{departures.length} salidas encontradas · {searchState.results.length} opciones de clase</p>
              {departures.map((departure) => (
                <article className="trip-result-card" key={departure.departureId}>
                  <div className="trip-result-card-top">
                    <div className="trip-result-flight"><span className="trip-result-plane" aria-hidden="true">✈</span><span>Vuelo <strong>{departure.flightCode}</strong></span></div>
                    <time className="trip-result-date" dateTime={departure.date}>{formatTripDate(departure.date)}</time>
                  </div>

                  <div className="trip-result-itinerary">
                    <div className="trip-result-point">
                      <strong>{String(departure.departureTime).slice(0, 5)}</strong>
                      <span>{departure.originCity} <b>({departure.originCode})</b></span>
                    </div>
                    <div className="trip-result-duration" aria-hidden="true"><span>Directo</span><i /><span>✈</span></div>
                    <div className="trip-result-point trip-result-arrival">
                      <strong>{String(departure.arrivalTime).slice(0, 5)}{departure.arrivalDayOffset > 0 && <sup>+{departure.arrivalDayOffset}</sup>}</strong>
                      <span>{departure.destinationCity} <b>({departure.destinationCode})</b></span>
                    </div>
                  </div>

                  <div className="trip-result-fares" aria-label="Clases y precios disponibles">
                    {departure.fares.map((fare) => (
                      <div className="trip-result-fare" key={`${fare.departureId}-${fare.class}`}>
                        <div className="trip-result-fare-class"><span className={`trip-class-dot ${fare.class === 'PRIMERA' ? 'is-first' : ''}`} /><div><strong>{fare.class === 'PRIMERA' ? 'Primera' : 'Económica'}</strong><span>{fare.class}</span></div></div>
                        <div className="trip-result-seats"><strong>{fare.seatsAvailable}</strong><span>{fare.seatsAvailable === 1 ? 'asiento disponible' : 'asientos disponibles'}</span></div>
                        <div className="trip-result-price"><span>Desde</span><strong>{formatPrice(fare.price)}</strong></div>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="trip-results-empty">
              <div className="trip-results-illustration" aria-hidden="true"><span>✈</span><i>⌖</i></div>
              <h3>{searchState.status === 'loading'
                ? 'Buscando opciones…'
                : searchState.status === 'error'
                  ? 'No pudimos completar la búsqueda'
                  : hasSearched
                    ? 'No encontramos salidas'
                    : 'Tu viaje empieza acá'}</h3>
              <p>{searchState.status === 'loading'
                ? 'Estamos consultando las salidas para tu ruta y fechas.'
                : searchState.status === 'error'
                  ? searchState.message
                  : hasSearched
                    ? 'Probá cambiar el origen, el destino o el rango de fechas.'
                    : 'Completá el origen, el destino y la fecha de salida para consultar las opciones.'}</p>
            </div>
          )}
        </section>
      </div>
    </MainLayout>
  );
}
