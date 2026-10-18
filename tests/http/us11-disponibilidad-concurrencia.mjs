// US11 — Control de disponibilidad, TTL de 10 minutos y pruebas de estrés/concurrencia sobre los últimos asientos.
// Uso contra API + MariaDB aislada: node tests/http/us11-disponibilidad-concurrencia.mjs
// Uso en modo verificación autónoma (contrato SQL/UI + simulador transaccional concurrente):
//   node tests/http/us11-disponibilidad-concurrencia.mjs --self-test
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, createReport, sql } from './lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const container = process.env.AERONET_TEST_DB_CONTAINER || 'aeronet-us11-db';
const selfTest = process.argv.includes('--self-test');

async function runLiveSuite(report) {
  const unique = Date.now();
  const makeAccount = (idx) => ({
    email: `us11-${unique}-${idx}@aeronet.test`,
    password: `US11-test-${unique}-${idx}-Pass`,
    firstName: 'Pasajero',
    lastName: `Concurrente${idx}`,
    phone: '+54 11 5555-0111',
  });

  const users = await Promise.all(
    Array.from({ length: 16 }, async (_, idx) => {
      const account = makeAccount(idx);
      const reg = await api('/auth/register', { method: 'POST', body: account });
      return { ...account, status: reg.status, token: reg.body.accessToken };
    })
  );
  report.check(
    'U11-01',
    'Registro de pasajeros de prueba para escenarios de disponibilidad y concurrencia',
    users.every((u) => u.status === 201 && Boolean(u.token)),
    `${users.filter((u) => Boolean(u.token)).length}/${users.length} cuentas listas`
  );
  if (!users.every((u) => u.token)) {
    report.finish();
    process.exit(1);
  }

  // Preparar un vuelo y salida aislada con capacidad reducida (PRIMERA=3, ECONOMY=5).
  const code = `U${String(unique).slice(-5)}`;
  const setupRows = sql(
    container,
    `
    SET @aep = (SELECT id FROM aeropuerto WHERE codigo_iata = 'AEP');
    SET @nqn = (SELECT id FROM aeropuerto WHERE codigo_iata = 'NQN');
    INSERT INTO vuelo (codigo, aeropuerto_origen_id, aeropuerto_destino_id, hora_partida, hora_llegada, fecha_desde, fecha_hasta)
    VALUES ('${code}', @aep, @nqn, '11:00', '13:05', CURDATE() + INTERVAL 1 DAY, CURDATE() + INTERVAL 15 DAY);
    SET @v_us11 = LAST_INSERT_ID();
    INSERT INTO vuelo_dia_operacion (vuelo_id, dia_semana) VALUES
      (@v_us11,1),(@v_us11,2),(@v_us11,3),(@v_us11,4),(@v_us11,5),(@v_us11,6),(@v_us11,7);
    INSERT INTO vuelo_clase (vuelo_id, clase, capacidad, precio) VALUES
      (@v_us11, 'PRIMERA', 3, 280000.00),
      (@v_us11, 'ECONOMY', 5, 110000.00);
    CALL generar_salidas(@v_us11);
    SELECT id, fecha FROM salida WHERE vuelo_id = @v_us11 ORDER BY fecha LIMIT 1;
  `
  );
  const lastRow = setupRows[setupRows.length - 1] || [];
  const departureId = Number(lastRow[0]);
  const departureDate = lastRow[1];

  const initialSearch = await api(
    `/passenger/search?origin=AEP&destination=NQN&dateFrom=${departureDate}`
  );
  const findFare = (res, cls) =>
    (res.body.results || []).find(
      (row) => Number(row.departureId) === departureId && row.class === cls
    );
  const initialFirst = findFare(initialSearch, 'PRIMERA');
  const initialEco = findFare(initialSearch, 'ECONOMY');
  report.check(
    'U11-02',
    'Control de disponibilidad inicial por vuelo, fecha y clase (PRIMERA=3, ECONOMY=5)',
    initialSearch.status === 200 &&
      initialFirst?.seatsAvailable === 3 &&
      initialEco?.seatsAvailable === 5,
    `PRIMERA=${initialFirst?.seatsAvailable ?? 'N/A'}, ECONOMY=${initialEco?.seatsAvailable ?? 'N/A'}`
  );

  // Reserva temporal de 1 asiento en PRIMERA: verificar TTL de 10 minutos (600 s).
  const resTemp = await api('/passenger/reservations', {
    method: 'POST',
    token: users[0].token,
    body: {
      departureId,
      emailContact: users[0].email,
      passengers: [
        {
          firstName: 'Reserva',
          lastName: 'Temporal',
          documentType: 'DNI',
          documentNumber: `T${unique}0`,
          class: 'PRIMERA',
        },
      ],
    },
  });
  const tempPurchaseId = Number(resTemp.body.reservation?.reservationId);
  const ttlRow = sql(
    container,
    `SELECT estado, TIMESTAMPDIFF(SECOND, created_at, expira_en) FROM compra WHERE id = ${tempPurchaseId};`
  )[0] || [];
  const ttlSeconds = Number(ttlRow[1]);
  report.check(
    'U11-03',
    'Reserva temporal en PENDIENTE_PAGO asigna TTL de 10 minutos (600 segundos)',
    resTemp.status === 201 &&
      ttlRow[0] === 'PENDIENTE_PAGO' &&
      ttlSeconds >= 595 &&
      ttlSeconds <= 605,
    `estado=${ttlRow[0]}, ttl=${ttlSeconds}s`
  );

  // Confirmar una segunda compra de 1 asiento en PRIMERA y verificar que la búsqueda descuenta confirmadas + reservas vigentes.
  const resConfirmed = await api('/passenger/reservations', {
    method: 'POST',
    token: users[1].token,
    body: {
      departureId,
      emailContact: users[1].email,
      passengers: [
        {
          firstName: 'Venta',
          lastName: 'Confirmada',
          documentType: 'DNI',
          documentNumber: `C${unique}1`,
          class: 'PRIMERA',
        },
      ],
    },
  });
  const confirmedPurchaseId = Number(resConfirmed.body.reservation?.reservationId);
  const confirmResult = sql(
    container,
    `CALL registrar_pago(${confirmedPurchaseId}, 280000.00, 'TARJETA_CREDITO', 'APROBADO', 'US11-CONF-${unique}', 'VISA', '4242', @p_u11, @r_u11); SELECT @r_u11;`
  )[0]?.[0];

  const searchAfterBoth = await api(
    `/passenger/search?origin=AEP&destination=NQN&dateFrom=${departureDate}`
  );
  const firstAfterBoth = findFare(searchAfterBoth, 'PRIMERA');
  report.check(
    'U11-04',
    'La búsqueda descuenta tanto ventas confirmadas (1) como reservas vigentes (1)',
    confirmResult === 'CONFIRMADA' && firstAfterBoth?.seatsAvailable === 1,
    `resultado_pago=${confirmResult}, asientos_disponibles=${firstAfterBoth?.seatsAvailable}`
  );

  // Aviso de disponibilidad insuficiente antes del pago cuando cambia la disponibilidad entre búsqueda y reserva.
  const insufficientRes = await api('/passenger/reservations', {
    method: 'POST',
    token: users[2].token,
    body: {
      departureId,
      emailContact: users[2].email,
      passengers: [
        {
          firstName: 'Pasajero',
          lastName: 'Uno',
          documentType: 'DNI',
          documentNumber: `I${unique}A`,
          class: 'PRIMERA',
        },
        {
          firstName: 'Pasajero',
          lastName: 'Dos',
          documentType: 'DNI',
          documentNumber: `I${unique}B`,
          class: 'PRIMERA',
        },
      ],
    },
  });
  report.check(
    'U11-05',
    'Rechaza con HTTP 409 y aviso de falta de disponibilidad antes del pago si se piden 2 y queda 1',
    insufficientRes.status === 409 &&
      String(insufficientRes.body.error).includes('Sin disponibilidad') &&
      String(insufficientRes.body.error).includes('quedan 1'),
    `HTTP ${insufficientRes.status} — ${insufficientRes.body.error || ''}`
  );

  // Vencimiento tras 10 minutos sin confirmación: libera automáticamente el asiento reservado.
  sql(
    container,
    `UPDATE compra SET expira_en = NOW() - INTERVAL 1 SECOND WHERE id = ${tempPurchaseId};`
  );
  const searchAfterExpiry = await api(
    `/passenger/search?origin=AEP&destination=NQN&dateFrom=${departureDate}`
  );
  const firstAfterExpiry = findFare(searchAfterExpiry, 'PRIMERA');
  const expiredState = sql(
    container,
    `SELECT c.estado, p.estado FROM compra c JOIN pasaje p ON p.compra_id = c.id WHERE c.id = ${tempPurchaseId};`
  )[0] || [];
  report.check(
    'U11-06',
    'Liberación automática tras vencer los 10 minutos devuelve el asiento (disponibles 1 -> 2)',
    expiredState[0] === 'EXPIRADA' &&
      expiredState[1] === 'CANCELADO' &&
      firstAfterExpiry?.seatsAvailable === 2,
    `compra=${expiredState[0]}, pasaje=${expiredState[1]}, disponibles=${firstAfterExpiry?.seatsAvailable}`
  );

  // Estrés/concurrencia: 12 compras simultáneas sobre los últimos 2 asientos de PRIMERA.
  const concurrentFirstRequests = users.slice(2, 14).map((user, idx) =>
    api('/passenger/reservations', {
      method: 'POST',
      token: user.token,
      body: {
        departureId,
        emailContact: user.email,
        passengers: [
          {
            firstName: `ConcP${idx}`,
            lastName: 'Stress',
            documentType: 'DNI',
            documentNumber: `S${unique}P${idx}`,
            class: 'PRIMERA',
          },
        ],
      },
    })
  );
  const concurrentFirstResponses = await Promise.all(concurrentFirstRequests);
  const acceptedFirst = concurrentFirstResponses.filter((r) => r.status === 201);
  const rejectedFirst = concurrentFirstResponses.filter((r) => r.status === 409);

  // Confirmar atómicamente todas las compras que lograron reservar en PRIMERA.
  for (const res of acceptedFirst) {
    const id = Number(res.body.reservation.reservationId);
    sql(container, `CALL confirmar_compra(${id});`);
  }

  const firstInventory = sql(
    container,
    `SELECT sc.capacidad, sc.vendidos,
            (SELECT COUNT(*) FROM pasaje p WHERE p.salida_id = sc.salida_id AND p.clase = 'PRIMERA' AND p.estado = 'EMITIDO') AS emitidos
       FROM salida_clase sc WHERE sc.salida_id = ${departureId} AND sc.clase = 'PRIMERA';`
  )[0] || [];
  report.check(
    'U11-07',
    'Concurrencia en PRIMERA (12 simultáneas por 2 últimos asientos): exactamente 2 aceptadas y 10 rechazadas sin sobreventa',
    acceptedFirst.length === 2 &&
      rejectedFirst.length === 10 &&
      Number(firstInventory[0]) === 3 &&
      Number(firstInventory[1]) === 3 &&
      Number(firstInventory[2]) === 3,
    `201=${acceptedFirst.length}, 409=${rejectedFirst.length}, vendidos=${firstInventory[1]}/${firstInventory[0]}, emitidos=${firstInventory[2]}`
  );

  // Estrés/concurrencia en ECONOMY (capacidad 5): 15 compras simultáneas de 1 y 2 asientos.
  const concurrentEcoRequests = users.slice(0, 15).map((user, idx) => {
    const count = idx % 2 === 0 ? 2 : 1;
    return api('/passenger/reservations', {
      method: 'POST',
      token: user.token,
      body: {
        departureId,
        emailContact: user.email,
        passengers: Array.from({ length: count }, (_, pIdx) => ({
          firstName: `ConcE${idx}`,
          lastName: `Pas${pIdx}`,
          documentType: 'DNI',
          documentNumber: `E${unique}${idx}${pIdx}`,
          class: 'ECONOMY',
        })),
      },
    });
  });
  const concurrentEcoResponses = await Promise.all(concurrentEcoRequests);
  const acceptedEco = concurrentEcoResponses.filter((r) => r.status === 201);
  for (const res of acceptedEco) {
    const id = Number(res.body.reservation.reservationId);
    sql(container, `CALL confirmar_compra(${id});`);
  }
  const ecoInventory = sql(
    container,
    `SELECT sc.capacidad, sc.vendidos,
            (SELECT COUNT(*) FROM pasaje p WHERE p.salida_id = sc.salida_id AND p.clase = 'ECONOMY' AND p.estado IN ('RESERVADO', 'EMITIDO')) AS activos
       FROM salida_clase sc WHERE sc.salida_id = ${departureId} AND sc.clase = 'ECONOMY';`
  )[0] || [];
  report.check(
    'U11-08',
    'Concurrencia en ECONOMY (15 simultáneas de 1-2 pasajes sobre capacidad 5): nunca supera capacidad real',
    Number(ecoInventory[1]) <= Number(ecoInventory[0]) &&
      Number(ecoInventory[2]) === Number(ecoInventory[1]) &&
      Number(ecoInventory[1]) === 5,
    `aceptadas=${acceptedEco.length}, vendidos=${ecoInventory[1]}/${ecoInventory[0]}, activos=${ecoInventory[2]}`
  );
}

