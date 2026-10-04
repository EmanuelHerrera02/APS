// Debe coincidir con FlightRepository.MaxPeriodDays en el backend.
export const MAX_PERIOD_DAYS = 366;
const MAX_CAPACITY = 2147483647;

export function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const parseDate = (value) => new Date(`${value}T12:00:00`);
const daysBetween = (from, to) => Math.round((parseDate(to) - parseDate(from)) / 86400000);

// Indica si alguna fecha del período cae en los días elegidos ('1' = lunes … '7' = domingo).
// Basta revisar la primera semana: después los días de la semana se repiten.
export function periodIncludesOperatingDay(startDate, endDate, operatingDays) {
  const days = new Set(operatingDays.map(Number));
  const total = daysBetween(startDate, endDate);
  for (let offset = 0; offset <= total && offset < 7; offset += 1) {
    const date = parseDate(startDate);
    date.setDate(date.getDate() + offset);
    if (days.has(((date.getDay() + 6) % 7) + 1)) return true;
  }
  return false;
}

export function validateFlightForm(form, today = localDateString()) {
  const errors = {};
  if (!/^[A-Z0-9]{2}[0-9]{1,4}$/.test(form.code.trim().toUpperCase())) {
    errors.code = 'Usá dos letras o números seguidos de uno a cuatro dígitos.';
  }
  if (!form.originAirportId) errors.originAirportId = 'Elegí el aeropuerto de origen.';
  if (!form.destinationAirportId) errors.destinationAirportId = 'Elegí el aeropuerto de destino.';
  else if (form.originAirportId === form.destinationAirportId) errors.destinationAirportId = 'Origen y destino deben ser distintos.';
  if (!form.departureTime || !form.arrivalTime) errors.times = 'Completá ambos horarios.';
  else if (form.arrivalDayOffset === '0' && form.arrivalTime <= form.departureTime) {
    errors.times = 'La llegada debe ser posterior a la partida o indicar llegada al día siguiente.';
  }
  if (!form.startDate || !form.endDate) errors.dates = 'Completá las fechas del período.';
  else if (form.startDate > form.endDate) errors.dates = 'La fecha de inicio debe ser anterior o igual a la fecha de fin.';
  else if (form.startDate < today) errors.dates = 'El período no puede comenzar antes de hoy.';
  else if (daysBetween(form.startDate, form.endDate) >= MAX_PERIOD_DAYS) {
    errors.dates = `El período no puede superar los ${MAX_PERIOD_DAYS} días.`;
  }
  if (form.operatingDays.length === 0) errors.operatingDays = 'Seleccioná al menos un día de operación.';
  else if (!errors.dates && !periodIncludesOperatingDay(form.startDate, form.endDate, form.operatingDays)) {
    errors.operatingDays = 'El período no incluye ninguno de los días de operación elegidos.';
  }
  const activeClasses = Object.entries(form.classes).filter(([, value]) => value.enabled);
  if (activeClasses.length === 0) errors.classes = 'Seleccioná al menos una clase.';
  activeClasses.forEach(([name, value]) => {
    if (!/^\d+$/.test(value.capacity) || Number(value.capacity) < 1 || Number(value.capacity) > MAX_CAPACITY) {
      errors[`capacity-${name}`] = 'La capacidad debe ser un entero mayor que cero.';
    }
    if (!/^\d+(\.\d{1,2})?$/.test(value.price) || Number(value.price) <= 0 || Number(value.price) > 9999999999.99) {
      errors[`price-${name}`] = 'El precio debe ser positivo y tener hasta dos decimales.';
    }
  });
  return errors;
}
