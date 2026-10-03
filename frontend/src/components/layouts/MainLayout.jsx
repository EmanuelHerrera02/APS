import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { Permissions, Roles } from '../../security/Authorization';
import './MainLayout.css';

export default function MainLayout({ children }) {
  const { user, roles, permissions, logout, hasRole, hasPermission } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  /**
   * Generar menú dinámico según rol y permisos
   */
  const getMenuItems = () => {
    const items = [];

    // MENÚ COMÚN (Todos)
    items.push({
      label: 'Dashboard',
      path: '/dashboard',
      icon: '📊',
      permission: Permissions.AUTH_LOGIN,
      submenu: null,
    });

    items.push({
      label: 'Mi Perfil',
      path: '/profile',
      icon: '👤',
      permission: Permissions.PROFILE_VIEW_OWN,
      submenu: null,
    });

    // MENÚ PASAJERO
    if (hasRole(Roles.PASSENGER)) {
      items.push({
        label: 'Mis Reservas',
        path: '/passenger',
        icon: '🎫',
        permission: Permissions.RESERVATION_VIEW_OWN,
        submenu: [
          { label: 'Ver mis reservas', path: '/passenger/reservations', permission: Permissions.RESERVATION_VIEW_OWN },
          { label: 'Nueva reserva', path: '/passenger/reservations/new', permission: Permissions.RESERVATION_CREATE },
        ],
      });
    }

    // MENÚ EMPLEADO
    if (hasRole(Roles.EMPLOYEE)) {
      items.push({
        label: 'Gestión',
        path: '/employee',
        icon: '⚙️',
        permission: Permissions.RESERVATION_VIEW_ALL,
        submenu: [
          { label: 'Todas las reservas', path: '/employee/reservations', permission: Permissions.RESERVATION_VIEW_ALL },
          { label: 'Procesar pagos', path: '/employee/payments', permission: Permissions.PAYMENT_PROCESS },
          { label: 'Reportes', path: '/employee/reports', permission: Permissions.REPORT_VIEW_OPERATIONAL },
        ],
      });
    }

    // MENÚ ADMIN
    if (hasRole(Roles.ADMIN)) {
      items.push({
        label: 'Administración',
      path: '/admin/dashboard',
        icon: '🔧',
        permission: Permissions.ADMIN_PANEL_ACCESS,
        submenu: [
          { label: 'Panel de Control', path: '/admin/dashboard', permission: Permissions.ADMIN_PANEL_ACCESS },
          { label: 'Gestionar Usuarios', path: '/admin/users', permission: Permissions.USER_LIST },
          { label: 'Alta de vuelo', path: '/admin/flights/new', permission: Permissions.FLIGHT_CREATE },
          { label: 'Pruebas de alta', path: '/admin/flights/test', permission: Permissions.FLIGHT_CREATE },
          { label: 'Reportes Financieros', path: '/admin/reports', permission: Permissions.REPORT_VIEW_FINANCIAL },
          { label: 'Auditoría', path: '/admin/audit', permission: Permissions.ADMIN_VIEW_AUDIT },
        ],
      });
    }

    // Filtrar solo items con permisos
    return items.filter(item => hasPermission(item.permission));
  };

  const menuItems = getMenuItems();

  const isActive = (path) => {
    return location.pathname.startsWith(path);
  };

  const getRoleLabel = (roleName) => {
    const labels = {
      [Roles.PASSENGER]: '👤 Pasajero',
      [Roles.EMPLOYEE]: '💼 Empleado',
      [Roles.ADMIN]: '🔐 Administrador',
    };
    return labels[roleName] || roleName;
  };

  return (
    <div className="layout-container">
      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <h1 className="logo">🚌 Sistema Transporte</h1>
          <button
            className="toggle-btn"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title={sidebarOpen ? 'Cerrar menú' : 'Abrir menú'}
          >
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </div>

        <nav className="sidebar-nav">
          {menuItems.map((item, index) => (
            <div key={index} className="nav-item-wrapper">
              <a
                href={item.path}
                className={`nav-item ${isActive(item.path) ? 'active' : ''}`}
                title={item.label}
              >
                <span className="nav-icon">{item.icon}</span>
                {sidebarOpen && <span className="nav-label">{item.label}</span>}
              </a>

              {/* Submenu */}
              {item.submenu && sidebarOpen && (
                <div className="submenu">
                  {item.submenu
                    .filter(sub => hasPermission(sub.permission))
                    .map((subitem, subindex) => (
                      <a
                        key={subindex}
                        href={subitem.path}
                        className={`submenu-item ${isActive(subitem.path) ? 'active' : ''}`}
                      >
                        {subitem.label}
                      </a>
                    ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* User Info */}
        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-role">
              {roles.length > 0 ? getRoleLabel(roles[0].name) : 'Sin rol'}
            </div>
            <div className="user-name">{user?.firstName} {user?.lastName}</div>
            <div className="user-email">{user?.email}</div>
          </div>
          <button className="logout-btn" onClick={handleLogout}>
            Cerrar Sesión
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="main-content">
        <header className="header">
          <div className="header-left">
            <button
              className="mobile-toggle"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              ☰
            </button>
            <h2 className="page-title">
              {roles.length > 0 ? `Bienvenido, ${user?.firstName}` : 'Dashboard'}
            </h2>
          </div>
          <div className="header-right">
            <div className="status-indicator">
              <span className="status-dot"></span>
              Conectado
            </div>
          </div>
        </header>

        <main className="page-content">
          {children}
        </main>
      </div>
    </div>
  );
}
