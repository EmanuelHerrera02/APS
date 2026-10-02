import { useEffect, useState } from 'react';
import MainLayout from '../layouts/MainLayout';
import { useAuth } from '../../contexts/AuthContext';
import { Permissions } from '../../security/Authorization';

export default function EmployeeDashboard() {
  const { user, permissions, request } = useAuth();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    request('/employee/reports')
      .then((data) => { if (!cancelled) setStats(data.stats); })
      .catch((loadError) => { if (!cancelled) setError(loadError.message); });
    return () => { cancelled = true; };
  }, [request]);

  const shown = (value) => (stats ? value : '—');
  const currency = (value) => new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
  }).format(Number(value || 0));

  return (
    <MainLayout>
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-gray-900">Operaciones de {user?.firstName || 'mostrador'}</h2>
        {error && <p role="alert" className="text-sm text-red-700">No se pudieron cargar los indicadores: {error}</p>}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Reservas Pendientes</div>
            <div className="text-3xl font-bold text-orange-600 mt-2">{shown(stats?.pendingReservations)}</div>
            <div className="text-xs text-gray-500 mt-1">Por confirmar</div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Pagos Procesados</div>
            <div className="text-3xl font-bold text-green-600 mt-2">{shown(stats?.paymentsToday)}</div>
            <div className="text-xs text-gray-500 mt-1">Hoy</div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Ingresos Totales</div>
            <div className="text-3xl font-bold text-purple-600 mt-2">{shown(stats ? currency(stats.revenueThisMonth) : null)}</div>
            <div className="text-xs text-gray-500 mt-1">Este mes</div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Usuarios Activos</div>
            <div className="text-3xl font-bold text-blue-600 mt-2">{shown(stats?.activeUsers)}</div>
            <div className="text-xs text-gray-500 mt-1">En el sistema</div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Permisos Operacionales</h3>
          <div className="space-y-2">
            {permissions.includes(Permissions.RESERVATION_VIEW_ALL) && (
              <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
                <span>✅</span>
                <span className="text-sm">Ver todas las reservas</span>
              </div>
            )}
            {permissions.includes(Permissions.RESERVATION_CONFIRM) && (
              <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
                <span>✅</span>
                <span className="text-sm">Confirmar reservas</span>
              </div>
            )}
            {permissions.includes(Permissions.PAYMENT_PROCESS) && (
              <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
                <span>✅</span>
                <span className="text-sm">Procesar pagos</span>
              </div>
            )}
            {permissions.includes(Permissions.REPORT_VIEW_OPERATIONAL) && (
              <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
                <span>✅</span>
                <span className="text-sm">Ver reportes operacionales</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
