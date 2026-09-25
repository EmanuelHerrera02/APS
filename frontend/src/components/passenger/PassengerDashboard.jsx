import MainLayout from '../layouts/MainLayout';
import { useAuth } from '../../contexts/AuthContext';

export default function PassengerDashboard() {
  const { user, permissions } = useAuth();

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Mis Reservas</div>
            <div className="text-3xl font-bold text-blue-600 mt-2">0</div>
            <div className="text-xs text-gray-500 mt-1">Reservas activas</div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Viajes Completados</div>
            <div className="text-3xl font-bold text-green-600 mt-2">0</div>
            <div className="text-xs text-gray-500 mt-1">En tu historial</div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Saldo</div>
            <div className="text-3xl font-bold text-purple-600 mt-2">$0</div>
            <div className="text-xs text-gray-500 mt-1">En tu cuenta</div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Funcionalidades Disponibles</h3>
          <div className="space-y-2">
            {permissions.includes('reservation:create') && (
              <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
                <span>✅</span>
                <span className="text-sm">Puedes crear nuevas reservas</span>
              </div>
            )}
            {permissions.includes('reservation:view_own') && (
              <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
                <span>✅</span>
                <span className="text-sm">Puedes ver tus reservas</span>
              </div>
            )}
            {permissions.includes('payment:register_method') && (
              <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
                <span>✅</span>
                <span className="text-sm">Puedes registrar métodos de pago</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
