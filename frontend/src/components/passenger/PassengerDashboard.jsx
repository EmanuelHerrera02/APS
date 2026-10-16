import React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import MainLayout from '../layouts/MainLayout';
import './PassengerDashboard.css';

const localToday = new Date();
const today = `${localToday.getFullYear()}-${String(localToday.getMonth() + 1).padStart(2, '0')}-${String(localToday.getDate()).padStart(2, '0')}`;
const formatTripDate = (value) => new Intl.DateTimeFormat('es-AR', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
}).format(new Date(`${value}T12:00:00`));
const formatPrice = (value) => new Intl.NumberFormat('es-AR', {
  style: 'currency', currency: 'ARS', maximumFractionDigits: 2,
}).format(Number(value));
const emptyPassenger = () => ({ firstName: '', lastName: '', documentType: '', documentNumber: '' });

export default function PassengerDashboard() {
  const { request, user } = useAuth();
  const [form, setForm] = useState({ origin: '', destination: '', departureDate: '', endDate: '' });
  const [errors, setErrors] = useState({});
  const [searchState, setSearchState] = useState({ status: 'idle', results: [], message: '' });
  const [selection, setSelection] = useState(null);
  const [passengers, setPassengers] = useState([]);
  const [passengerErrors, setPassengerErrors] = useState({});
  const [passengersReady, setPassengersReady] = useState(false);
  const [reservationState, setReservationState] = useState({ status: 'idle', reservation: null, message: '' });
  const [purchaseState, setPurchaseState] = useState({ status: 'loading', reservations: [], message: '' });

  const loadReservations = useCallback(async () => {
    setPurchaseState((current) => ({ ...current, status: 'loading', message: '' }));
    try {
      const response = await request('/passenger/reservations');
      setPurchaseState({ status: 'success', reservations: response.reservations || [], message: '' });
    } catch (error) {
      setPurchaseState({ status: 'error', reservations: [], message: error.message || 'No se pudieron cargar tus compras.' });
    }
  }, [request]);

  useEffect(() => {
    if (user) loadReservations();
  }, [loadReservations, user?.id]);

  const updateField = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: '' }));
    setSearchState({ status: 'idle', results: [], message: '' });
    setSelection(null);
    setPassengers([]);
    setPassengerErrors({});
    setPassengersReady(false);
    setReservationState({ status: 'idle', reservation: null, message: '' });
  };

  const swapRoute = () => {
    setForm((current) => ({ ...current, origin: current.destination, destination: current.origin }));
    setSearchState({ status: 'idle', results: [], message: '' });
    setSelection(null);
    setPassengers([]);
    setPassengerErrors({});
    setPassengersReady(false);
    setReservationState({ status: 'idle', reservation: null, message: '' });
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
    setSelection(null);
    setPassengers([]);
    setPassengerErrors({});
    setPassengersReady(false);
    setReservationState({ status: 'idle', reservation: null, message: '' });
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
  const selectedDeparture = departures.find((departure) => departure.departureId === selection?.departureId);
  const selectedFare = selectedDeparture?.fares.find((fare) => fare.class === selection?.fareClass);
  const maxPassengers = selectedFare ? Math.min(9, selectedFare.seatsAvailable) : 0;

  const selectFare = (fare) => {
    setSelection({ departureId: fare.departureId, fareClass: fare.class, passengerCount: 1 });
    setPassengers([emptyPassenger()]);
    setPassengerErrors({});
    setPassengersReady(false);
    setReservationState({ status: 'idle', reservation: null, message: '' });
  };

  const updatePassengerCount = (value) => {
    const parsed = Number.parseInt(value, 10);
    const passengerCount = Number.isNaN(parsed) ? 1 : Math.max(1, Math.min(maxPassengers, parsed));
    setSelection((current) => current ? { ...current, passengerCount } : current);
    setPassengers((current) => Array.from({ length: passengerCount }, (_, index) => current[index] || emptyPassenger()));
    setPassengerErrors({});
    setPassengersReady(false);
    setReservationState({ status: 'idle', reservation: null, message: '' });
  };

  const updatePassenger = (index, field, value) => {
    setPassengers((current) => current.map((passenger, passengerIndex) =>
      passengerIndex === index ? { ...passenger, [field]: value } : passenger));
    setPassengerErrors((current) => {
      const next = { ...current };
      delete next[`${index}-${field}`];
      return next;
    });
    setPassengersReady(false);
    setReservationState({ status: 'idle', reservation: null, message: '' });
  };

  const handlePassengerDetailsSubmit = (event) => {
    event.preventDefault();
    const nextErrors = {};
    passengers.forEach((passenger, index) => {
      if (!passenger.firstName.trim()) nextErrors[`${index}-firstName`] = 'Ingresá el nombre.';
      else if (passenger.firstName.trim().length > 100) nextErrors[`${index}-firstName`] = 'Usá hasta 100 caracteres.';
      if (!passenger.lastName.trim()) nextErrors[`${index}-lastName`] = 'Ingresá el apellido.';
      else if (passenger.lastName.trim().length > 100) nextErrors[`${index}-lastName`] = 'Usá hasta 100 caracteres.';
      if (!['DNI', 'PASAPORTE', 'OTRO'].includes(passenger.documentType)) nextErrors[`${index}-documentType`] = 'Seleccioná el tipo de documento.';
      if (!passenger.documentNumber.trim()) nextErrors[`${index}-documentNumber`] = 'Ingresá el número de documento.';
      else if (passenger.documentNumber.trim().length > 20) nextErrors[`${index}-documentNumber`] = 'Usá hasta 20 caracteres.';
    });
    setPassengerErrors(nextErrors);
    setPassengersReady(Object.keys(nextErrors).length === 0);
    setReservationState({ status: 'idle', reservation: null, message: '' });
  };

  const createReservation = async () => {
    setReservationState({ status: 'loading', reservation: null, message: '' });
    try {
      const response = await request('/passenger/reservations', {
        method: 'POST',
        body: JSON.stringify({
          departureId: selectedDeparture.departureId,
          emailContact: user?.email,
          passengers: passengers.map((passenger) => ({
            ...passenger,
            firstName: passenger.firstName.trim(),
            lastName: passenger.lastName.trim(),
            documentNumber: passenger.documentNumber.trim(),
            class: selectedFare.class,
          })),
        }),
      });
      setReservationState({ status: 'success', reservation: response.reservation, message: '' });
      await loadReservations();
    } catch (error) {
      setReservationState({ status: 'error', reservation: null, message: error.message || 'No se pudo crear la compra.' });
    }
  };

  const downloadDocument = async (path, filename) => {
    try {
      const blob = await request(path, { responseType: 'blob', headers: { Accept: 'application/pdf' } });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setPurchaseState((current) => ({ ...current, message: error.message || 'No se pudo descargar el documento.' }));
    }
  };

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
                  <input id="trip-origin" name="origin" value={form.origin} onChange={updateField} placeholder="Ciudad, aeropuerto o código" autoComplete="off" aria-invalid={Boolean(errors.origin)} aria-describedby={errors.origin ? 'trip-origin-error' : undefined} />
                </div>
                {errors.origin && <span className="trip-search-error" id="trip-origin-error">{errors.origin}</span>}
              </div>

              <button className="trip-search-swap" type="button" onClick={swapRoute} aria-label="Intercambiar origen y destino" title="Intercambiar origen y destino">⇄</button>

              <div className={`trip-search-field ${errors.destination ? 'has-error' : ''}`}>
                <label htmlFor="trip-destination">Destino</label>
                <div className="trip-search-input-wrap">
                  <span aria-hidden="true">⌖</span>
                  <input id="trip-destination" name="destination" value={form.destination} onChange={updateField} placeholder="Ciudad, aeropuerto o código" autoComplete="off" aria-invalid={Boolean(errors.destination)} aria-describedby={errors.destination ? 'trip-destination-error' : undefined} />
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
              <span className="trip-search-hint">Podés escribir la ciudad (Bariloche), el aeropuerto (Aeroparque) o el código (AEP). Si indicás una fecha final, buscamos salidas dentro de ese rango.</span>
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
                        <button
                          className="trip-select-fare"
                          type="button"
                          aria-pressed={selection?.departureId === fare.departureId && selection?.fareClass === fare.class}
                          onClick={() => selectFare(fare)}
                        >
                          {selection?.departureId === fare.departureId && selection?.fareClass === fare.class ? 'Seleccionado' : 'Elegir clase'}
                        </button>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
              {selectedDeparture && selectedFare && (
                <section className="trip-selection-panel" aria-labelledby="trip-selection-title">
                  <div>
                    <span className="trip-search-step">SELECCIÓN DE PASAJES</span>
                    <h3 id="trip-selection-title">{selectedDeparture.flightCode} · {selectedFare.class === 'PRIMERA' ? 'Primera' : 'Económica'}</h3>
                    <p>{selectedDeparture.originCode} → {selectedDeparture.destinationCode} · {formatTripDate(selectedDeparture.date)} · {selectedFare.seatsAvailable} {selectedFare.seatsAvailable === 1 ? 'asiento disponible' : 'asientos disponibles'}</p>
                  </div>
                  <label className="trip-passenger-count" htmlFor="trip-passenger-count">
                    Cantidad de pasajes
                    <input
                      id="trip-passenger-count"
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max={maxPassengers}
                      step="1"
                      value={selection.passengerCount}
                      onChange={(event) => updatePassengerCount(event.target.value)}
                      aria-describedby="trip-passenger-count-hint"
                    />
                    <span id="trip-passenger-count-hint">De 1 a {maxPassengers} según disponibilidad (máximo 9 por compra).</span>
                  </label>
                </section>
              )}
              {selectedDeparture && selectedFare && (
                <form className="trip-passenger-form" onSubmit={handlePassengerDetailsSubmit} noValidate>
                  <div className="trip-passenger-form-heading">
                    <div>
                      <span className="trip-search-step">DATOS PARA LA RESERVA</span>
                      <h3>¿Quiénes viajan?</h3>
                    </div>
                    <span>{selection.passengerCount} {selection.passengerCount === 1 ? 'pasajero' : 'pasajeros'}</span>
                  </div>
                  {passengers.map((passenger, index) => {
                    const fieldId = (field) => `passenger-${index}-${field}`;
                    const fieldError = (field) => passengerErrors[`${index}-${field}`];
                    return (
                      <fieldset className="trip-passenger-fields" key={index}>
                        <legend>Pasajero {index + 1}</legend>
                        <label htmlFor={fieldId('firstName')}>
                          Nombre
                          <input id={fieldId('firstName')} value={passenger.firstName} maxLength="100" autoComplete="given-name" onChange={(event) => updatePassenger(index, 'firstName', event.target.value)} aria-invalid={Boolean(fieldError('firstName'))} aria-describedby={fieldError('firstName') ? `${fieldId('firstName')}-error` : undefined} />
                          {fieldError('firstName') && <span className="trip-passenger-error" id={`${fieldId('firstName')}-error`} role="alert">{fieldError('firstName')}</span>}
                        </label>
                        <label htmlFor={fieldId('lastName')}>
                          Apellido
                          <input id={fieldId('lastName')} value={passenger.lastName} maxLength="100" autoComplete="family-name" onChange={(event) => updatePassenger(index, 'lastName', event.target.value)} aria-invalid={Boolean(fieldError('lastName'))} aria-describedby={fieldError('lastName') ? `${fieldId('lastName')}-error` : undefined} />
                          {fieldError('lastName') && <span className="trip-passenger-error" id={`${fieldId('lastName')}-error`} role="alert">{fieldError('lastName')}</span>}
                        </label>
                        <label htmlFor={fieldId('documentType')}>
                          Tipo de documento
                          <select id={fieldId('documentType')} value={passenger.documentType} onChange={(event) => updatePassenger(index, 'documentType', event.target.value)} aria-invalid={Boolean(fieldError('documentType'))} aria-describedby={fieldError('documentType') ? `${fieldId('documentType')}-error` : undefined}>
                            <option value="">Seleccionar</option>
                            <option value="DNI">DNI</option>
                            <option value="PASAPORTE">Pasaporte</option>
                            <option value="OTRO">Otro</option>
                          </select>
                          {fieldError('documentType') && <span className="trip-passenger-error" id={`${fieldId('documentType')}-error`} role="alert">{fieldError('documentType')}</span>}
                        </label>
                        <label htmlFor={fieldId('documentNumber')}>
                          Número de documento
                          <input id={fieldId('documentNumber')} value={passenger.documentNumber} maxLength="20" autoComplete="off" onChange={(event) => updatePassenger(index, 'documentNumber', event.target.value)} aria-invalid={Boolean(fieldError('documentNumber'))} aria-describedby={fieldError('documentNumber') ? `${fieldId('documentNumber')}-error` : undefined} />
                          {fieldError('documentNumber') && <span className="trip-passenger-error" id={`${fieldId('documentNumber')}-error`} role="alert">{fieldError('documentNumber')}</span>}
                        </label>
                      </fieldset>
                    );
                  })}
                  <div className="trip-passenger-form-actions">
                    {passengersReady && <p role="status">Datos completos. Ya se pueden revisar en el resumen de compra.</p>}
                    <button className="trip-select-fare" type="submit">Validar datos</button>
                  </div>
                </form>
              )}
              {selectedDeparture && selectedFare && passengersReady && (
                <section className="trip-purchase-summary" aria-labelledby="trip-purchase-summary-title">
                  <div className="trip-passenger-form-heading">
                    <div>
                      <span className="trip-search-step">ANTES DE CONTINUAR</span>
                      <h3 id="trip-purchase-summary-title">Resumen de compra</h3>
                    </div>
                  </div>
                  <dl className="trip-purchase-summary-details">
                    <div><dt>Vuelo</dt><dd>{selectedDeparture.flightCode}</dd></div>
                    <div><dt>Ruta</dt><dd>{selectedDeparture.originCity} ({selectedDeparture.originCode}) → {selectedDeparture.destinationCity} ({selectedDeparture.destinationCode})</dd></div>
                    <div><dt>Fecha</dt><dd>{formatTripDate(selectedDeparture.date)}</dd></div>
                    <div><dt>Horario</dt><dd>{String(selectedDeparture.departureTime).slice(0, 5)} – {String(selectedDeparture.arrivalTime).slice(0, 5)}{selectedDeparture.arrivalDayOffset > 0 ? ` (+${selectedDeparture.arrivalDayOffset} día)` : ''}</dd></div>
                    <div><dt>Clase</dt><dd>{selectedFare.class === 'PRIMERA' ? 'Primera' : 'Económica'}</dd></div>
                    <div><dt>Pasajes</dt><dd>{selection.passengerCount}</dd></div>
                    <div className="trip-purchase-total"><dt>Total estimado</dt><dd>{formatPrice(Number(selectedFare.price) * selection.passengerCount)}</dd></div>
                  </dl>
                  {reservationState.status === 'error' && <p className="trip-reservation-message is-error" role="alert">{reservationState.message}</p>}
                  {reservationState.status === 'success' && reservationState.reservation && (
                    <p className="trip-reservation-message is-success" role="status">
                      Compra {reservationState.reservation.code} creada · {reservationState.reservation.status} · Vence {reservationState.reservation.expiresAt}.
                    </p>
                  )}
                  <div className="trip-passenger-form-actions">
                    {reservationState.status !== 'success' && (
                      <button className="trip-select-fare" type="button" onClick={() => setPassengersReady(false)}>Modificar datos</button>
                    )}
                    <button
                      className="trip-search-submit"
                      type="button"
                      onClick={createReservation}
                      disabled={reservationState.status === 'loading' || reservationState.status === 'success'}
                    >
                      {reservationState.status === 'loading' ? 'Reservando…' : reservationState.status === 'success' ? 'Compra creada' : 'Confirmar y reservar asientos'}
                    </button>
                  </div>
                </section>
              )}
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
        <section className="trip-purchases-card" aria-labelledby="trip-purchases-title">
          <div className="trip-search-card-heading">
            <div><span className="trip-search-step">TUS VIAJES</span><h2 id="trip-purchases-title">Compras y documentos</h2></div>
          </div>
          {purchaseState.status === 'loading' && <p role="status">Cargando tus compras…</p>}
          {purchaseState.message && <p className="trip-reservation-message is-error" role="alert">{purchaseState.message}</p>}
          {purchaseState.status === 'success' && purchaseState.reservations.length === 0 && <p>Todavía no tenés compras.</p>}
          {purchaseState.reservations.map((purchase) => (
            <article className="trip-purchase-document" key={purchase.id}>
              <div>
                <strong>{purchase.code} · {purchase.flight}</strong>
                <span>{purchase.origin} → {purchase.destination} · {formatTripDate(purchase.date)} · {purchase.status}</span>
              </div>
              {purchase.status === 'CONFIRMADA' ? (
                <div className="trip-document-actions">
                  {purchase.invoiceAvailable && <button type="button" onClick={() => downloadDocument(`/passenger/reservations/${purchase.id}/documents/invoice`, `factura-compra-${purchase.id}.pdf`)}>Descargar factura</button>}
                  {purchase.tickets.filter((ticket) => ticket.available).map((ticket, index) => (
                    <button type="button" key={ticket.id} onClick={() => downloadDocument(`/passenger/reservations/${purchase.id}/documents/tickets/${ticket.id}`, `pasaje-${ticket.id}.pdf`)}>Pasaje {index + 1}</button>
                  ))}
                  {!purchase.invoiceAvailable && !purchase.tickets.some((ticket) => ticket.available) && <span>Documentos en preparación.</span>}
                </div>
              ) : <span>Los documentos estarán disponibles cuando se confirme el pago.</span>}
            </article>
          ))}
        </section>
      </div>
    </MainLayout>
  );
}
