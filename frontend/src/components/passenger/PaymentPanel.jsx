import React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

// Formulario seguro de la pasarela (Card Payment Brick de Mercado Pago). Los datos de la
// tarjeta se escriben en el formulario de la pasarela, que devuelve un token: al backend de
// AeroNet solo viajan el token y datos no sensibles.
const FINAL_STATUSES = new Set(['APROBADA', 'RECHAZADA', 'REEMBOLSADA']);
const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 60;
const sdkLoads = new Map();

function loadPaymentSdk(url) {
  if (!sdkLoads.has(url)) {
    sdkLoads.set(url, new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.onload = () => (window.MercadoPago
        ? resolve(window.MercadoPago)
        : reject(new Error('El formulario seguro de la pasarela no se inicializó.')));
      script.onerror = () => {
        sdkLoads.delete(url);
        script.remove();
        reject(new Error('No se pudo cargar el formulario seguro de la pasarela.'));
      };
      document.head.appendChild(script);
    }));
  }
  return sdkLoads.get(url);
}

const formatPrice = (value) => new Intl.NumberFormat('es-AR', {
  style: 'currency', currency: 'ARS', maximumFractionDigits: 2,
}).format(Number(value));
const formatCountdown = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
const statusClass = (status) => {
  if (status === 'APROBADA') return 'is-success';
  if (status === 'RECHAZADA' || status === 'ERROR') return 'is-error';
  return 'is-pending';
};