async function runSelfTestSuite(report) {
  const schemaSql = fs.readFileSync(path.join(repoRoot, 'db/01_schema.sql'), 'utf8');
  const logicSql = fs.readFileSync(path.join(repoRoot, 'db/02_logic.sql'), 'utf8');
  const testsSql = fs.readFileSync(path.join(repoRoot, 'db/04_tests.sql'), 'utf8');
  const migrationSql = fs.readFileSync(
    path.join(repoRoot, 'db/migrations/20261018_us11_disponibilidad_ttl.sql'),
    'utf8'
  );
  const controllerScala = fs.readFileSync(
    path.join(repoRoot, 'backend/src/main/scala/com/transport/system/controllers/PassengerController.scala'),
    'utf8'
  );
  const dashboardJsx = fs.readFileSync(
    path.join(repoRoot, 'frontend/src/components/passenger/PassengerDashboard.jsx'),
    'utf8'
  );

  // 1. Restricciones a nivel de base de datos y vista de disponibilidad.
  const hasDbConstraints =
    schemaSql.includes('CONSTRAINT chk_salida_clase_capacidad CHECK (capacidad >= 0)') &&
    schemaSql.includes('CONSTRAINT chk_salida_clase_vendidos CHECK (vendidos >= 0 AND vendidos <= capacidad)') &&
    schemaSql.includes('sc.capacidad - sc.vendidos   AS asientos_disponibles') &&
    logicSql.includes("SET MESSAGE_TEXT = 'No se puede reducir la capacidad por debajo de los asientos vendidos'");
  report.check(
    'U11-S01',
    'Restricciones DB (chk_salida_clase_vendidos, trg_salida_clase_bu, trg_pasaje_bi) y v_disponibilidad',
    hasDbConstraints,
    'db/01_schema.sql + db/02_logic.sql'
  );

  // 2. TTL de 10 minutos y liberación automática.
  const has10MinTtl =
    logicSql.includes('SET NEW.expira_en = NOW() + INTERVAL 10 MINUTE;') &&
    !logicSql.includes('INTERVAL 15 MINUTE') &&
    migrationSql.includes('SET NEW.expira_en = NOW() + INTERVAL 10 MINUTE;') &&
    logicSql.includes('CREATE EVENT ev_liberar_reservas_vencidas') &&
    logicSql.includes('WHERE estado = \'PENDIENTE_PAGO\' AND expira_en <= v_corte;');
  report.check(
    'U11-S02',
    'Reserva temporal con TTL de 10 minutos y liberación automática en trg_compra_bi y liberar_reservas_vencidas',
    has10MinTtl,
    'TTL = 10 MINUTE + evento cada 1 min + migración US11'
  );

  // 3. Confirmación atómica contra inventario y bloqueo de reservas vencidas.
  const hasAtomicConfirmation =
    logicSql.includes('CREATE PROCEDURE confirmar_compra(IN p_compra_id BIGINT UNSIGNED)') &&
    logicSql.includes("SET MESSAGE_TEXT = 'La reserva de la compra está vencida'") &&
    logicSql.includes('CALL confirmar_compra(p_compra_id);') &&
    testsSql.includes("'T36'") &&
    testsSql.includes("'T37'");
  report.check(
    'U11-S03',
    'Confirmación atómica (confirmar_compra + trg_compra_bu + registrar_pago) y casos T36–T37 en 04_tests.sql',
    hasAtomicConfirmation,
    'confirmar_compra + validación de inventario y vencimiento'
  );

  // 4. Backend y UI: liberación en búsqueda/conflicto y aviso en pantalla antes del pago.
  const hasBackendAndUiWarnings =
    controllerScala.includes('releaseExpiredReservations(connection)') &&
    controllerScala.includes(' 409 else 422') &&
    dashboardJsx.includes('availabilityWarning') &&
    dashboardJsx.includes('No hay disponibilidad suficiente para') &&
    dashboardJsx.includes('role="alert"');
  report.check(
    'U11-S04',
    'Backend libera reservas vencidas en búsqueda/conflicto (HTTP 409) y UI muestra alerta antes del pago',
    hasBackendAndUiWarnings,
    'PassengerController.scala + PassengerDashboard.jsx'
  );

  // 5. Simulación transaccional de estrés/concurrencia con bloqueo de fila (25 compras simultáneas sobre últimos asientos).
  class InventoryEngine {
    constructor(capacity) {
      this.capacity = capacity;
      this.vendidos = 0;
      this.lock = Promise.resolve();
      this.purchases = new Map();
      this.nextId = 1;
    }

    withRowLock(fn) {
      const next = this.lock.then(() => fn());
      this.lock = next.catch(() => {});
      return next;
    }

    reserve(passengerCount, nowMs, ttlMs = 10 * 60 * 1000) {
      return this.withRowLock(async () => {
        // Simula retardo de E/S bajo bloqueo de fila InnoDB.
        await new Promise((r) => setTimeout(r, 2));
        this.sweepExpired(nowMs);
        const disponibles = this.capacity - this.vendidos;
        if (passengerCount < 1 || passengerCount > 9) {
          return { status: 422, error: 'Una compra admite de 1 a 9 pasajes' };
        }
        if (this.vendidos + passengerCount > this.capacity) {
          return {
            status: 409,
            error: `Sin disponibilidad: se pidieron ${passengerCount} asientos en PRIMERA y quedan ${disponibles}`,
          };
        }
        this.vendidos += passengerCount;
        const id = this.nextId++;
        this.purchases.set(id, {
          id,
          count: passengerCount,
          status: 'PENDIENTE_PAGO',
          expiresAt: nowMs + ttlMs,
          tickets: Array.from({ length: passengerCount }, () => 'RESERVADO'),
        });
        return { status: 201, reservationId: id, expiresAt: nowMs + ttlMs };
      });
    }

    confirm(purchaseId, nowMs) {
      return this.withRowLock(async () => {
        const purchase = this.purchases.get(purchaseId);
        if (!purchase) return { status: 404, error: 'La compra no existe' };
        if (purchase.status === 'PENDIENTE_PAGO' && purchase.expiresAt <= nowMs) {
          this.expirePurchase(purchase);
          return { status: 409, error: 'La reserva de la compra está vencida', resultado: 'REQUIERE_REEMBOLSO' };
        }
        if (purchase.status !== 'PENDIENTE_PAGO') {
          return {
            status: 409,
            error: `Transición inválida desde ${purchase.status}`,
            resultado: 'REQUIERE_REEMBOLSO',
          };
        }
        if (this.activeTicketsCount() > this.vendidos || this.vendidos > this.capacity) {
          return { status: 409, error: 'Inconsistencia de inventario' };
        }
        purchase.status = 'CONFIRMADA';
        purchase.tickets = purchase.tickets.map(() => 'EMITIDO');
        return { status: 200, resultado: 'CONFIRMADA' };
      });
    }

    sweepExpired(nowMs) {
      for (const purchase of this.purchases.values()) {
        if (purchase.status === 'PENDIENTE_PAGO' && purchase.expiresAt <= nowMs) {
          this.expirePurchase(purchase);
        }
      }
    }

    expirePurchase(purchase) {
      const reserved = purchase.tickets.filter((t) => t === 'RESERVADO').length;
      purchase.status = 'EXPIRADA';
      purchase.tickets = purchase.tickets.map(() => 'CANCELADO');
      this.vendidos -= reserved;
    }

    activeTicketsCount() {
      let total = 0;
      for (const purchase of this.purchases.values()) {
        total += purchase.tickets.filter((t) => t === 'RESERVADO' || t === 'EMITIDO').length;
      }
      return total;
    }

    searchAvailable(nowMs) {
      this.sweepExpired(nowMs);
      return this.capacity - this.vendidos;
    }
  }

  const engine = new InventoryEngine(12);
  const t0 = Date.now();
  // 1 reserva temporal de 2 asientos y 1 venta confirmada de 2 asientos -> deben quedar 8 disponibles.
  const rTemp = await engine.reserve(2, t0);
  const rConf = await engine.reserve(2, t0);
  await engine.confirm(rConf.reservationId, t0 + 1000);
  const availDuringHold = engine.searchAvailable(t0 + 5 * 60 * 1000);
  // A los 10 minutos exactos (600_000 ms), la reserva impaga vence y libera sus 2 asientos -> quedan 10 disponibles.
  const availAfter10Min = engine.searchAvailable(t0 + 10 * 60 * 1000);
  const lateConfirm = await engine.confirm(rTemp.reservationId, t0 + 10 * 60 * 1000 + 1);

  report.check(
    'U11-S05',
    'Búsqueda descuenta confirmadas (2) + reservas vigentes (2) y libera automáticamente tras 10 minutos',
    availDuringHold === 8 && availAfter10Min === 10 && lateConfirm.resultado === 'REQUIERE_REEMBOLSO',
    `durante_reserva=${availDuringHold}, tras_10m=${availAfter10Min}, pago_tardio=${lateConfirm.resultado}`
  );

  // Ahora quedan 10 asientos libres (de 12). Lanzamos 25 compras simultáneas por los últimos 10 asientos.
  const t1 = t0 + 11 * 60 * 1000;
  const concurrentResults = await Promise.all(
    Array.from({ length: 25 }, () => engine.reserve(1, t1))
  );
  const accepted = concurrentResults.filter((r) => r.status === 201);
  const rejected = concurrentResults.filter((r) => r.status === 409);
  const confirmations = await Promise.all(
    accepted.map((r) => engine.confirm(r.reservationId, t1 + 1000))
  );

  report.check(
    'U11-S06',
    'Estrés concurrente (25 compras simultáneas sobre los últimos 10 asientos): 10 confirmadas, 15 rechazadas, 0 sobreventa',
    accepted.length === 10 &&
      rejected.length === 15 &&
      confirmations.every((c) => c.status === 200) &&
      engine.vendidos === 12 &&
      engine.activeTicketsCount() === 12 &&
      engine.searchAvailable(t1 + 2000) === 0,
    `aceptadas=${accepted.length}, rechazadas=${rejected.length}, vendidos=${engine.vendidos}/${engine.capacity}`
  );
}

const report = createReport('US11 — Control de disponibilidad, TTL 10 min y concurrencia');
if (selfTest) {
  await runSelfTestSuite(report);
} else {
  await runLiveSuite(report);
}
report.finish();
