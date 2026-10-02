import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { Permissions, Roles } from './security/Authorization';
import AdminDashboard from './components/admin/AdminDashboard';
import EmployeeDashboard from './components/employee/EmployeeDashboard';
import PassengerDashboard from './components/passenger/PassengerDashboard';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import AdminUsersPage from './pages/AdminUsersPage';
import ProfilePage from './pages/ProfilePage';

function HomeRedirect() {
  const { roles, isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (roles.some((role) => role.name === Roles.ADMIN)) return <Navigate to="/admin/dashboard" replace />;
  if (roles.some((role) => role.name === Roles.EMPLOYEE)) return <Navigate to="/employee" replace />;
  return <Navigate to="/passenger" replace />;
}

function ProtectedRoute({ permission, children }) {
  const { loading, isAuthenticated, hasPermission } = useAuth();
  if (loading) return <main role="status">Cargando sesión…</main>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (permission && !hasPermission(permission)) return <Navigate to="/forbidden" replace />;
  return children;
}

function ForbiddenPage() {
  return <main className="mx-auto max-w-xl p-8 text-center"><h1>Acceso denegado</h1><p>Tu perfil no tiene permiso para esta sección.</p></main>;
}

function NotFoundPage() {
  return <main className="mx-auto max-w-xl p-8 text-center"><h1>Página no encontrada</h1><a href="/">Volver al inicio</a></main>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/dashboard" element={<HomeRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forbidden" element={<ForbiddenPage />} />
      <Route path="/admin/dashboard" element={<ProtectedRoute permission={Permissions.ADMIN_PANEL_ACCESS}><AdminDashboard /></ProtectedRoute>} />
      <Route path="/admin/users" element={<ProtectedRoute permission={Permissions.USER_LIST}><AdminUsersPage /></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute permission={Permissions.PROFILE_VIEW_OWN}><ProfilePage /></ProtectedRoute>} />
      <Route path="/employee" element={<ProtectedRoute permission={Permissions.REPORT_VIEW_OPERATIONAL}><EmployeeDashboard /></ProtectedRoute>} />
      <Route path="/employee/reports" element={<ProtectedRoute permission={Permissions.REPORT_VIEW_OPERATIONAL}><EmployeeDashboard /></ProtectedRoute>} />
      <Route path="/passenger" element={<ProtectedRoute permission={Permissions.AUTH_LOGIN}><PassengerDashboard /></ProtectedRoute>} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