export default function PaymentPanel({ purchaseId, onFinished, onClose }) {
  const { request } = useAuth();
  const [config, setConfig] = useState(null);
  const [transaction, setTransaction] = useState(null);
  const [panelState, setPanelState] = useState({ status: 'loading', message: '' });
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [pollingExhausted, setPollingExhausted] = useState(false);
  const transactionRef = useRef(null);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const acceptTransaction = useCallback((next) => {
    transactionRef.current = next;
    setTransaction(next);
    setSecondsLeft(next.secondsToExpire);
    if (FINAL_STATUSES.has(next.status)) onFinishedRef.current?.(next);
  }, []);

  const startTransaction = useCallback(async () => {
    const started = await request('/payments/transactions', {
      method: 'POST',
      body: JSON.stringify({ purchaseId }),
    });
    acceptTransaction(started.transaction);
  }, [acceptTransaction, purchaseId, request]);

  useEffect(() => {
    let cancelled = false;
    setPanelState({ status: 'loading', message: '' });
    (async () => {
      try {
        const paymentConfig = await request('/payments/config');
        if (cancelled) return;
        setConfig(paymentConfig);
        await startTransaction();
        if (!cancelled) setPanelState({ status: 'ready', message: '' });
      } catch (error) {
        if (!cancelled) setPanelState({ status: 'error', message: error.message || 'No se pudo iniciar el pago.' });
      }
    })();
    return () => { cancelled = true; };
  }, [request, startTransaction]);

  const brickContainerId = `aeronet-card-payment-brick-${purchaseId}`;
  const isReservationOpen = transaction?.purchaseStatus === 'PENDIENTE_PAGO' && secondsLeft > 0;

  useEffect(() => {
    if (!isReservationOpen) return undefined;
    const timer = window.setTimeout(() => setSecondsLeft((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [isReservationOpen, secondsLeft]);

  const submitCard = useCallback(async (formData) => {
    const current = transactionRef.current;
    setPanelState({ status: 'submitting', message: '' });
    const identification = formData.payer?.identification;
    try {
      const response = await request(`/payments/transactions/${current.id}/card`, {
        method: 'POST',
        body: JSON.stringify({
          token: formData.token,
          paymentMethodId: formData.payment_method_id,
          issuerId: formData.issuer_id ? String(formData.issuer_id) : undefined,
          installments: Number(formData.installments) || 1,
          payer: {
            email: formData.payer?.email || undefined,
            identification: identification?.type && identification?.number ? identification : undefined,
          },
        }),
      });
      acceptTransaction(response.transaction);
      setPanelState({ status: 'ready', message: '' });
    } catch (error) {
      setPanelState({ status: 'ready', message: error.message || 'No se pudo procesar el pago.' });
      throw error;
    }
  }, [acceptTransaction, request]);

  const showCardForm = Boolean(config && transaction && transaction.status === 'CREADA' && isReservationOpen);

  useEffect(() => {
    if (!showCardForm) return undefined;
    let cancelled = false;
    let controller = null;
    (async () => {
      try {
        const MercadoPago = await loadPaymentSdk(config.sdkUrl);
        if (cancelled) return;
        const mercadoPago = new MercadoPago(config.publicKey, { locale: config.locale || 'es-AR' });
        const created = await mercadoPago.bricks().create('cardPayment', brickContainerId, {
          initialization: {
            amount: Number(transactionRef.current.amount),
            payer: { email: transactionRef.current.payerEmail },
          },
          customization: { paymentMethods: { maxInstallments: 1 } },
          callbacks: {
            onReady: () => {},
            onSubmit: (formData) => submitCard(formData),
            onError: () => setPanelState((state) => ({
              ...state, message: 'El formulario de la pasarela informó un problema. Revisá los datos de la tarjeta.',
            })),
          },
        });
        if (cancelled) created.unmount();
        else controller = created;
      } catch (error) {
        if (!cancelled) setPanelState({ status: 'error', message: error.message || 'No se pudo mostrar el formulario de pago.' });
      }
    })();
    return () => {
      cancelled = true;
      controller?.unmount();
    };
  }, [brickContainerId, config, showCardForm, submitCard, transaction?.id]);

  useEffect(() => {
    if (!transaction || !['PENDIENTE', 'PROCESANDO'].includes(transaction.status)) return undefined;
    let polls = 0;
    setPollingExhausted(false);
    const timer = window.setInterval(async () => {
      polls += 1;
      try {
        const response = await request(`/payments/transactions/${transaction.id}`);
        acceptTransaction(response.transaction);
      } catch {
        // Se reintenta en el próximo ciclo.
      }
      if (polls >= MAX_POLLS) {
        window.clearInterval(timer);
        setPollingExhausted(true);
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [acceptTransaction, request, transaction?.id, transaction?.status]);

  const retryWithNewTransaction = async () => {
    setPanelState({ status: 'loading', message: '' });
    try {
      await startTransaction();
      setPanelState({ status: 'ready', message: '' });
    } catch (error) {
      setPanelState({ status: 'error', message: error.message || 'No se pudo reintentar el pago.' });
    }
  };

  return (
    <section className="trip-payment-panel" aria-labelledby={`trip-payment-title-${purchaseId}`}>
      <div className="trip-passenger-form-heading">
        <div>
          <span className="trip-search-step">PAGO SEGURO</span>
          <h3 id={`trip-payment-title-${purchaseId}`}>Pagá con tarjeta</h3>
        </div>
        {transaction && <span className="trip-payment-amount">{formatPrice(transaction.amount)}</span>}
      </div>

      {config?.environment === 'sandbox' && (
        <p className="trip-payment-sandbox">
          Entorno de pruebas de Mercado Pago: usá tarjetas de prueba. Titular <b>APRO</b> aprueba, <b>OTHE</b> rechaza y <b>CONT</b> deja el pago pendiente.
        </p>
      )}

      {panelState.status === 'loading' && <p role="status">Preparando el pago…</p>}
      {panelState.status === 'error' && <p className="trip-reservation-message is-error" role="alert">{panelState.message}</p>}

      {transaction && (
        <dl className="trip-payment-meta">
          <div><dt>Compra</dt><dd>{transaction.purchaseCode}</dd></div>
          <div><dt>Transacción</dt><dd><code>{transaction.id}</code></dd></div>
          {transaction.purchaseStatus === 'PENDIENTE_PAGO' && (
            <div><dt>La reserva vence en</dt><dd>{formatCountdown(secondsLeft ?? 0)}</dd></div>
          )}
        </dl>
      )}

      <div aria-live="polite">
        {transaction && transaction.status !== 'CREADA' && (
          <p className={`trip-reservation-message ${statusClass(transaction.status)}`} role={statusClass(transaction.status) === 'is-error' ? 'alert' : 'status'}>
            {transaction.message}
          </p>
        )}
        {panelState.status === 'submitting' && <p role="status">Procesando el pago con la pasarela…</p>}
        {panelState.status !== 'error' && panelState.message && (
          <p className="trip-reservation-message is-error" role="alert">{panelState.message}</p>
        )}
        {pollingExhausted && ['PENDIENTE', 'PROCESANDO'].includes(transaction?.status) && (
          <p role="status">Seguimos esperando la confirmación de la pasarela. Te avisaremos por email cuando se resuelva.</p>
        )}
        {transaction && transaction.purchaseStatus === 'PENDIENTE_PAGO' && secondsLeft === 0 && (
          <p className="trip-reservation-message is-error" role="alert">
            La reserva venció y los asientos se liberaron. Iniciá una nueva compra para continuar.
          </p>
        )}
      </div>

      {showCardForm && (
        <>
          <p className="trip-payment-hint">
            Los datos de la tarjeta se ingresan en el formulario de Mercado Pago y nunca pasan por los servidores de AeroNet.
          </p>
          <div id={brickContainerId} className="trip-payment-brick" />
        </>
      )}

      <div className="trip-passenger-form-actions">
        {transaction?.status === 'ERROR' && isReservationOpen && (
          <button className="trip-search-submit" type="button" onClick={retryWithNewTransaction}>Intentar nuevamente</button>
        )}
        {onClose && <button className="trip-select-fare" type="button" onClick={onClose}>Cerrar</button>}
      </div>
    </section>
  );
}
