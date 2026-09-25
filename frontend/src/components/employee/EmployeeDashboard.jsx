import MainLayout from '../layouts/MainLayout';
import { useAuth } from '../../contexts/AuthContext';

export default function EmployeeDashboard() {
  const { user, permissions } = useAuth();

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Reservas Pendientes</div>
            <div className="text-3xl font-bold text-orange-600 mt-2">0</div>
            <div className="text-xs text-gray-500 mt-1">Por confirmar</div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Pagos Procesados</div>
            <div className="text-3xl font-bold text-green-600 mt-2">0</div>
            <div className="text-xs text-gray-500 mt-1">Hoy</div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Ingresos Totales</div>
            <div className="text-3xl font-bold text-purple-600 mt-2">$0</div>
            <div className="text-xs text-gray-500 mt-1">Este mes</div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Usuarios Activos</div>
            <div className="text-3xl font-bold text-blue-600 mt-2">0</div>
            <div className="text-xs text-gray-500 mt-1">En el sistema</div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Permisos Operacionales</h3>
          <div className="space-y-2">
            {permissions.includes('reservation:view_all') && (
              <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
                <span>✅</span>
                <span className="text-sm">Ver todas las reservas</span>
              </div>
            )}
            {permissions.includes('reservation:confirm') && (
              <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
                <span>✅</span>
                <span className="text-sm">Confirmar reservas</span>
              </div>
            )}
            {permissions.includes('payment:process') && (
              <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
                <span>✅</span>
                <span className="text-sm">Procesar pagos</span>
              </div>
            )}
            {permissions.includes('report:view_operational') && (
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
