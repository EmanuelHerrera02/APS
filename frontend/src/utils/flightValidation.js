export function validateFlightForm(form) {
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
  if (form.operatingDays.length === 0) errors.operatingDays = 'Seleccioná al menos un día de operación.';
  const activeClasses = Object.entries(form.classes).filter(([, value]) => value.enabled);
  if (activeClasses.length === 0) errors.classes = 'Seleccioná al menos una clase.';
  activeClasses.forEach(([name, value]) => {
    if (!/^\d+$/.test(value.capacity) || Number(value.capacity) < 1) {
      errors[`capacity-${name}`] = 'La capacidad debe ser un entero mayor que cero.';
    }
    if (!/^\d+(\.\d{1,2})?$/.test(value.price) || Number(value.price) <= 0 || Number(value.price) > 9999999999.99) {
      errors[`price-${name}`] = 'El precio debe ser positivo y tener hasta dos decimales.';
    }
  });
  return errors;
}
