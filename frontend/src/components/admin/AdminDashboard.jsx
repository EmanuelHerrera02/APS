import MainLayout from '../layouts/MainLayout';
import { useAuth } from '../../contexts/AuthContext';

export default function AdminDashboard() {
  const { permissions } = useAuth();

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Usuarios Totales</div>
            <div className="text-3xl font-bold text-blue-600 mt-2">0</div>
            <div className="text-xs text-gray-500 mt-1">En el sistema</div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Reservas Totales</div>
            <div className="text-3xl font-bold text-indigo-600 mt-2">0</div>
            <div className="text-xs text-gray-500 mt-1">Todas las épocas</div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Ingresos Totales</div>
            <div className="text-3xl font-bold text-green-600 mt-2">$0</div>
            <div className="text-xs text-gray-500 mt-1">Histórico</div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Eventos Auditados</div>
            <div className="text-3xl font-bold text-red-600 mt-2">0</div>
            <div className="text-xs text-gray-500 mt-1">Registrados</div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Permisos Administrativos</h3>
          <div className="space-y-2">
            {permissions.includes('user:list') && (
              <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg">
                <span>🔑</span>
                <span className="text-sm">Listar usuarios</span>
              </div>
            )}
            {permissions.includes('user:create') && (
              <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg">
                <span>🔑</span>
                <span className="text-sm">Crear nuevos usuarios</span>
              </div>
            )}
            {permissions.includes('user:edit') && (
              <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg">
                <span>🔑</span>
                <span className="text-sm">Editar usuarios</span>
              </div>
            )}
            {permissions.includes('user:change_role') && (
              <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg">
                <span>🔑</span>
                <span className="text-sm">Cambiar roles de usuario</span>
              </div>
            )}
            {permissions.includes('report:view_financial') && (
              <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg">
                <span>🔑</span>
                <span className="text-sm">Ver reportes financieros</span>
              </div>
            )}
            {permissions.includes('admin:view_audit') && (
              <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg">
                <span>🔑</span>
                <span className="text-sm">Ver auditoría del sistema</span>
              </div>
            )}
            {permissions.includes('admin:config') && (
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
