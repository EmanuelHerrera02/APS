import { useEffect, useState } from 'react';
import MainLayout from '../layouts/MainLayout';
import { useAuth } from '../../contexts/AuthContext';
import { Permissions } from '../../security/Authorization';

export default function AdminDashboard() {
  const { user, permissions, request } = useAuth();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    request('/admin/dashboard')
      .then((data) => { if (!cancelled) setStats(data.stats); })
      .catch((loadError) => { if (!cancelled) setError(loadError.message); });
    return () => { cancelled = true; };
  }, [request]);

  const currency = (value) => new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
  }).format(Number(value || 0));
  const shown = (value) => (stats ? value : '—');

  return (
    <MainLayout>
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-gray-900">Panel de {user?.firstName || 'administración'}</h2>
        {error && <p role="alert" className="text-sm text-red-700">No se pudieron cargar los indicadores: {error}</p>}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Usuarios Totales</div>
            <div className="text-3xl font-bold text-blue-600 mt-2">{shown(stats?.totalUsers)}</div>
            <div className="text-xs text-gray-500 mt-1">En el sistema</div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Reservas Totales</div>
            <div className="text-3xl font-bold text-indigo-600 mt-2">{shown(stats?.totalReservations)}</div>
            <div className="text-xs text-gray-500 mt-1">Todas las épocas</div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Ingresos Totales</div>
            <div className="text-3xl font-bold text-green-600 mt-2">{shown(stats ? currency(stats.totalRevenue) : null)}</div>
            <div className="text-xs text-gray-500 mt-1">Histórico</div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Eventos Auditados</div>
            <div className="text-3xl font-bold text-red-600 mt-2">{shown(stats?.auditedEvents)}</div>
            <div className="text-xs text-gray-500 mt-1">Registrados</div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Permisos Administrativos</h3>
          <div className="space-y-2">
            {permissions.includes(Permissions.USER_LIST) && (
              <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg">
                <span>🔑</span>
                <span className="text-sm">Listar usuarios</span>
              </div>
            )}
            {permissions.includes(Permissions.USER_CREATE) && (
              <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg">
                <span>🔑</span>
                <span className="text-sm">Crear nuevos usuarios</span>
              </div>
            )}
            {permissions.includes(Permissions.USER_EDIT) && (
              <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg">
                <span>🔑</span>
                <span className="text-sm">Editar usuarios</span>
              </div>
            )}
            {permissions.includes(Permissions.USER_CHANGE_ROLE) && (
              <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg">
                <span>🔑</span>
                <span className="text-sm">Cambiar roles de usuario</span>
              </div>
            )}
            {permissions.includes(Permissions.REPORT_VIEW_FINANCIAL) && (
              <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg">
                <span>🔑</span>
                <span className="text-sm">Ver reportes financieros</span>
              </div>
            )}
            {permissions.includes(Permissions.ADMIN_VIEW_AUDIT) && (
              <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg">
                <span>🔑</span>
                <span className="text-sm">Ver auditoría del sistema</span>
              </div>
            )}
            {permissions.includes(Permissions.ADMIN_CONFIG) && (
              <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg">
                <span>🔑</span>
                <span className="text-sm">Configurar el sistema</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
